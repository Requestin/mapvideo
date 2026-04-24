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
import './render-page.css';

/** Dedupe state fetch in React StrictMode (token is one-shot). */
const stateFetchInflight = new Map<string, Promise<MapStateV1>>();

function storageKey(jobId: string): string {
  return `mapvideo_render_state_${jobId}`;
}

function InstallWindowApi({
  breathingStrength,
  breathingReferenceZoom,
}: {
  breathingStrength: number;
  breathingReferenceZoom: number | null;
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
        __applyRenderTimeSec: (s: number) => void;
        mapReady: boolean;
      };
      w.mapInstance = map;
      w.pixiApp = pixi;
      w.__applyRenderTimeSec = (sec: number) => {
        window.__RENDER_TIME_MS__ = sec * 1000;
        gsap.globalTimeline.time(sec);
        if (breathingStrength > 0 && breathingReferenceZoom != null) {
          map.setZoom(computeBreathingZoom(breathingReferenceZoom, breathingStrength, sec));
        }
        map.triggerRepaint();
        requestAnimationFrame(() => {
          pixi.renderer.render(pixi.stage);
        });
      };
      void loadAppFonts()
        .catch(() => {
          // eslint-disable-next-line no-console
          console.warn('[render-page] Font loading failed, retrying once…');
          return loadAppFonts().catch(() => undefined);
        })
        .then(() => document.fonts.ready)
        .finally(() => {
          w.mapReady = true;
        });
    }, 16);
    return () => clearInterval(id);
  }, [mapRef, pixiRef, breathingReferenceZoom, breathingStrength]);
  return null;
}

function RenderInner({ state }: { state: MapStateV1 }): JSX.Element {
  const hitRegistry = useMemo<HitRegistry>(() => ({ targets: [] }), []);
  if (typeof window !== 'undefined') {
    window.__RENDER_CAPTURE__ = true;
  }
  return (
    <>
      <EditorMap
        renderMode
        initialCenter={[state.map.center.lng, state.map.center.lat]}
        initialZoom={state.map.zoom}
        initialBearing={state.map.bearing}
        initialPitch={state.map.pitch}
      />
      <PixiLayer hitRegistry={hitRegistry} />
      <InstallWindowApi
        breathingStrength={state.video.cameraBreathing}
        breathingReferenceZoom={state.video.cameraBreathingReferenceZoom ?? state.map.zoom}
      />
    </>
  );
}

/**
 * task8: headless page opened by Puppeteer. No app chrome — only map+Pixi.
 * URL: `/render-page?job_id=...&render_token=...`
 */
export function RenderPage(): JSX.Element {
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
      if (typeof window !== 'undefined') {
        delete window.__RENDER_CAPTURE__;
      }
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
          <RenderInner state={state} />
        </EditorMapProvider>
      </EditorStateProvider>
    </div>
  );
}
