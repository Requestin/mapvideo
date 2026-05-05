import { useEffect, useRef, type MutableRefObject } from 'react';
import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { useEditorState } from '../state/editor-state';
import { useEditorMap } from '../hooks/use-editor-map';
import type {
  MapElement,
  MapLabel,
  MapPoint,
  MapRoute,
  RouteSettings,
} from '../state/types';
import { createPointAnimation, type PointAnimation } from './animations';
import { createLabel, type LabelRender } from './label-renderer';
import { computeZoomScale } from './zoom-scale';
import { createRouteRender, type RouteRender } from './routes/route-render';
import {
  bucketRouteZoom,
  computeRouteLegsLngLat,
  flattenRouteLegs,
  simplifyLngLatPathForZoom,
} from './routes/path';
import { getAnimationTimeMs, isRenderCaptureMode } from './render-time';

// Persistent per-element record stored outside React so we can rebuild
// containers in-place when settings change without dropping a frame.
interface PointRecord {
  kind: 'point';
  anim: PointAnimation;
  settings: MapPoint['settings'];
  coordinates: MapPoint['coordinates'];
  /** Live gsap tween used to implement flash (alpha pulse). Kept so a
   *  second flash request interrupts the first cleanly rather than
   *  stacking three overlapping tweens. */
  flashTween?: gsap.core.Tween | gsap.core.Timeline | null;
}
interface LabelRecord {
  kind: 'label';
  render: LabelRender;
  settings: MapLabel['settings'];
  originalText: string;
  coordinates: MapLabel['coordinates'];
  flashTween?: gsap.core.Tween | gsap.core.Timeline | null;
}
interface RouteRecord {
  kind: 'route';
  render: RouteRender;
  /** Pinned reference to the MapRoute from state — read on every sync so
   *  the redraw loop sees fresh `osrmCoordinates` without re-running the
   *  reconcile effect. */
  route: MapRoute;
  /** Settings identity from the last reconcile; used to detect when to
   *  rebuild the render (e.g. icon type changed). */
  settings: RouteSettings;
  simplifiedLegs: { lng: number; lat: number }[][] | null;
  /** Memoized simplified path for current zoom bucket + source signature. */
  simplifiedPath: { lng: number; lat: number }[] | null;
  simplifyCacheKey: string | null;
  flashTween?: gsap.core.Tween | gsap.core.Timeline | null;
}
type Record = PointRecord | LabelRecord | RouteRecord;

export interface HitTarget {
  id: string;
  kind: 'point' | 'label' | 'route';
  /** Screen coord of the element centre at the last sync. */
  x: number;
  y: number;
  /** Circle for points, rectangle for labels. Dimensions already include
   *  the current zoom-scale, so `use-element-drag`/`use-element-hover`
   *  can treat the registry as pixel-space without re-applying scale.
   *  Routes use `polyline` — the drag/hover controllers today ignore this
   *  kind; we still register it so the future "click on a route line to
   *  select" story has the data it needs. */
  hit:
    | { shape: 'circle'; radius: number }
    | { shape: 'rect'; halfW: number; halfH: number }
    | { shape: 'polyline'; points: { x: number; y: number }[]; halfThickness: number };
}

/** External hit-test registry consumed by `use-element-drag`. Updated on
 *  every `move`/`zoom`/`render` tick of MapLibre. */
export interface HitRegistry {
  targets: HitTarget[];
}

// Hover-ring styling. Bright white stroke + soft alpha reads on both the
// dark and light themes. Radius padding is additive so labels (rectangles)
// don't end up with a ring identical to their text height.
const HOVER_RING_COLOR = 0xffffff;
const HOVER_RING_ALPHA = 0.9;
const HOVER_RING_THICKNESS = 2;
const HOVER_RING_PAD = 6;

export interface PixiLayerProps {
  hitRegistry: HitRegistry;
  /** Live pointer position in preview-pixel coords while route-build mode
   *  is active. `null` means "cursor hasn't entered the map yet" or "mode
   *  inactive". Lives in a ref, not state, so 60 FPS mousemove doesn't
   *  re-render PixiLayer. */
  routePreviewCursorRef?: MutableRefObject<{ x: number; y: number } | null>;
}

declare global {
  interface Window {
    /** Render-page hook: rebuild only PIXI label text objects after fonts load. */
    __refreshLabelRenders?: () => void;
  }
}

