import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type * as PIXI from 'pixi.js';
import { computeResetView, useEditorState } from '../state/editor-state';
import type { LngLat, MapElement, MapLabel, MapPoint, MapRoute } from '../state/types';

export type FlashListener = (id: string) => void;

export interface EditorMapHandle {
  mapRef: MutableRefObject<MapLibreMap | null>;
  pixiRef: MutableRefObject<PIXI.Application | null>;

  attachMap: (map: MapLibreMap | null) => void;
  attachPixi: (app: PIXI.Application | null) => void;

  resetView: () => void;
  coordinatesToPixels: (lng: number, lat: number) => { x: number; y: number } | null;
  pixelsToCoordinates: (x: number, y: number) => LngLat | null;

  /** Returns true when the element's coordinates are inside the current
   *  MapLibre viewport bounds. Used by ElementsList to decide whether a
   *  click should resetView() before flashing the element. */
  isElementInView: (id: string) => boolean;
  /** Fire a "flash me" signal. PixiLayer subscribes via `onFlash`. */
  requestFlash: (id: string) => void;
  /** Register a flash listener; returns an unsubscribe. */
  onFlash: (fn: FlashListener) => () => void;
}

// Shared imperative handle to the live MapLibre / Pixi instances. The
// <EditorMap> component owns creation & teardown; panels and tools pull
// this hook to drive pan/zoom without prop-drilling refs. Geometry
// helpers return null when the map is not yet attached — callers decide
// whether to queue the action or drop it.
const EditorMapContext = createContext<EditorMapHandle | undefined>(undefined);

export function EditorMapProvider({ children }: { children: ReactNode }): JSX.Element {
  const mapRef = useRef<MapLibreMap | null>(null);
  const pixiRef = useRef<PIXI.Application | null>(null);
  const { elements } = useEditorState();

  const attachMap = useCallback((map: MapLibreMap | null) => {
    mapRef.current = map;
  }, []);
  const attachPixi = useCallback((app: PIXI.Application | null) => {
    pixiRef.current = app;
  }, []);

  // resetView reads `elements` from state on every call — cheap, and we
  // avoid stale-closure bugs where the button remembers an old elements
  // array.
  const resetView = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const plan = computeResetView(elements);
    if (plan.kind === 'world') {
      map.flyTo({ center: [0, 20], zoom: 2 });
    } else if (plan.kind === 'center' && plan.center) {
      map.flyTo({ center: plan.center, zoom: 10 });
    } else if (plan.kind === 'bounds' && plan.bounds) {
      map.fitBounds(plan.bounds, { padding: 120, duration: 600 });
    }
  }, [elements]);

  const coordinatesToPixels = useCallback(
    (lng: number, lat: number): { x: number; y: number } | null => {
      const map = mapRef.current;
      if (!map) return null;
      const p = map.project([lng, lat]);
      return { x: p.x, y: p.y };
    },
    []
  );

  const pixelsToCoordinates = useCallback((x: number, y: number): LngLat | null => {
    const map = mapRef.current;
    if (!map) return null;
    const c = map.unproject([x, y]);
    return { lng: c.lng, lat: c.lat };
  }, []);

  // Flash bus — we want "click row in list → element blinks on map". React
  // state is wrong here because a flash is transient (a single event), not
  // persistent state. An EventTarget-style pub/sub keeps PixiLayer as the
  // one subscriber while remaining testable (tests can assert onFlash is
  // invoked without touching Pixi).
  const flashListenersRef = useRef<Set<FlashListener>>(new Set());
  const requestFlash = useCallback((id: string) => {
    for (const fn of flashListenersRef.current) fn(id);
  }, []);
  const onFlash = useCallback((fn: FlashListener) => {
    flashListenersRef.current.add(fn);
    return () => {
      flashListenersRef.current.delete(fn);
    };
  }, []);

  // Uses `elements` from state so a stale closure can't decide against a
  // freshly-added point. Read against `map.getBounds()`, which returns
  // `null` before styles finish loading — treat that as "not in view" so
  // the caller will resetView and fit the new bounds.
  const isElementInView = useCallback(
    (id: string): boolean => {
      const map = mapRef.current;
      if (!map) return false;
      const bounds = map.getBounds();
      const el = elements.find((e): e is MapElement => e.id === id);
      if (!el) return false;
      const coords =
        el.kind === 'point'
          ? (el as MapPoint).coordinates
          : el.kind === 'label'
            ? (el as MapLabel).coordinates
            : null;
      if (coords) return bounds.contains([coords.lng, coords.lat]);
      if (el.kind !== 'route') return false;
      const routeCoords = resolveRouteViewportCoords(el as MapRoute, elements);
      if (routeCoords.length === 0) return false;
      return routeCoords.every((c) => bounds.contains([c.lng, c.lat]));
    },
    [elements]
  );

  const value = useMemo<EditorMapHandle>(
    () => ({
      mapRef,
      pixiRef,
      attachMap,
      attachPixi,
      resetView,
      coordinatesToPixels,
      pixelsToCoordinates,
      isElementInView,
      requestFlash,
      onFlash,
    }),
    [
      attachMap,
      attachPixi,
      resetView,
      coordinatesToPixels,
      pixelsToCoordinates,
      isElementInView,
      requestFlash,
      onFlash,
    ]
  );

  return <EditorMapContext.Provider value={value}>{children}</EditorMapContext.Provider>;
}

function resolveRouteViewportCoords(route: MapRoute, all: MapElement[]): LngLat[] {
  const points = new Map<string, LngLat>();
  for (const el of all) {
    if (el.kind === 'point') points.set(el.id, el.coordinates);
  }
  if (route.waypoints && route.waypoints.length >= 2) {
    const coords: LngLat[] = [];
    for (const pointId of route.waypoints) {
      const c = points.get(pointId);
      if (c) coords.push(c);
    }
    if (route.end.type === 'coordinates') {
      coords.push(route.end.coordinates);
    }
    return coords;
  }
  const coords: LngLat[] = [];
  const start = points.get(route.start.pointId);
  if (start) coords.push(start);
  if (route.end.type === 'point') {
    const end = points.get(route.end.pointId);
    if (end) coords.push(end);
  } else {
    coords.push(route.end.coordinates);
  }
  return coords;
}

export function useEditorMap(): EditorMapHandle {
  const ctx = useContext(EditorMapContext);
  if (!ctx) throw new Error('useEditorMap used outside <EditorMapProvider>');
  return ctx;
}
