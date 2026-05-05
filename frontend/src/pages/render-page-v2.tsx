import { useEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { EditorStateProvider } from '../state/editor-state';
import { EditorMapProvider } from '../hooks/use-editor-map';
import { EditorMap } from '../components/editor-map';
import { PixiLayer, type HitRegistry } from '../pixi/pixi-layer';
import { useEditorMap } from '../hooks/use-editor-map';
import { loadAppFonts } from '../services/fonts';
import type { MapStateV1 } from '../types/map-state';
import { DEFAULT_GEO_TITLE_SETTINGS, type MapElement } from '../state/types';
import { computeBreathingZoom } from '../utils/camera-breathing';
import { normalizeZoomForRenderV2 } from '../utils/render-camera-normalization';
import './render-page.css';

const stateFetchInflight = new Map<string, Promise<MapStateV1>>();
const RENDER_READY_MAX_WAIT_MS = 5000;

function storageKey(jobId: string): string {
  return `mapvideo_render_state_${jobId}`;
}

async function waitForMapIdle(map: {
  loaded: () => boolean;
  once: (event: 'idle' | 'load', cb: () => void) => void;
}): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false;
    const done = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const timeout = window.setTimeout(done, RENDER_READY_MAX_WAIT_MS);
    const onIdle = (): void => {
      window.clearTimeout(timeout);
      done();
    };
    if (!map.loaded()) {
      map.once('load', () => map.once('idle', onIdle));
      return;
    }
    map.once('idle', onIdle);
  });
}

function InstallWindowApiV2({
  breathingStrength,
  breathingReferenceZoom,
  requiredFonts,
}: {
  breathingStrength: number;
  breathingReferenceZoom: number;
  requiredFonts: Array<{ family: string; weight: number }>;
}): null {
  const { mapRef, pixiRef } = useEditorMap();
  const installed = useRef(false);

  useEffect(() => {
    if (installed.current) return;
    const id = window.setInterval(() => {
      const map = mapRef.current;
      const pixi = pixiRef.current;
      if (!map || !pixi) return;
      clearInterval(id);
      if (installed.current) return;
      installed.current = true;

      const w = window as unknown as {
        mapInstance: typeof map;
        pixiApp: typeof pixi;
        __applyRenderTimeSec?: (s: number) => void;
        __applyRenderTimeSecV2?: (s: number) => void;
        mapReadyV2?: boolean;
        mapReadyV2Error?: string;
        __refreshLabelRenders?: () => void;
      };

      const applyRenderTime = (sec: number): void => {
        window.__RENDER_TIME_MS__ = sec * 1000;
        // Render V2 is frame-driven by backend (targetSec per frame). Keep GSAP
        // on the exact same clock; real-time ticker progression causes jitter.
        gsap.globalTimeline.time(sec, false);
        map.setZoom(computeBreathingZoom(breathingReferenceZoom, breathingStrength, sec));
        map.triggerRepaint();
        requestAnimationFrame(() => {
          pixi.renderer.render(pixi.stage);
        });
      };

      w.mapInstance = map;
      w.pixiApp = pixi;
      w.__applyRenderTimeSecV2 = applyRenderTime;
      // Keep compatibility for old tooling expecting legacy name.
      w.__applyRenderTimeSec = applyRenderTime;

      void (async () => {
        try {
          // Freeze GSAP real-time clock in capture mode; we control playhead
          // manually via applyRenderTime(sec) for deterministic animation.
          gsap.ticker.sleep();
          gsap.globalTimeline.pause(0);
          w.mapReadyV2 = false;
          delete w.mapReadyV2Error;
          await loadAppFonts();
          await document.fonts.ready;
          if (typeof document !== 'undefined' && 'fonts' in document && requiredFonts.length > 0) {
            await Promise.all(
              requiredFonts.map((f) => document.fonts.load(`${f.weight} 16px "${f.family}"`))
            );
            await document.fonts.ready;
            for (const f of requiredFonts) {
              if (!document.fonts.check(`${f.weight} 16px "${f.family}"`)) {
                throw new Error(`Required font not available: ${f.family} (${f.weight})`);
              }
            }
            if (typeof w.__refreshLabelRenders === 'function') {
              w.__refreshLabelRenders();
              await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            }
          }
          await waitForMapIdle(map);
          applyRenderTime(0);
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          w.mapReadyV2 = true;
        } catch (err) {
          w.mapReadyV2Error = err instanceof Error ? err.message : String(err);
          // eslint-disable-next-line no-console
          console.error('[render-page-v2] fonts/map init failed', err);
        }
      })();
    }, 16);

    return () => {
      clearInterval(id);
      gsap.ticker.wake();
    };
  }, [mapRef, pixiRef, breathingReferenceZoom, breathingStrength, requiredFonts]);

  return null;
}