// <PixiLayer> is a headless component — it renders no DOM. It subscribes
// to editor state and the shared Pixi application, creating/updating
// PIXI.Containers to match the state array. Position sync is driven by
// MapLibre's `render` event so the Pixi layer is glued to the map even
// during inertial pan; additionally a Pixi ticker drives route/animation
// redraws so pulse + dash + transport icons keep moving when the map is
// still.
export function PixiLayer({
  hitRegistry,
  routePreviewCursorRef,
}: PixiLayerProps): null {
  const { elements, hoveredElementId, routeBuildMode, videoSettings } = useEditorState();
  const { mapRef, pixiRef, onFlash } = useEditorMap();

  // Latest elements snapshot, read inside the map `render` listener so
  // position updates don't stale-closure on the initial array.
  const elementsRef = useRef(elements);
  elementsRef.current = elements;

  // Hover id is read from the map render loop — use a ref to avoid
  // re-subscribing the `render` listener on every pointer move.
  const hoveredIdRef = useRef<string | null>(hoveredElementId);
  hoveredIdRef.current = hoveredElementId;

  // Build-mode handle for the preview-line drawing. Ref, not state, so
  // changes don't re-subscribe the Pixi ticker.
  const routeBuildModeRef = useRef(routeBuildMode);
  routeBuildModeRef.current = routeBuildMode;

  // Per-element live handles, keyed by element id.
  const recordsRef = useRef(new Map<string, Record>());

  // Overlay ring rendered on top of all elements when any element is hovered.
  // Lives for the lifetime of PixiLayer; positioned in syncPositions.
  const hoverRingRef = useRef<PIXI.Graphics | null>(null);
  // task6: preview line for route-build mode. Lives alongside hoverRing so
  // both are on top of all element records.
  const routePreviewGraphicsRef = useRef<PIXI.Graphics | null>(null);

  // === 1. Reconcile: for every element in state, ensure a Pixi record
  //       exists and its visuals match the current settings. Destroy any
  //       records whose element was removed.
  useEffect(() => {
    const pixi = pixiRef.current;
    // Та же защита, что в эффекте hover-ring: destroyed Application имеет
    // `stage === null`, любой `stage.addChild` после этого кидает TypeError
    // и рушит всё поддерево EditorPage.
    if (!pixi || !pixi.stage) return;
    const stage = pixi.stage;
    const records = recordsRef.current;
    const seen = new Set<string>();

    for (const el of elements) {
      seen.add(el.id);
      const existing = records.get(el.id);

      if (el.kind === 'point') {
        if (existing && existing.kind === 'point' && existing.settings === el.settings) {
          existing.coordinates = el.coordinates;
          continue;
        }
        if (existing) {
          existing.flashTween?.kill();
          stage.removeChild(
            existing.kind === 'point' ? existing.anim.container : existing.render.container
          );
          if (existing.kind === 'point') existing.anim.dispose();
          else existing.render.dispose();
        }
        const anim = createPointAnimation(el.settings);
        stage.addChild(anim.container);
        records.set(el.id, {
          kind: 'point',
          anim,
          settings: el.settings,
          coordinates: el.coordinates,
          flashTween: null,
        });
      } else if (el.kind === 'label') {
        if (
          existing &&
          existing.kind === 'label' &&
          existing.settings === el.settings &&
          existing.originalText === el.originalText
        ) {
          existing.coordinates = el.coordinates;
          continue;
        }
        if (existing) {
          existing.flashTween?.kill();
          stage.removeChild(containerOf(existing));
          disposeRecord(existing);
        }
        const render = createLabel(el.originalText, el.settings);
        stage.addChild(render.container);
        records.set(el.id, {
          kind: 'label',
          render,
          settings: el.settings,
          originalText: el.originalText,
          coordinates: el.coordinates,
          flashTween: null,
        });
      } else if (el.kind === 'route') {
        if (existing && existing.kind === 'route' && existing.settings === el.settings) {
          // Settings identity unchanged — just refresh the pinned route ref
          // so the ticker reads fresh endpoint coords / osrmCoordinates.
          existing.route = el;
          continue;
        }
        if (existing) {
          existing.flashTween?.kill();
          stage.removeChild(containerOf(existing));
          disposeRecord(existing);
        }
        const render = createRouteRender(el.settings);
        // Routes draw *under* points/labels so dragging a point stays
        // visually on top. sortableChildren on the stage uses zIndex —
        // points/labels default to 0, which is what we want; routes use -1.
        render.container.zIndex = -1;
        stage.sortableChildren = true;
        stage.addChild(render.container);
        records.set(el.id, {
          kind: 'route',
          render,
          route: el,
          settings: el.settings,
          simplifiedLegs: null,
          simplifiedPath: null,
          simplifyCacheKey: null,
          flashTween: null,
        });
      }
    }

    // Remove records for elements that are no longer in state.
    for (const [id, rec] of records) {
      if (seen.has(id)) continue;
      rec.flashTween?.kill();
      stage.removeChild(containerOf(rec));
      disposeRecord(rec);
      records.delete(id);
    }

    // Trigger an immediate position sync so newly added elements aren't
    // parked at (0,0) for a frame.
    syncPositions(
      records,
      elementsRef.current,
      mapRef.current,
      hitRegistry,
      hoverRingRef.current,
      hoveredIdRef.current,
      routePreviewGraphicsRef.current,
      routeBuildModeRef.current,
      routePreviewCursorRef?.current ?? null,
      videoSettings.duration,
      getAnimationTimeMs()
    );
  }, [elements, pixiRef, mapRef, hitRegistry, routePreviewCursorRef, videoSettings.duration]);

  // === 2. Mount the hover ring + route-preview line once the Pixi app is
  //       available. Both kept on refs so syncPositions can read them
  //       without triggering re-runs.
  useEffect(() => {
    const pixi = pixiRef.current;
    // Под StrictMode ref может указывать на аппликацию, у которой уже
    // вызван `destroy()` — тогда `stage` === null и попытка повесить
    // кольцо ломает весь редактор. Лучше молча пропустить — на следующем
    // re-setup эффект получит живой pixi.
    if (!pixi || !pixi.stage) return;
    const ring = new PIXI.Graphics();
    ring.lineStyle(HOVER_RING_THICKNESS, HOVER_RING_COLOR, HOVER_RING_ALPHA);
    ring.drawCircle(0, 0, 1);
    ring.visible = false;
    // High z so ring draws over everything including the core/pulse pair.
    ring.zIndex = 9999;
    pixi.stage.sortableChildren = true;
    pixi.stage.addChild(ring);
    hoverRingRef.current = ring;

    // task6: route-build preview line — dashed, soft, sits above routes
    // but below the hover ring so the user can still see the target
    // point highlighted while constructing.
    const preview = new PIXI.Graphics();
    preview.visible = false;
    preview.zIndex = 9998;
    pixi.stage.addChild(preview);
    routePreviewGraphicsRef.current = preview;

    return () => {
      // Под StrictMode-овским double-invoke сосед по JSX (EditorMap) может
      // успеть вызвать `pixi.destroy(true, {children:true})` раньше нашего
      // cleanup — тогда `stage` === null, а сам `ring` уже уничтожен вместе
      // со всей сценой (PIXI обнулил его `_geometry`). В этом случае ни
      // `removeChild`, ни `ring.destroy()` звать не нужно: второй destroy
      // падает на `_geometry.refCount` и роняет весь редактор.
      if (pixi.stage) {
        pixi.stage.removeChild(ring);
        try { ring.destroy(); } catch { /* already destroyed */ }
        pixi.stage.removeChild(preview);
        try { preview.destroy(); } catch { /* already destroyed */ }
      }
      hoverRingRef.current = null;
      routePreviewGraphicsRef.current = null;
    };
  }, [pixiRef]);

  // === 3. Redraw the hover ring whenever the hovered id changes. The
  //       actual *position* is updated in syncPositions (so the ring
  //       follows pan/zoom), but we only need to flip visibility when
  //       the target changes.
  useEffect(() => {
    syncPositions(
      recordsRef.current,
      elementsRef.current,
      mapRef.current,
      hitRegistry,
      hoverRingRef.current,
      hoveredElementId,
      routePreviewGraphicsRef.current,
      routeBuildModeRef.current,
      routePreviewCursorRef?.current ?? null,
      videoSettings.duration,
      getAnimationTimeMs()
    );
  }, [hoveredElementId, mapRef, hitRegistry, routePreviewCursorRef, videoSettings.duration]);

  // === 4. Position sync on every map render/move/zoom + on every Pixi
  //       ticker tick (so route pulse/dash/transport-icon animations keep
  //       moving when the map is still). Both handlers funnel into the
  //       same syncPositions so we never double-book state reads.
  useEffect(() => {
    const map = mapRef.current;
    const pixi = pixiRef.current;
    if (!map) return;
    const handler = () =>
      syncPositions(
        recordsRef.current,
        elementsRef.current,
        map,
        hitRegistry,
        hoverRingRef.current,
        hoveredIdRef.current,
        routePreviewGraphicsRef.current,
        routeBuildModeRef.current,
        routePreviewCursorRef?.current ?? null,
        videoSettings.duration,
        getAnimationTimeMs()
      );
    map.on('render', handler);
    map.on('resize', handler);
    // task8: headless capture drives time via `__RENDER_TIME_MS__` and does
    // not need the global Pixi ticker (would desync with Puppeteer's per-frame
    // seeks). Normal editor: ticker keeps route animations moving when idle.
    const ticker = pixi?.ticker;
    if (ticker && !isRenderCaptureMode()) {
      ticker.add(handler);
    }
    handler(); // cold sync on mount
    return () => {
      map.off('render', handler);
      map.off('resize', handler);
      if (ticker) {
        // React StrictMode may run mount/unmount twice while Pixi internals
        // are already tearing down the listener list. In that window
        // `ticker.remove()` can throw on a null-linked node (`next`).
        // Best effort cleanup is enough here: the whole ticker is destroyed
        // with the Pixi app anyway.
        try {
          ticker.remove(handler);
        } catch {
          // noop: ticker/listener already disposed
        }
      }
    };
  }, [mapRef, pixiRef, hitRegistry, routePreviewCursorRef, videoSettings.duration]);

  // === 5. Flash bus subscription. A flash is 3 alpha pulses over ~1s.
  //       We hit the element's container alpha and restore to 1 on
  //       completion. gsap's `onComplete` handles the restore even if
  //       the tween is interrupted by a reconcile (we kill it there).
  useEffect(() => {
    const off = onFlash((id) => {
      const rec = recordsRef.current.get(id);
      if (!rec) return;
      const target = containerOf(rec);
      rec.flashTween?.kill();
      target.alpha = 1;
      const tl = gsap.timeline({
        onComplete: () => {
          target.alpha = 1;
        },
      });
      // Three blink cycles: 1 → 0.2 → 1. Total ~0.9s — long enough to
      // grab attention without feeling like a glitch.
      for (let i = 0; i < 3; i++) {
        tl.to(target, { alpha: 0.2, duration: 0.15, ease: 'power1.in' })
          .to(target, { alpha: 1, duration: 0.15, ease: 'power1.out' });
      }
      rec.flashTween = tl;
    });
    return off;
  }, [onFlash]);

  // === 6. Optional render-page hook: when fonts are loaded after initial
  // label creation, rebuild only label PIXI.Text instances without remounting
  // the whole layer (keeps route/breathing animation wiring intact).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const refresh = (): void => {
      const pixi = pixiRef.current;
      if (!pixi?.stage) return;
      const stage = pixi.stage;
      const records = recordsRef.current;
      for (const [id, rec] of records) {
        if (rec.kind !== 'label') continue;
        const oldContainer = rec.render.container;
        const oldIndex = stage.getChildIndex(oldContainer);
        stage.removeChild(oldContainer);
        rec.render.dispose();
        const render = createLabel(rec.originalText, rec.settings);
        stage.addChildAt(render.container, Math.min(oldIndex, stage.children.length));
        records.set(id, { ...rec, render });
      }
      syncPositions(
        records,
        elementsRef.current,
        mapRef.current,
        hitRegistry,
        hoverRingRef.current,
        hoveredIdRef.current,
        routePreviewGraphicsRef.current,
        routeBuildModeRef.current,
        routePreviewCursorRef?.current ?? null,
        videoSettings.duration,
        getAnimationTimeMs()
      );
    };
    window.__refreshLabelRenders = refresh;
    return () => {
      if (window.__refreshLabelRenders === refresh) {
        delete window.__refreshLabelRenders;
      }
    };
  }, [pixiRef, mapRef, hitRegistry, routePreviewCursorRef, videoSettings.duration]);

  // === 7. Teardown: on unmount, destroy all Pixi records. We leave the
  //       stage itself alone — EditorMap owns it. Под StrictMode сосед
  //       EditorMap обычно уже сделал `pixi.destroy(true, {children:true})`
  //       к этому моменту, поэтому сами контейнеры могут быть уже destroyed.
  //       Повторный destroy идемпотентен в PIXI 7, но try/catch всё равно
  //       нужен: на будущих версиях/кастомных dispose одна кривая тень
  //       не должна класть весь редактор.
  useEffect(() => {
    const records = recordsRef.current;
    return () => {
      for (const rec of records.values()) {
        try {
          rec.flashTween?.kill();
          disposeRecord(rec);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[PixiLayer] dispose failed (ignored):', err);
        }
      }
      records.clear();
    };
  }, []);

  return null;
}

