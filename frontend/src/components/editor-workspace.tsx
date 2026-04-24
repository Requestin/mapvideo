import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Header } from './header';
import { ElementsList } from './elements-list';
import { RightSidebar } from './right-sidebar';
import { BottomToolbar } from './bottom-toolbar';
import { ResetViewButton } from './reset-view-button';
import { ResetBearingButton } from './reset-bearing-button';
import { EditorMap } from './editor-map';
import { AddPointModal } from './add-point-modal';
import { VideoSettingsModal } from './video-settings-modal';
import { useEditorState } from '../state/editor-state';
import { useEditorMap } from '../hooks/use-editor-map';
import { computeResetView } from '../state/editor-state';
import { loadAppFonts } from '../services/fonts';
import { PixiLayer, type HitRegistry } from '../pixi/pixi-layer';
import { useElementDrag } from '../pixi/use-element-drag';
import { useElementHover } from '../pixi/use-element-hover';
import type { LngLat, VideoSettings } from '../state/types';
import { AxiosError } from 'axios';
import { fetchRoute } from '../api/routes';
import { getActiveRender, getRenderStatus, postRender } from '../api/render';
import { serializeMapState } from '../utils/serialize-map-state';
import { useCameraBreathingPreview } from '../hooks/use-camera-breathing-preview';
import { useToast } from './toast-provider';
import { GeoTitleOverlay } from './geo-title-overlay';

