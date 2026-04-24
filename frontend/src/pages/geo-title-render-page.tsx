import { useEffect, useRef, useState } from 'react';
import { GeoTitleOverlay } from '../components/geo-title-overlay';
import { DEFAULT_GEO_TITLE_SETTINGS } from '../state/types';
import { loadAppFonts } from '../services/fonts';
import type { MapStateV1 } from '../types/map-state';
import './render-page.css';

const stateFetchInflight = new Map<string, Promise<MapStateV1>>();

function storageKey(jobId: string): string {
  return `mapvideo_geo_title_state_${jobId}`;
}

export function GeoTitleRenderPage(): JSX.Element {
  const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
  const jobId = params.get('job_id');
  const token = params.get('render_token');
  const [state, setState] = useState<MapStateV1 | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [timeSec, setTimeSec] = useState(0);
  const [frameSize, setFrameSize] = useState({
    width: typeof window === 'undefined' ? 1920 : window.innerWidth,
    height: typeof window === 'undefined' ? 1080 : window.innerHeight,
  });
  const installedRef = useRef(false);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById('root');
    html.classList.add('render-page-transparent-root');
    body.classList.add('render-page-transparent-root');
    root?.classList.add('render-page-transparent-root');
    return () => {
      html.classList.remove('render-page-transparent-root');
      body.classList.remove('render-page-transparent-root');
      root?.classList.remove('render-page-transparent-root');
    };
  }, []);

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
      // ignore storage failures
    }

    let inflight = stateFetchInflight.get(jobId);
    if (!inflight) {
      const u = new URL(`/api/render/state/${encodeURIComponent(jobId)}`, window.location.origin);
      if (token) u.searchParams.set('render_token', token);
      inflight = fetch(u.toString(), { credentials: 'omit' }).then(async (r) => {
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${r.status}`);
        }
        return r.json() as Promise<MapStateV1>;
      });
      stateFetchInflight.set(jobId, inflight);
      inflight.finally(() => stateFetchInflight.delete(jobId));
    }

    let cancelled = false;
    inflight
      .then((payload) => {
        if (cancelled) return;
        try {
          sessionStorage.setItem(storageKey(jobId), JSON.stringify(payload));
        } catch {
          // ignore
        }
        setState(payload);
      })
      .catch((e: unknown) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [jobId, token]);

  useEffect(() => {
    const update = (): void => {
      setFrameSize({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    if (!state) return;
    if (installedRef.current) return;
    installedRef.current = true;
    const w = window as unknown as {
      __applyGeoTitleRenderTimeSec?: (s: number) => void;
      geoTitleReady?: boolean;
    };
    w.__applyGeoTitleRenderTimeSec = (s: number) => {
      setTimeSec(s);
    };
    void loadAppFonts()
      .catch(() => loadAppFonts().catch(() => undefined))
      .then(() => document.fonts.ready)
      .finally(() => {
        w.geoTitleReady = true;
      });
  }, [state]);

  if (err) return <div className="render-page render-page--error">{err}</div>;
  if (!state) return <div className="render-page render-page--loading">Загрузка…</div>;

  return (
    <div className="render-page render-page--transparent">
      <GeoTitleOverlay
        geoTitle={state.geoTitle ?? DEFAULT_GEO_TITLE_SETTINGS}
        frameWidth={frameSize.width}
        frameHeight={frameSize.height}
        animated
        timeSec={timeSec}
      />
    </div>
  );
}