function syncPositions(
  records: Map<string, Record>,
  elements: MapElement[],
  map: import('maplibre-gl').Map | null,
  hitRegistry: HitRegistry,
  hoverRing: PIXI.Graphics | null,
  hoveredId: string | null,
  routePreview: PIXI.Graphics | null,
  routeBuildMode: { waypointIds: string[]; routeId: string | null } | null,
  routePreviewCursor: { x: number; y: number } | null,
  videoDurationSec: number,
  timeMs: number
): void {
  if (!map) return;
  const zoom = map.getZoom();
  const zoomScale = computeZoomScale(zoom);
  const routeZoomBucket = bucketRouteZoom(zoom);
  const nextTargets: HitTarget[] = [];

  let hoveredTarget: HitTarget | null = null;

  for (const [id, rec] of records) {
    if (rec.kind === 'point') {
      const p = map.project([rec.coordinates.lng, rec.coordinates.lat]);
      rec.anim.container.position.set(p.x, p.y);
      rec.anim.container.scale.set(zoomScale);
      const target: HitTarget = {
        id,
        kind: 'point',
        x: p.x,
        y: p.y,
        hit: { shape: 'circle', radius: rec.anim.hitRadius * zoomScale },
      };
      nextTargets.push(target);
      if (id === hoveredId) hoveredTarget = target;
    } else if (rec.kind === 'label') {
      const p = map.project([rec.coordinates.lng, rec.coordinates.lat]);
      rec.render.container.position.set(p.x, p.y);
      rec.render.container.scale.set(zoomScale);
      const target: HitTarget = {
        id,
        kind: 'label',
        x: p.x,
        y: p.y,
        hit: {
          shape: 'rect',
          halfW: rec.render.hitHalfWidth * zoomScale,
          halfH: rec.render.hitHalfHeight * zoomScale,
        },
      };
      nextTargets.push(target);
      if (id === hoveredId) hoveredTarget = target;
    } else {
      // route
      const rawLegs = computeRouteLegsLngLat(rec.route, elements);
      const rawPath = flattenRouteLegs(rawLegs);
      const simplifyKey = `${routeZoomBucket}|${buildRoutePathSignature(rawPath)}`;
      if (rec.simplifyCacheKey !== simplifyKey) {
        rec.simplifiedLegs = rawLegs.map((leg) =>
          leg.length >= 2 ? simplifyLngLatPathForZoom(leg, routeZoomBucket) : leg
        );
        rec.simplifiedPath = flattenRouteLegs(rec.simplifiedLegs);
        rec.simplifyCacheKey = simplifyKey;
      }
      const path = rec.simplifiedPath ?? rawPath;
      if (path.length < 2) {
        rec.render.container.visible = false;
        continue;
      }
      rec.render.container.visible = true;
      // We redraw in the *screen* coordinate space, not via container
      // transform — a polyline expressed in lng/lat can't be scaled
      // correctly by a uniform zoomScale without map.project per frame.
      rec.render.container.position.set(0, 0);
      rec.render.container.scale.set(1);
      const pixels: { x: number; y: number }[] = new Array(path.length);
      for (let i = 0; i < path.length; i++) {
        const projected = map.project([path[i].lng, path[i].lat]);
        pixels[i] = { x: projected.x, y: projected.y };
      }
      const legsForIcons = (rec.simplifiedLegs ?? rawLegs)
        .filter((leg) => leg.length >= 2)
        .map((leg) =>
          leg.map((pt) => {
            const projected = map.project([pt.lng, pt.lat]);
            return { x: projected.x, y: projected.y };
          })
        );
      const endHasArrow = rec.route.end.type === 'coordinates';
      rec.render.redraw(pixels, timeMs, endHasArrow, videoDurationSec, legsForIcons);
      // Register a polyline hit-target — not consumed by drag/hover today
      // (SPEC doesn't require route-click selection from the canvas in v1)
      // but keeps the registry shape consistent for tests and future work.
      nextTargets.push({
        id,
        kind: 'route',
        x: pixels[0].x,
        y: pixels[0].y,
        hit: {
          shape: 'polyline',
          points: pixels,
          halfThickness: rec.render.hitHalfThickness * zoomScale,
        },
      });
    }
  }
  hitRegistry.targets = nextTargets;

  // task6: route-build preview line (start point → cursor). Only drawn when
  // the user has picked a start and the cursor is inside the preview.
  if (routePreview) {
    const build = routeBuildMode;
    const cursor = routePreviewCursor;
    const lastPointId = build?.waypointIds[build.waypointIds.length - 1] ?? null;
    if (lastPointId && cursor) {
      const start = elements.find(
        (e): e is MapPoint => e.id === lastPointId && e.kind === 'point'
      );
      if (start) {
        const sp = map.project([start.coordinates.lng, start.coordinates.lat]);
        routePreview.visible = true;
        routePreview.clear();
        // Dashed, 60% alpha so the target point is still legible through it.
        routePreview.lineStyle({
          width: 2,
          color: 0xffffff,
          alpha: 0.7,
          cap: PIXI.LINE_CAP.ROUND,
        });
        // Single-segment dashed — manually step every 10 px so we don't
        // pull the route-render's drawDashedPolyline into this path.
        const dx = cursor.x - sp.x;
        const dy = cursor.y - sp.y;
        const len = Math.hypot(dx, dy);
        const ux = len === 0 ? 0 : dx / len;
        const uy = len === 0 ? 0 : dy / len;
        const dash = 8;
        const gap = 6;
        const period = dash + gap;
        for (let t = 0; t < len; t += period) {
          const end = Math.min(t + dash, len);
          routePreview.moveTo(sp.x + ux * t, sp.y + uy * t);
          routePreview.lineTo(sp.x + ux * end, sp.y + uy * end);
        }
      } else {
        routePreview.visible = false;
      }
    } else {
      routePreview.visible = false;
    }
  }

  // Reposition/resize the hover ring to match the hovered target. We
  // rebuild the Graphics geometry on every sync — cheap for a single
  // circle, and avoids drift when switching between round (point) and
  // square (label) hit zones.
  if (hoverRing) {
    if (!hoveredTarget) {
      hoverRing.visible = false;
    } else {
      hoverRing.visible = true;
      hoverRing.position.set(hoveredTarget.x, hoveredTarget.y);
      hoverRing.clear();
      hoverRing.lineStyle(HOVER_RING_THICKNESS, HOVER_RING_COLOR, HOVER_RING_ALPHA);
      if (hoveredTarget.hit.shape === 'circle') {
        hoverRing.drawCircle(0, 0, hoveredTarget.hit.radius + HOVER_RING_PAD);
      } else if (hoveredTarget.hit.shape === 'rect') {
        const { halfW, halfH } = hoveredTarget.hit;
        hoverRing.drawRoundedRect(
          -halfW - HOVER_RING_PAD,
          -halfH - HOVER_RING_PAD,
          (halfW + HOVER_RING_PAD) * 2,
          (halfH + HOVER_RING_PAD) * 2,
          4
        );
      }
      // polyline: no hover ring yet — route hover support is task-v2.
    }
  }
}

// Shared helpers so the reconcile/teardown/flash paths don't have to
// hand-craft the same union-switch three times.
function containerOf(rec: Record): PIXI.Container {
  if (rec.kind === 'point') return rec.anim.container;
  if (rec.kind === 'label') return rec.render.container;
  return rec.render.container;
}
function disposeRecord(rec: Record): void {
  if (rec.kind === 'point') rec.anim.dispose();
  else rec.render.dispose();
}

// Exported for tests — reconstruction of position sync without mounting
// a real Pixi application.
export { syncPositions as __syncPositionsForTests };

function buildRoutePathSignature(path: { lng: number; lat: number }[]): string {
  if (path.length === 0) return '0';
  const first = path[0];
  const mid = path[Math.floor(path.length / 2)];
  const last = path[path.length - 1];
  return [
    path.length,
    first.lng.toFixed(6),
    first.lat.toFixed(6),
    mid.lng.toFixed(6),
    mid.lat.toFixed(6),
    last.lng.toFixed(6),
    last.lat.toFixed(6),
  ].join('|');
}
