import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import * as PIXI from 'pixi.js';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEditorMap } from '../hooks/use-editor-map';
import { useEditorState } from '../state/editor-state';
import { styleForTheme } from '../map/map-styles';
import './editor-map.css';

const INITIAL_CENTER: [number, number] = [37.618, 55.751];
const INITIAL_ZOOM = 4;

export interface EditorMapProps {
  /** task8: Pixi resolution=1, no devicePixelRatio scaling (Puppeteer viewport = target px). */
  renderMode?: boolean;
  initialCenter?: [number, number];
  initialZoom?: number;
  initialBearing?: number;
  initialPitch?: number;
}

// Owns the two layered canvases that make up the editor preview:
//   1. MapLibre WebGL canvas at the bottom (the base map)
//   2. PixiJS WebGL canvas on top (animations — populated in task5+)
//   3. An invisible overlay div above Pixi that intercepts mousedown so
//      we can decide whether to drag an element or pass the event down
//      to MapLibre (via `pointer-events: none` on non-hit frames).
// Everything lives behind refs; React only renders the static DOM scaffold.
export function EditorMap({
  renderMode = false,
  initialCenter,
  initialZoom,
  initialBearing,
  initialPitch,
}: EditorMapProps): JSX.Element {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const { attachMap, attachPixi } = useEditorMap();
  const { theme } = useEditorState();
  const appliedThemeRef = useRef(theme);

  // Single init effect: empty deps so we don't destroy/rebuild the map on
  // theme change — theme swaps are handled via map.setStyle() below.
  useEffect(() => {
    const container = mapContainerRef.current;
    const overlay = overlayRef.current;
    if (!container || !overlay) return;

    const center = initialCenter ?? INITIAL_CENTER;
    const zoom = initialZoom ?? INITIAL_ZOOM;
    const map = new maplibregl.Map({
      container,
      style: styleForTheme(theme),
      center,
      zoom,
      bearing: initialBearing ?? 0,
      pitch: initialPitch ?? 0,
      attributionControl: false,
      // MapLibre fetches tiles from a Web Worker where `new Request('/...')`
      // fails with "Failed to parse URL" because the worker has no baseURI.
      // Rewrite root-relative URLs to absolute so the worker can resolve
      // them. No-op for already-absolute URLs (future map-style assets).
      transformRequest: (url) =>
        url.startsWith('/') ? { url: `${window.location.origin}${url}` } : { url },
    });
    attachMap(map);

    // PixiJS 7.4.2 uses the synchronous constructor + `.view` accessor.
    // v8 switched to async `.init()` and `.canvas` — cursor.md pins us to
    // 7.4.2 specifically so templates in task5/task6 keep working.
    const pixi = new PIXI.Application({
      width: container.clientWidth,
      height: container.clientHeight,
      backgroundAlpha: 0,
      antialias: true,
      resolution: renderMode ? 1 : window.devicePixelRatio || 1,
      autoDensity: !renderMode,
    });
    const pixiCanvas = pixi.view as HTMLCanvasElement;
    pixiCanvas.style.position = 'absolute';
    pixiCanvas.style.inset = '0';
    pixiCanvas.style.width = '100%';
    pixiCanvas.style.height = '100%';
    pixiCanvas.style.pointerEvents = 'none';
    container.appendChild(pixiCanvas);
    attachPixi(pixi);

    // Keep Pixi sized to the map container. ResizeObserver handles both
    // window resizes and layout changes (right panel open/close etc.).
    const ro = new ResizeObserver(() => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      map.resize();
      pixi.renderer.resize(w, h);
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      map.remove();
      pixi.destroy(true, { children: true, texture: false });
      attachMap(null);
      attachPixi(null);
    };
  }, [attachMap, attachPixi, initialCenter, initialZoom, initialBearing, initialPitch, renderMode]);

  // Theme swap via setStyle — preserves camera position & Pixi layer.
  // Runs only after the map is attached (theme changes from the default
  // don't race with init because init always uses 'dark').
  const { mapRef } = useEditorMap();
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (appliedThemeRef.current === theme) return;

    const applyTheme = () => {
      map.setStyle(styleForTheme(theme));
      appliedThemeRef.current = theme;
    };

    if (map.isStyleLoaded()) {
      applyTheme();
      return;
    }

    map.once('load', applyTheme);
  }, [theme, mapRef]);

  return (
    <div className="editor-map">
      <div ref={mapContainerRef} className="editor-map__canvas" />
      {/* Overlay: pointer-events:none by default so map drags work. Tools
          in task5/task6 toggle this to 'auto' while a drag is active. */}
      <div
        ref={overlayRef}
        className="editor-map__overlay"
        data-testid="editor-map-overlay"
      />
    </div>
  );
}