function resolvePreviewWidthPx(state: MapStateV1): number {
  const width = state.render?.previewFrame.widthPx;
  if (width && Number.isFinite(width) && width > 0) return width;
  return 1920;
}

function resolveInitialZoom(state: MapStateV1): number {
  return normalizeZoomForRenderV2(state.map.zoom, resolvePreviewWidthPx(state));
}

function resolveBreathingReferenceZoom(state: MapStateV1): number {
  const source = state.video.cameraBreathingReferenceZoom ?? state.map.zoom;
  return normalizeZoomForRenderV2(source, resolvePreviewWidthPx(state));
}

function collectRequiredLabelFonts(state: MapStateV1): Array<{ family: string; weight: number }> {
  const out = new Map<string, { family: string; weight: number }>();
  for (const el of state.elements) {
    if (!el || typeof el !== 'object') continue;
    const e = el as {
      kind?: unknown;
      settings?: { fontFamily?: unknown; fontWeight?: unknown };
    };
    if (e.kind !== 'label') continue;
    const family = typeof e.settings?.fontFamily === 'string' ? e.settings.fontFamily.trim() : '';
    const weightRaw = e.settings?.fontWeight;
    const weight = typeof weightRaw === 'number' && Number.isFinite(weightRaw) ? weightRaw : 400;
    if (!family) continue;
    const key = `${family}|${weight}`;
    if (!out.has(key)) out.set(key, { family, weight });
  }
  return [...out.values()];
}

function RenderInnerV2({ state }: { state: MapStateV1 }): JSX.Element {
  const hitRegistry = useMemo<HitRegistry>(() => ({ targets: [] }), []);
  const requiredFonts = useMemo(() => collectRequiredLabelFonts(state), [state]);
  if (typeof window !== 'undefined') {
    window.__RENDER_CAPTURE__ = true;
  }

  return (
    <>
      <EditorMap
        renderMode
        initialCenter={[state.map.center.lng, state.map.center.lat]}
        initialZoom={resolveInitialZoom(state)}
        initialBearing={state.map.bearing}
        initialPitch={state.map.pitch}
      />
      <PixiLayer hitRegistry={hitRegistry} />
      <InstallWindowApiV2
        breathingStrength={Math.max(0, state.video.cameraBreathing)}
        breathingReferenceZoom={resolveBreathingReferenceZoom(state)}
        requiredFonts={requiredFonts}
      />
    </>
  );
}

export function RenderPageV2(): JSX.Element {
  const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
  const jobId = params.get('job_id');
  const token = params.get('render_token');
  const [state, setState] = useState<MapStateV1 | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) {
      setErr('Нет job_id');
      return;
    }

    try {
      const raw = sessionStorage.getItem(storageKey(jobId));
      if (raw) {
        setState(JSON.parse(raw) as MapStateV1);
        return;
      }
    } catch {
      // ignore
    }

    let p = stateFetchInflight.get(jobId);
    if (!p) {
      const u = new URL(`/api/render/state/${encodeURIComponent(jobId)}`, window.location.origin);
      if (token) u.searchParams.set('render_token', token);
      p = fetch(u.toString(), { credentials: 'omit' }).then(async (r) => {
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${r.status}`);
        }
        return r.json() as Promise<MapStateV1>;
      });
      stateFetchInflight.set(jobId, p);
      p.finally(() => stateFetchInflight.delete(jobId));
    }

    let cancelled = false;
    p.then((j) => {
      if (cancelled) return;
      try {
        sessionStorage.setItem(storageKey(jobId), JSON.stringify(j));
      } catch {
        // ignore
      }
      setState(j);
    }).catch((e: unknown) => {
      if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
    });

    return () => {
      cancelled = true;
    };
  }, [jobId, token]);

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined') delete window.__RENDER_CAPTURE__;
    };
  }, []);

  if (err) {
    return (
      <div className="render-page render-page--error" role="alert">
        {err}
      </div>
    );
  }
  if (!state) {
    return <div className="render-page render-page--loading">Загрузка…</div>;
  }

  const elements = state.elements as MapElement[];
  return (
    <div id="render-container" className="render-page">
      <EditorStateProvider
        initialSnapshot={{
          elements,
          videoSettings: { ...state.video, theme: state.map.theme },
          geoTitle: state.geoTitle ?? DEFAULT_GEO_TITLE_SETTINGS,
        }}
      >
        <EditorMapProvider>
          <RenderInnerV2 state={state} />
        </EditorMapProvider>
      </EditorStateProvider>
    </div>
  );
}