// Renders the editor stage now that both providers (state + map) are in
// scope. Owns:
//   • the PixiJS reconciliation layer + drag/hover controllers;
//   • the "Add point" modal and its trigger from the toolbar;
//   • autofit behaviour — on every new point we flyTo/fitBounds so the
//     user never has to hunt for it manually (SPEC §"При наличии других
//     точек — карта автомасштабируется под все точки");
//   • one-shot font bootstrap so PixiJS labels see the TTF files before
//     the first render;
//   • (task12) dismissal of the two side overlays — Esc keypress and
//     click-on-empty-map close both the Elements dropdown and the
//     Settings panel.
export function EditorWorkspace(): JSX.Element {
  const {
    elements,
    addPoint,
    addRoute,
    updateRouteWaypoints,
    updateRouteEndCoordinates,
    setRouteOsrmCoordinates,
    setRouteOsrmLegsCoordinates,
    selectedElementId,
    selectElement,
    routeBuildMode,
    setRouteBuildMode,
    videoSettings,
    geoTitle,
    commitVideoSettings,
  } = useEditorState();
  const { mapRef, pixelsToCoordinates } = useEditorMap();
  const { showToast } = useToast();
  const osrmWarningShown = useRef<Set<string>>(new Set());
  const osrmFailedRoutes = useRef<Set<string>>(new Set());
  const pendingOsrmRoutes = useRef<Set<string>>(new Set());
  const [pendingOsrmCount, setPendingOsrmCount] = useState(0);

  // task8: server-side video render (polling 2s)
  const [renderJobId, setRenderJobId] = useState<string | null>(null);
  const [renderProgress, setRenderProgress] = useState(0);
  const renderInProgress = renderJobId !== null;
  const jobIdRef = useRef<string | null>(null);
  jobIdRef.current = renderJobId;

  // Live ref to the hit-test registry updated by PixiLayer on every
  // map render tick and read by the drag controller on each mousedown.
  const hitRegistry = useMemo<HitRegistry>(() => ({ targets: [] }), []);
  useElementDrag(hitRegistry);
  useElementHover(hitRegistry);

  // task6: cursor during route-build mode (pixel coords) — lives in a ref
  // rather than state because PixiLayer re-reads it from its own ticker at
  // 60 FPS. React setState here would storm the whole tree on every mouse
  // move. The ref is populated by the map `mousemove` listener installed
  // below, and cleared when build mode exits.
  const routePreviewCursorRef = useRef<{ x: number; y: number } | null>(null);
  // Keep the build-mode handle on a ref too so the global `keydown`/`click`
  // listeners read the live value without a dependency-array dance.
  const routeBuildModeRef = useRef(routeBuildMode);
  routeBuildModeRef.current = routeBuildMode;

  const [modalOpen, setModalOpen] = useState(false);
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  const [elementsListOpen, setElementsListOpen] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [previewBox, setPreviewBox] = useState<{ width: number; height: number }>({
    width: 1600,
    height: 900,
  });

  // Hard-fit preview to an exact 16:9 frame using the real available stage area.
  // This avoids CSS max-height distortions where width stays full while height is clamped,
  // which was causing non-16:9 preview under some viewport sizes/zoom levels.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const update = (): void => {
      const cs = window.getComputedStyle(stage);
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      const availW = Math.max(1, stage.clientWidth - padX);
      const availH = Math.max(1, stage.clientHeight - padY);

      const hFromW = availW * (9 / 16);
      const useWidthConstraint = hFromW <= availH;
      const width = useWidthConstraint ? availW : availH * (16 / 9);
      const height = useWidthConstraint ? hFromW : availH;

      setPreviewBox({ width: Math.round(width), height: Math.round(height) });
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(stage);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  useCameraBreathingPreview(
    mapRef,
    videoSettings.cameraBreathing,
    videoSettings.cameraBreathingReferenceZoom
  );

  const videoModalOpenRef = useRef(false);
  videoModalOpenRef.current = videoModalOpen;

  // Font bootstrap. Safe to call more than once — loadAppFonts() memoises.
  useEffect(() => {
    loadAppFonts().catch(() => undefined);
  }, []);

  // Autofit on point add: compare previous vs current point count; if we
  // grew, recompute the viewport. Using a ref so we don't trigger on
  // setTheme or any other unrelated state change.
  const prevPointCountRef = useRef(0);
  useEffect(() => {
    const count = elements.filter((e) => e.kind === 'point').length;
    if (count > prevPointCountRef.current) {
      const map = mapRef.current;
      if (map) {
        const plan = computeResetView(elements);
        if (plan.kind === 'center' && plan.center) {
          map.flyTo({ center: plan.center, zoom: 10, duration: 800 });
        } else if (plan.kind === 'bounds' && plan.bounds) {
          map.fitBounds(plan.bounds, { padding: 100, duration: 800, maxZoom: 12 });
        }
      }
    }
    prevPointCountRef.current = count;
  }, [elements, mapRef]);

  // === task12+task6: Esc closes overlays AND cancels route-build mode.
  //     Only acts when the AddPointModal is closed (the modal has its own
  //     Esc handler with stopPropagation — we still guard here in case it
  //     ever slips through). We read live state via refs/setters, not
  //     through closure, so the dep list stays empty and this listener
  //     attaches once per mount.
  //
  //     Precedence: build mode > selection/elements list. In build mode
  //     Esc only cancels the build (so the user can Esc out of a
  //     half-built route without also closing the Elements dropdown that
  //     might have been opened first).
  const modalOpenRef = useRef(modalOpen);
  modalOpenRef.current = modalOpen;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (modalOpenRef.current) return;
      if (videoModalOpenRef.current) {
        e.preventDefault();
        setVideoModalOpen(false);
        return;
      }
      if (routeBuildModeRef.current !== null) {
        setRouteBuildMode(null);
        routePreviewCursorRef.current = null;
        return;
      }
      setElementsListOpen(false);
      selectElement(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectElement, setRouteBuildMode]);

  const openVideoSettings = useCallback(() => {
    setVideoModalOpen(true);
  }, []);

  const dismissVideoSettings = useCallback(() => {
    setVideoModalOpen(false);
  }, []);

  const saveVideoSettings = useCallback(
    (next: VideoSettings) => {
      commitVideoSettings(next);
      setVideoModalOpen(false);
    },
    [commitVideoSettings]
  );

  const pollFailCount = useRef(0);

  const pollRenderOnce = useCallback(async () => {
    const id = jobIdRef.current;
    if (!id) return;
    try {
      const s = await getRenderStatus(id);
      pollFailCount.current = 0;
      setRenderProgress(s.progress);
      if (s.status === 'done') {
        setRenderJobId(null);
        if (s.downloadUrl) {
          const a = document.createElement('a');
          a.href = s.downloadUrl;
          a.click();
          showToast({ type: 'success', message: 'Видео успешно создано и скачано.' });
        } else {
          showToast({ type: 'success', message: 'Видео создано. Скачайте из «Моя история».' });
        }
      } else if (s.status === 'error') {
        setRenderJobId(null);
        showToast({
          type: 'error',
          message: s.error || 'Ошибка рендера. Попробуйте ещё раз.',
        });
      }
    } catch {
      pollFailCount.current += 1;
      if (pollFailCount.current === 5) {
        showToast({ type: 'warning', message: 'Потеряна связь с сервером. Проверяем…' });
      }
      if (pollFailCount.current >= 15) {
        setRenderJobId(null);
        showToast({ type: 'error', message: 'Связь потеряна. Проверьте рендер в «Моя история».' });
      }
    }
  }, [showToast]);

  useEffect(() => {
    if (!renderJobId) return;
    void pollRenderOnce();
    const t = window.setInterval(() => {
      void pollRenderOnce();
    }, 2000);
    return () => clearInterval(t);
  }, [renderJobId, pollRenderOnce]);

  useEffect(() => {
    void getActiveRender()
      .then((r) => {
        if (!r.active) return;
        if (r.active.status === 'queued' || r.active.status === 'running') {
          setRenderJobId(r.active.id);
          setRenderProgress(r.active.progress);
        }
      })
      .catch(() => {
        /* офлайн / тест без бэка — не поднимаем активный рендер */
      });
  }, []);

  const handleSaveVideo = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    const unresolvedRoadRoutes = elements.filter(
      (el) =>
        el.kind === 'route' &&
        el.settings.useRoadRoute &&
        !el.osrmCoordinates &&
        !osrmFailedRoutes.current.has(el.id)
    ).length;

    if (pendingOsrmCount > 0 || unresolvedRoadRoutes > 0) {
      showToast({
        type: 'warning',
        message: 'Подождите завершения построения маршрутов по дороге перед рендером.',
      });
      return;
    }

    if (geoTitle.enabled && geoTitle.text.trim().length === 0) {
      showToast({
        type: 'error',
        message: 'Введите текст GEO титра перед запуском рендера.',
      });
      return;
    }

    const state = serializeMapState(elements, map, videoSettings, geoTitle, {
      previewFrame: {
        widthPx: previewBox.width,
        heightPx: previewBox.height,
      },
      devicePixelRatio: window.devicePixelRatio || 1,
      pageZoom: window.visualViewport?.scale || 1,
    });
    void (async () => {
      try {
        const { jobId } = await postRender(state);
        setRenderJobId(jobId);
        setRenderProgress(0);
      } catch (e: unknown) {
        const ax = e instanceof AxiosError ? e : null;
        const code = ax?.response?.status;
        const msg = (ax?.response?.data as { error?: string } | undefined)?.error;
        showToast({
          type: 'error',
          message: msg ?? (code === 429 ? 'Очередь занята' : 'Не удалось запустить рендер'),
        });
      }
    })();
  }, [elements, geoTitle, mapRef, videoSettings, showToast, pendingOsrmCount, previewBox]);

  // task6: "which element (point only) is under these screen pixels?" —
  // used both by route-build click handling and by the mousemove preview.
  // We filter to `kind==='point'` because SPEC only lets the user start/end
  // routes on marked points; clicking a label in build mode should behave
  // like clicking empty map.
  const pickPointIdAt = useCallback(
    (x: number, y: number): string | null => {
      for (let i = hitRegistry.targets.length - 1; i >= 0; i--) {
        const t = hitRegistry.targets[i];
        if (t.kind !== 'point') continue;
        if (t.hit.shape === 'circle') {
          const dx = x - t.x;
          const dy = y - t.y;
          if (dx * dx + dy * dy <= t.hit.radius * t.hit.radius) return t.id;
        }
      }
      return null;
    },
    [hitRegistry]
  );

  // === task12+task6: click on map. In normal mode a click on empty space
  //     closes overlays (selection + Elements dropdown). In route-build
  //     mode the same click *either* picks start/end points *or* ends the
  //     route at the clicked coordinates. We intentionally *don't* use the
  //     hit-registry pickTarget for the "close overlays" path because if
  //     a user clicks on an element, `use-element-drag` already calls
  //     selectElement(id) on mousedown, and MapLibre's subsequent click
  //     would then close the same panel we just opened.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onClick = (e: import('maplibre-gl').MapMouseEvent) => {
      const { x, y } = e.point;

      // --- task6: route build mode ---
      const build = routeBuildModeRef.current;
      if (build !== null) {
        const pointId = pickPointIdAt(x, y);
        if (!pointId) {
          if (build.waypointIds.length === 0) return;
          const coords = pixelsToCoordinates(x, y);
          if (!coords) return;
          if (build.routeId) {
            updateRouteEndCoordinates(build.routeId, coords);
            selectElement(build.routeId);
          } else {
            const startPointId = build.waypointIds[0];
            const routeId = addRoute({
              startPointId,
              end: { type: 'coordinates', coordinates: coords },
            });
            selectElement(routeId);
          }
          setRouteBuildMode(null);
          routePreviewCursorRef.current = null;
          return;
        }
        if (build.waypointIds.length === 0) {
          setRouteBuildMode({ waypointIds: [pointId], routeId: null });
          return;
        }
        const lastPointId = build.waypointIds[build.waypointIds.length - 1];
        if (pointId === lastPointId) return;
        const nextWaypoints = [...build.waypointIds, pointId];
        if (build.routeId) {
          updateRouteWaypoints(build.routeId, nextWaypoints);
          setRouteBuildMode({ waypointIds: nextWaypoints, routeId: build.routeId });
          selectElement(build.routeId);
          return;
        }
        const routeId = addRoute({
          startPointId: nextWaypoints[0],
          end: { type: 'point', pointId },
          waypoints: nextWaypoints,
        });
        setRouteBuildMode({ waypointIds: nextWaypoints, routeId });
        selectElement(routeId);
        return;
      }

      // --- Normal mode: close overlays if click landed on empty space. ---
      for (let i = hitRegistry.targets.length - 1; i >= 0; i--) {
        const t = hitRegistry.targets[i];
        if (t.hit.shape === 'circle') {
          const dx = x - t.x;
          const dy = y - t.y;
          if (dx * dx + dy * dy <= t.hit.radius * t.hit.radius) return;
        } else if (t.hit.shape === 'rect') {
          if (
            x >= t.x - t.hit.halfW &&
            x <= t.x + t.hit.halfW &&
            y >= t.y - t.hit.halfH &&
            y <= t.y + t.hit.halfH
          ) {
            return;
          }
        }
        // polyline (routes): treat clicks on the line itself as "empty"
        // for panel-dismissal purposes; explicit route selection happens
        // through the Elements list (task6 v1 SPEC).
      }
      setElementsListOpen(false);
      selectElement(null);
    };
    map.on('click', onClick);
    return () => {
      map.off('click', onClick);
    };
  }, [
    mapRef,
    hitRegistry,
    selectElement,
    setRouteBuildMode,
    addRoute,
    updateRouteWaypoints,
    updateRouteEndCoordinates,
    pickPointIdAt,
    pixelsToCoordinates,
  ]);

  // === task6: mousemove → preview line from start-point to cursor. We
  //     only care about the live pixel position; PixiLayer reads the ref
  //     on every render tick and draws accordingly.
  useEffect(() => {
    if (routeBuildMode === null) {
      routePreviewCursorRef.current = null;
      return;
    }
    const map = mapRef.current;
    if (!map) return;
    const onMove = (e: import('maplibre-gl').MapMouseEvent) => {
      routePreviewCursorRef.current = { x: e.point.x, y: e.point.y };
    };
    const onLeave = () => {
      routePreviewCursorRef.current = null;
    };
    map.on('mousemove', onMove);
    map.on('mouseout', onLeave);
    return () => {
      map.off('mousemove', onMove);
      map.off('mouseout', onLeave);
      routePreviewCursorRef.current = null;
    };
  }, [routeBuildMode, mapRef]);

  // === task6: fetch OSRM geometry for every route that wants a road path
  //     but hasn't got a cached one yet. Runs whenever `elements` or the
  //     relevant settings change; `setRouteOsrmCoordinates` makes the call
  //     idempotent since the next render will find coords populated and
  //     skip the fetch. If OSRM returns fallback:true we keep
  //     osrmCoordinates=null so PixiLayer falls back to the straight path
  //     (avoids storing a "fake" road path that's actually a duplicate of
  //     start/end).
  useEffect(() => {
    const cancelled = new Set<string>();
    const markPending = (routeId: string): void => {
      if (pendingOsrmRoutes.current.has(routeId)) return;
      pendingOsrmRoutes.current.add(routeId);
      setPendingOsrmCount(pendingOsrmRoutes.current.size);
    };
    const unmarkPending = (routeId: string): void => {
      if (!pendingOsrmRoutes.current.has(routeId)) return;
      pendingOsrmRoutes.current.delete(routeId);
      setPendingOsrmCount(pendingOsrmRoutes.current.size);
    };

    for (const el of elements) {
      if (el.kind !== 'route') continue;
      if (!el.settings.useRoadRoute) continue;
      if (el.osrmCoordinates) continue;
      if (pendingOsrmRoutes.current.has(el.id)) continue;
      const pointById = new Map<string, LngLat>();
      for (const item of elements) {
        if (item.kind === 'point') pointById.set(item.id, item.coordinates);
      }
      const legCoords: Array<{ start: LngLat; end: LngLat }> = [];
      if (el.waypoints && el.waypoints.length >= 2) {
        const chain = el.waypoints
          .map((pointId) => pointById.get(pointId) ?? null)
          .filter((c): c is LngLat => c !== null);
        if (chain.length < 2) continue;
        for (let i = 0; i < chain.length - 1; i++) {
          legCoords.push({ start: chain[i], end: chain[i + 1] });
        }
        if (el.end.type === 'coordinates') {
          legCoords.push({ start: chain[chain.length - 1], end: el.end.coordinates });
        }
      } else {
        const startPoint = pointById.get(el.start.pointId);
        if (!startPoint) continue;
        let endCoords: LngLat | null = null;
        if (el.end.type === 'point') {
          endCoords = pointById.get(el.end.pointId) ?? null;
        } else {
          endCoords = el.end.coordinates;
        }
        if (!endCoords) continue;
        legCoords.push({ start: startPoint, end: endCoords });
      }
      const routeId = el.id;
      markPending(routeId);
      osrmFailedRoutes.current.delete(routeId);
      Promise.all(legCoords.map((leg) => fetchRoute(leg.start, leg.end)))
        .then((result) => {
          if (cancelled.has(routeId)) {
            unmarkPending(routeId);
            return;
          }
          const hasFallback = result.some((leg) => leg.fallback);
          if (hasFallback) {
            osrmFailedRoutes.current.add(routeId);
            setRouteOsrmCoordinates(routeId, null);
            setRouteOsrmLegsCoordinates(routeId, null);
            if (!osrmWarningShown.current.has(routeId)) {
              osrmWarningShown.current.add(routeId);
              showToast({
                type: 'warning',
                message: 'Маршрут по дороге временно недоступен. Построена прямая линия.',
              });
            }
            unmarkPending(routeId);
            return;
          }
          const legs = result.map((leg) => leg.coordinates);
          const merged: LngLat[] = [];
          for (let i = 0; i < legs.length; i++) {
            const leg = legs[i];
            if (i === 0) merged.push(...leg);
            else merged.push(...leg.slice(1));
          }
          osrmFailedRoutes.current.delete(routeId);
          setRouteOsrmCoordinates(routeId, merged);
          setRouteOsrmLegsCoordinates(routeId, legs);
          unmarkPending(routeId);
        })
        .catch(() => {
          if (cancelled.has(routeId)) {
            unmarkPending(routeId);
            return;
          }
          osrmFailedRoutes.current.add(routeId);
          setRouteOsrmCoordinates(routeId, null);
          setRouteOsrmLegsCoordinates(routeId, null);
          if (!osrmWarningShown.current.has(routeId)) {
            osrmWarningShown.current.add(routeId);
            showToast({
              type: 'warning',
              message: 'Маршрут по дороге временно недоступен. Построена прямая линия.',
            });
          }
          unmarkPending(routeId);
        });
    }
    return () => {
      for (const el of elements) {
        if (el.kind !== 'route') continue;
        cancelled.add(el.id);
      }
    };
  }, [elements, setRouteOsrmCoordinates, setRouteOsrmLegsCoordinates, showToast]);

  // Selecting an element should never leave the Elements dropdown
  // half-open over it. Auto-collapse whenever a new selection lands so
  // the RightSidebar has unobstructed space on the left half of the
  // screen. No-op if already closed.
  useEffect(() => {
    if (selectedElementId !== null) setElementsListOpen(false);
  }, [selectedElementId]);

  const handleAddPointSubmit = useCallback(
    (input: { label: string; coordinates: { lng: number; lat: number }; originalText: string }) => {
      addPoint(input);
    },
    [addPoint]
  );

  return (
    <>
      <div
        className={`editor-page${
          routeBuildMode !== null ? ' editor-page--route-build' : ''
        }${renderInProgress ? ' editor-page--rendering' : ''}`}
      >
        <Header />
        <div className="editor-page__body">
          <div className="editor-page__stage" ref={stageRef}>
            <div
              className="editor-page__preview"
              style={{ width: `${previewBox.width}px`, height: `${previewBox.height}px` }}
            >
              <EditorMap />
              <PixiLayer
                hitRegistry={hitRegistry}
                routePreviewCursorRef={routePreviewCursorRef}
              />
              <ElementsList
                open={elementsListOpen}
                onToggle={() => setElementsListOpen((v) => !v)}
              />
              <RightSidebar />
              <ResetViewButton />
              <ResetBearingButton />
              <GeoTitleOverlay
                geoTitle={geoTitle}
                frameWidth={previewBox.width}
                frameHeight={previewBox.height}
              />
              {routeBuildMode !== null && (
                <div className="route-build-hint" role="status">
                  {routeBuildMode.waypointIds.length === 0
                    ? 'Нажмите на начальную точку маршрута'
                    : `Добавляйте точки маршрута (${routeBuildMode.waypointIds.length}) • Esc/↗ — завершить`}
                </div>
              )}
              {renderInProgress && (
                <div className="render-progress-overlay" role="status" aria-live="polite">
                  <div className="render-progress-overlay__bar" style={{ width: `${renderProgress}%` }} />
                  <p className="render-progress-overlay__text">Рендер видео: {renderProgress}%</p>
                </div>
              )}
            </div>
          </div>
        </div>
        <BottomToolbar
          onAddPoint={() => setModalOpen(true)}
          onOpenVideoSettings={openVideoSettings}
          onSaveVideo={handleSaveVideo}
          saveBlocked={geoTitle.enabled && geoTitle.text.trim().length === 0}
          saveBlockedReason="Введите текст GEO титра"
          renderInProgress={renderInProgress}
          renderProgress={renderProgress}
        />
      </div>

      <AddPointModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={handleAddPointSubmit}
        getMapCenter={() => {
          const m = mapRef.current;
          if (!m) return null;
          const c = m.getCenter();
          return { lng: c.lng, lat: c.lat };
        }}
      />
      <VideoSettingsModal
        open={videoModalOpen}
        onCancel={dismissVideoSettings}
        onSave={saveVideoSettings}
      />
    </>
  );
}
