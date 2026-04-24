import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  defaultLabelSettings,
  defaultPointSettings,
  defaultRouteSettings,
  DEFAULT_GEO_TITLE_SETTINGS,
  ROUTE_ICON_SIZE_DEFAULT,
  ROUTE_ICON_SIZE_MAX,
  ROUTE_ICON_SIZE_MIN,
  renderGeoTitleText,
  type GeoTitleSettings,
  type LabelSettings,
  type LngLat,
  type MapElement,
  type MapLabel,
  type MapPoint,
  type MapRoute,
  type PointAnimationKind,
  type PointSettings,
  type RouteEndpoint,
  type RouteSettings,
  type VideoSettings,
  DEFAULT_VIDEO_SETTINGS,
  LOCKED_VIDEO_RESOLUTION,
  ACTIVE_VIDEO_FPS,
  ACTIVE_VIDEO_FORMAT,
} from './types';
import type { MapTheme } from '../map/map-styles';

export interface AddPointInput {
  label: string;
  coordinates: LngLat;
  /** Display name preserved for label "до запятой" / uppercase recomputation. */
  originalText?: string;
}

export interface AddRouteInput {
  /** New chain model: one route may include multiple point ids. */
  waypoints?: string[];
  /** Start must reference an existing MapPoint (SPEC §Маршрут). */
  startPointId: string;
  end: RouteEndpoint;
  /** Optional overrides — defaults come from defaultRouteSettings(). */
  settings?: Partial<RouteSettings>;
}

/** Route-building mode state for the multi-point UX flow. */
export interface RouteBuildMode {
  waypointIds: string[];
  /** Route created after the second click; then extended in place. */
  routeId: string | null;
}

interface EditorStateValue {
  elements: MapElement[];
  selectedElementId: string | null;
  /** Element currently under the cursor on the map (or null). Read by both
   *  PixiLayer (to draw a highlight ring) and ElementsList (to style the
   *  matching row). Writing happens from both sides — `use-element-hover`
   *  on mousemove, and ElementsList on row `mouseenter`/`mouseleave`. */
  hoveredElementId: string | null;
  theme: MapTheme;
  /** task6: when non-null, the overlay above the map interprets clicks as
   *  route construction steps instead of selection/drag. Escape / completed
   *  route resets it to null. */
  routeBuildMode: RouteBuildMode | null;

  selectElement: (id: string | null) => void;
  setHoveredElement: (id: string | null) => void;
  /** Atomic: inserts paired MapPoint + MapLabel, returns the new point id. */
  addPoint: (input: AddPointInput) => string;
  /** Removes a point, label, or route. Removing a point also removes its
   *  label AND all routes that reference it as an endpoint. */
  removeElement: (id: string) => void;
  moveElement: (id: string, coordinates: LngLat) => void;
  updatePointSettings: (id: string, patch: Partial<PointSettings>) => void;
  /** Swaps animation kind, loading that kind's defaults so sliders/colour
   *  pickers in the panel can't end up on stale state. */
  changePointAnimation: (id: string, next: PointAnimationKind) => void;
  updateLabelSettings: (id: string, patch: Partial<LabelSettings>) => void;
  updateLabelText: (id: string, rawText: string) => void;
  resetPointSettings: (id: string) => void;
  resetPointLocation: (id: string) => void;
  resetLabelLocation: (id: string) => void;
  resetLabelSettings: (id: string) => void;
  // === task6: routes ======================================================
  /** Creates a new MapRoute. Returns its id. */
  addRoute: (input: AddRouteInput) => string;
  updateRouteWaypoints: (id: string, waypointIds: string[]) => void;
  updateRouteEndCoordinates: (id: string, coordinates: LngLat) => void;
  updateRouteSettings: (id: string, patch: Partial<RouteSettings>) => void;
  /** Replaces the cached OSRM geometry for a route. Pass null to mark it
   *  stale (PixiLayer will fall back to a straight line until new coords
   *  arrive). */
  setRouteOsrmCoordinates: (id: string, coords: LngLat[] | null) => void;
  setRouteOsrmLegsCoordinates: (id: string, coords: LngLat[][] | null) => void;
  invalidateRouteOsrmForPoint: (pointId: string) => void;
  resetRouteSettings: (id: string) => void;
  /** Activate/deactivate build mode. */
  setRouteBuildMode: (mode: RouteBuildMode | null) => void;
  /** Toolbar / general: updates map style and persists `theme` in video settings. */
  setTheme: (theme: MapTheme) => void;
  /** task7: last saved video export settings (task8 render request). */
  videoSettings: VideoSettings;
  geoTitle: GeoTitleSettings;
  updateVideoSettings: (patch: Partial<VideoSettings>) => void;
  updateGeoTitle: (patch: Partial<GeoTitleSettings>) => void;
  resetGeoTitle: () => void;
  /** Replace committed video settings (e.g. modal «Сохранить»). */
  commitVideoSettings: (next: VideoSettings) => void;
  /** task7: live map theme from the modal without committing — cancel restores `videoSettings.theme`. */
  applyMapThemePreview: (theme: MapTheme) => void;
}

const EditorStateContext = createContext<EditorStateValue | undefined>(undefined);

// Small helper so ids stay stable even across HMR reloads (tests mock this).
function makeId(prefix: string, counter: { n: number }): string {
  counter.n += 1;
  return `${prefix}-${counter.n}-${Date.now().toString(36)}`;
}

/** Initial offset (in geographic degrees) applied when a new label is born
 *  next to its point. Small enough to sit "just above" the dot at zoom 5–14. */
const LABEL_INITIAL_DLAT = 0.02;
const LABEL_INITIAL_DLNG = 0;

function clampRouteIconSize(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return ROUTE_ICON_SIZE_DEFAULT;
  return Math.max(ROUTE_ICON_SIZE_MIN, Math.min(ROUTE_ICON_SIZE_MAX, Math.round(raw)));
}

function normalizeVideoSettings(next: VideoSettings): VideoSettings {
  const fps = ACTIVE_VIDEO_FPS.includes(next.fps) ? next.fps : DEFAULT_VIDEO_SETTINGS.fps;
  return {
    ...next,
    resolution: LOCKED_VIDEO_RESOLUTION,
    fps,
    format: ACTIVE_VIDEO_FORMAT,
  };
}

function normalizeGeoTitleSettings(next: GeoTitleSettings | null | undefined): GeoTitleSettings {
  const base = { ...(next ?? DEFAULT_GEO_TITLE_SETTINGS) };
  const uppercase =
    typeof base.uppercase === 'boolean' ? base.uppercase : DEFAULT_GEO_TITLE_SETTINGS.uppercase;
  const truncateAtComma =
    typeof base.truncateAtComma === 'boolean'
      ? base.truncateAtComma
      : DEFAULT_GEO_TITLE_SETTINGS.truncateAtComma;
  const originalText = typeof base.originalText === 'string' ? base.originalText : '';
  const text = renderGeoTitleText(originalText, { uppercase, truncateAtComma });
  const fontFamily =
    typeof base.fontFamily === 'string' && base.fontFamily.trim().length > 0
      ? base.fontFamily
      : DEFAULT_GEO_TITLE_SETTINGS.fontFamily;
  const fontWeight = Number.isFinite(base.fontWeight)
    ? Math.max(100, Math.min(900, Math.round(base.fontWeight)))
    : DEFAULT_GEO_TITLE_SETTINGS.fontWeight;
  return {
    enabled: Boolean(base.enabled),
    text,
    originalText,
    uppercase,
    truncateAtComma,
    fontFamily,
    fontWeight,
  };
}

export interface EditorStateProviderProps {
  children: ReactNode;
  /** task8: `/render-page` hydrates the editor from server JSON (headless). */
  initialSnapshot?: {
    elements: MapElement[];
    videoSettings: VideoSettings;
    geoTitle?: GeoTitleSettings;
  };
}

export function EditorStateProvider({
  children,
  initialSnapshot,
}: EditorStateProviderProps): JSX.Element {
  const [elements, setElements] = useState<MapElement[]>(() => initialSnapshot?.elements ?? []);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [hoveredElementId, setHoveredElementIdState] = useState<string | null>(null);
  const [theme, setThemeState] = useState<MapTheme>(
    () => initialSnapshot?.videoSettings.theme ?? DEFAULT_VIDEO_SETTINGS.theme
  );
  const [videoSettings, setVideoSettings] = useState<VideoSettings>(() => ({
    ...normalizeVideoSettings(initialSnapshot?.videoSettings ?? DEFAULT_VIDEO_SETTINGS),
  }));
  const [geoTitle, setGeoTitle] = useState<GeoTitleSettings>(() =>
    normalizeGeoTitleSettings(initialSnapshot?.geoTitle)
  );
  const [routeBuildMode, setRouteBuildModeState] = useState<RouteBuildMode | null>(null);

  const setTheme = useCallback((next: MapTheme) => {
    setThemeState(next);
    setVideoSettings((s) => (s.theme === next ? s : { ...s, theme: next }));
  }, []);

  const applyMapThemePreview = useCallback((next: MapTheme) => {
    setThemeState(next);
  }, []);

  const commitVideoSettings = useCallback((next: VideoSettings) => {
    const normalized = normalizeVideoSettings(next);
    setVideoSettings(normalized);
    setThemeState(normalized.theme);
  }, []);

  const updateVideoSettings = useCallback((patch: Partial<VideoSettings>) => {
    setVideoSettings((prev) => normalizeVideoSettings({ ...prev, ...patch }));
    if (patch.theme) setThemeState(patch.theme);
  }, []);

  const updateGeoTitle = useCallback((patch: Partial<GeoTitleSettings>) => {
    setGeoTitle((prev) => {
      const merged: GeoTitleSettings = {
        ...prev,
        ...patch,
      };
      const uppercase =
        patch.uppercase !== undefined ? patch.uppercase : merged.uppercase;
      const truncateAtComma =
        patch.truncateAtComma !== undefined ? patch.truncateAtComma : merged.truncateAtComma;
      const originalText =
        patch.originalText !== undefined
          ? patch.originalText
          : patch.text !== undefined
            ? patch.text
            : merged.originalText;
      return normalizeGeoTitleSettings({
        ...merged,
        uppercase,
        truncateAtComma,
        originalText,
      });
    });
  }, []);

  const resetGeoTitle = useCallback(() => {
    setGeoTitle(DEFAULT_GEO_TITLE_SETTINGS);
  }, []);

  // Guard against React "setState on unchanged value" churn — mousemove fires
  // 60×/s and we don't want to re-render the entire ElementsList on every
  // pixel. `use-element-hover` only calls this when the picked id changes,
  // but ElementsList may still call it rapidly on enter/leave bursts.
  const setHoveredElement = useCallback((id: string | null) => {
    setHoveredElementIdState((prev) => (prev === id ? prev : id));
  }, []);

  // Separate refs so ids keep incrementing monotonically and survive
  // concurrent addPoint calls without relying on setElements closure math.
  const pointCounter = useRef({ n: 0 });
  const labelCounter = useRef({ n: 0 });
  const routeCounter = useRef({ n: 0 });

  const addPoint = useCallback((input: AddPointInput): string => {
    const pointId = makeId('point', pointCounter.current);
    const labelId = makeId('label', labelCounter.current);
    const labelCoords: LngLat = {
      lng: input.coordinates.lng + LABEL_INITIAL_DLNG,
      lat: input.coordinates.lat + LABEL_INITIAL_DLAT,
    };
    const point: MapPoint = {
      id: pointId,
      kind: 'point',
      label: input.label,
      coordinates: { ...input.coordinates },
      originCoordinates: { ...input.coordinates },
      settings: defaultPointSettings('blinking'),
      labelId,
    };
    const label: MapLabel = {
      id: labelId,
      kind: 'label',
      label: input.label,
      pointId,
      coordinates: labelCoords,
      originOffset: { lng: LABEL_INITIAL_DLNG, lat: LABEL_INITIAL_DLAT },
      originalText: input.originalText ?? input.label,
      settings: defaultLabelSettings(),
    };
    setElements((prev) => [...prev, point, label]);
    return pointId;
  }, []);

  const removeElement = useCallback((id: string) => {
    setElements((prev) => {
      const target = prev.find((e) => e.id === id);
      if (!target) return prev;
      if (target.kind === 'point') {
        // A point owns its label and any route that references it as an
        // endpoint (SPEC §Маршрут: "При удалении точки — удаляются все
        // связанные маршруты").
        return prev.filter((e) => {
          if (e.id === id) return false;
          if (e.kind === 'label' && e.pointId === id) return false;
          if (e.kind === 'route') {
            if (e.waypoints?.includes(id)) return false;
            if (e.start.pointId === id) return false;
            if (e.end.type === 'point' && e.end.pointId === id) return false;
          }
          return true;
        });
      }
      if (target.kind === 'label') {
        return prev
          .map((e) => (e.kind === 'point' && e.labelId === id ? { ...e, labelId: '' } : e))
          .filter((e) => e.id !== id);
      }
      return prev.filter((e) => e.id !== id);
    });
    setSelectedElementId((cur) => (cur === id ? null : cur));
    setHoveredElementIdState((cur) => (cur === id ? null : cur));
  }, []);

  const moveElement = useCallback((id: string, coordinates: LngLat) => {
    setElements((prev) => {
      // Shortcut: if the moved element isn't a point, we never need to
      // invalidate routes — labels float independently, and routes
      // themselves aren't draggable.
      const target = prev.find((e) => e.id === id);
      if (!target) return prev;
      if (target.kind === 'point') {
        return prev.map((e) => {
          if (e.id === id) return { ...e, coordinates: { ...coordinates } };
          return e;
        });
      }
      if (target.kind === 'label') {
        return prev.map((e) =>
          e.id === id ? { ...e, coordinates: { ...coordinates } } : e
        );
      }
      return prev;
    });
  }, []);

  const invalidateRouteOsrmForPoint = useCallback((pointId: string) => {
    setElements((prev) =>
      prev.map((e) => {
        if (e.kind !== 'route') return e;
        const touchesWaypoint = e.waypoints?.includes(pointId) ?? false;
        const touchesLegacy =
          e.start.pointId === pointId || (e.end.type === 'point' && e.end.pointId === pointId);
        if (!touchesWaypoint && !touchesLegacy) return e;
        if (!e.osrmCoordinates && !e.osrmLegsCoordinates) return e;
        return { ...e, osrmCoordinates: null, osrmLegsCoordinates: null };
      })
    );
  }, []);

  const updatePointSettings = useCallback(
    (id: string, patch: Partial<PointSettings>) => {
      setElements((prev) =>
        prev.map((e) => {
          if (e.id !== id || e.kind !== 'point') return e;
          // Kind changes go through changePointAnimation(); here we only
          // merge compatible fields.
          const merged = { ...e.settings, ...patch } as PointSettings;
          return { ...e, settings: merged };
        })
      );
    },
    []
  );

  const changePointAnimation = useCallback((id: string, next: PointAnimationKind) => {
    setElements((prev) =>
      prev.map((e) => {
        if (e.id !== id || e.kind !== 'point') return e;
        if (e.settings.kind === next) return e;
        return { ...e, settings: defaultPointSettings(next) };
      })
    );
  }, []);

  const updateLabelSettings = useCallback((id: string, patch: Partial<LabelSettings>) => {
    setElements((prev) =>
      prev.map((e) => {
        if (e.id !== id || e.kind !== 'label') return e;
        return {
          ...e,
          settings: {
            ...e.settings,
            ...patch,
            stroke: { ...e.settings.stroke, ...(patch.stroke ?? {}) },
          },
        };
      })
    );
  }, []);

  const updateLabelText = useCallback((id: string, rawText: string) => {
    setElements((prev) =>
      prev.map((e) => {
        if (e.id !== id || e.kind !== 'label') return e;
        return { ...e, label: rawText, originalText: rawText };
      })
    );
  }, []);

  const resetPointSettings = useCallback((id: string) => {
    setElements((prev) =>
      prev.map((e) => {
        if (e.id !== id || e.kind !== 'point') return e;
        return { ...e, settings: defaultPointSettings(e.settings.kind) };
      })
    );
  }, []);

  const resetPointLocation = useCallback((id: string) => {
    setElements((prev) =>
      prev.map((e) => {
        if (e.id !== id || e.kind !== 'point') return e;
        return { ...e, coordinates: { ...e.originCoordinates } };
      })
    );
  }, []);

  const resetLabelLocation = useCallback((id: string) => {
    setElements((prev) => {
      const label = prev.find((e): e is MapLabel => e.id === id && e.kind === 'label');
      if (!label) return prev;
      const point = prev.find((e): e is MapPoint => e.id === label.pointId && e.kind === 'point');
      if (!point) return prev;
      const resetCoords: LngLat = {
        lng: point.coordinates.lng + label.originOffset.lng,
        lat: point.coordinates.lat + label.originOffset.lat,
      };
      return prev.map((e) => (e.id === id ? { ...label, coordinates: resetCoords } : e));
    });
  }, []);

  const resetLabelSettings = useCallback((id: string) => {
    setElements((prev) =>
      prev.map((e) => {
        if (e.id !== id || e.kind !== 'label') return e;
        return { ...e, settings: defaultLabelSettings(e.settings.fontFamily) };
      })
    );
  }, []);

  // === task6: routes =====================================================

  // Pretty label for the elements list / right-sidebar header.
  const buildRouteLabel = useCallback(
    (startPointId: string, end: RouteEndpoint, list: MapElement[], waypoints?: string[]): string => {
      if (waypoints && waypoints.length >= 2) {
        const chainLabel = waypoints
          .map(
            (pointId) =>
              list.find((e): e is MapPoint => e.id === pointId && e.kind === 'point')?.label ||
              'точка'
          )
          .join(' → ');
        return end.type === 'coordinates' ? `${chainLabel} → произвольная точка` : chainLabel;
      }
      const startLabel =
        list.find((e): e is MapPoint => e.id === startPointId && e.kind === 'point')?.label ||
        'точка';
      const endLabel =
        end.type === 'point'
          ? list.find((e): e is MapPoint => e.id === end.pointId && e.kind === 'point')?.label ||
            'точка'
          : 'произвольная точка';
      return `${startLabel} → ${endLabel}`;
    },
    []
  );

  const addRoute = useCallback(
    (input: AddRouteInput): string => {
      const id = makeId('route', routeCounter.current);
      const settings: RouteSettings = { ...defaultRouteSettings(), ...(input.settings ?? {}) };
      settings.iconSize = clampRouteIconSize(settings.iconSize);
      setElements((prev) => {
        const chain =
          input.waypoints && input.waypoints.length >= 2
            ? input.waypoints.slice()
            : input.end.type === 'point'
              ? [input.startPointId, input.end.pointId]
              : undefined;
        const normalizedEnd =
          input.end.type === 'point'
            ? ({ type: 'point', pointId: input.end.pointId } as const)
            : ({ type: 'coordinates', coordinates: { ...input.end.coordinates } } as const);
        const routeEnd =
          chain && chain.length >= 2 && normalizedEnd.type === 'point'
            ? ({ type: 'point', pointId: chain[chain.length - 1] } as const)
            : normalizedEnd;
        const route: MapRoute = {
          id,
          kind: 'route',
          label: buildRouteLabel(chain?.[0] ?? input.startPointId, routeEnd, prev, chain),
          waypoints: chain,
          start: { type: 'point', pointId: chain?.[0] ?? input.startPointId },
          end: routeEnd,
          settings,
          osrmCoordinates: null,
          osrmLegsCoordinates: null,
        };
        return [...prev, route];
      });
      return id;
    },
    [buildRouteLabel]
  );

  const updateRouteSettings = useCallback((id: string, patch: Partial<RouteSettings>) => {
    setElements((prev) =>
      prev.map((e) => {
        if (e.id !== id || e.kind !== 'route') return e;
        // Switching between `useRoadRoute`/`arc`/`icon` can make the cached
        // OSRM geometry irrelevant. Instead of branching per-field we take
        // the simple rule: any settings change invalidates the OSRM cache
        // only if the topology-affecting toggles actually flipped.
        const next: MapRoute = {
          ...e,
          settings: {
            ...e.settings,
            ...patch,
            stroke: { ...e.settings.stroke, ...(patch.stroke ?? {}) },
          },
        };
        next.settings.iconSize = clampRouteIconSize(next.settings.iconSize);
        if (next.settings.useRoadRoute) {
          // Product rule: road route is always shown without animated transport icon.
          next.settings.icon = 'none';
          next.settings.arc = false;
        }
        if (
          patch.useRoadRoute !== undefined &&
          patch.useRoadRoute !== e.settings.useRoadRoute
        ) {
          next.osrmCoordinates = null;
          next.osrmLegsCoordinates = null;
        }
        return next;
      })
    );
  }, []);

  const updateRouteWaypoints = useCallback((id: string, waypointIds: string[]) => {
    if (waypointIds.length < 2) return;
    setElements((prev) =>
      prev.map((e) => {
        if (e.id !== id || e.kind !== 'route') return e;
        const nextWaypoints = waypointIds.slice();
        const nextEnd = { type: 'point', pointId: nextWaypoints[nextWaypoints.length - 1] } as const;
        return {
          ...e,
          waypoints: nextWaypoints,
          start: { type: 'point', pointId: nextWaypoints[0] },
          end: nextEnd,
          label: buildRouteLabel(nextWaypoints[0], nextEnd, prev, nextWaypoints),
          osrmCoordinates: null,
          osrmLegsCoordinates: null,
        };
      })
    );
  }, [buildRouteLabel]);

  const updateRouteEndCoordinates = useCallback(
    (id: string, coordinates: LngLat) => {
      setElements((prev) =>
        prev.map((e) => {
          if (e.id !== id || e.kind !== 'route') return e;
          const end: RouteEndpoint = {
            type: 'coordinates',
            coordinates: { ...coordinates },
          };
          return {
            ...e,
            end,
            label: buildRouteLabel(e.start.pointId, end, prev, e.waypoints),
            osrmCoordinates: null,
            osrmLegsCoordinates: null,
          };
        })
      );
    },
    [buildRouteLabel]
  );

  const setRouteOsrmCoordinates = useCallback(
    (id: string, coords: LngLat[] | null) => {
      setElements((prev) =>
        prev.map((e) => {
          if (e.id !== id || e.kind !== 'route') return e;
          // Deep-ish copy so callers don't accidentally mutate state.
          return {
            ...e,
            osrmCoordinates: coords ? coords.map((c) => ({ lng: c.lng, lat: c.lat })) : null,
            osrmLegsCoordinates: coords ? e.osrmLegsCoordinates ?? null : null,
          };
        })
      );
    },
    []
  );

  const setRouteOsrmLegsCoordinates = useCallback((id: string, coords: LngLat[][] | null) => {
    setElements((prev) =>
      prev.map((e) => {
        if (e.id !== id || e.kind !== 'route') return e;
        return {
          ...e,
          osrmLegsCoordinates: coords
            ? coords.map((leg) => leg.map((c) => ({ lng: c.lng, lat: c.lat })))
            : null,
        };
      })
    );
  }, []);

  const resetRouteSettings = useCallback((id: string) => {
    setElements((prev) =>
      prev.map((e) => {
        if (e.id !== id || e.kind !== 'route') return e;
        return {
          ...e,
          settings: defaultRouteSettings(),
          osrmCoordinates: null,
          osrmLegsCoordinates: null,
        };
      })
    );
  }, []);

  const setRouteBuildMode = useCallback((mode: RouteBuildMode | null) => {
    setRouteBuildModeState(mode);
  }, []);

  const value = useMemo<EditorStateValue>(
    () => ({
      elements,
      selectedElementId,
      hoveredElementId,
      theme,
      routeBuildMode,
      geoTitle,
      selectElement: setSelectedElementId,
      setHoveredElement,
      addPoint,
      removeElement,
      moveElement,
      updatePointSettings,
      changePointAnimation,
      updateLabelSettings,
      updateLabelText,
      resetPointSettings,
      resetPointLocation,
      resetLabelLocation,
      resetLabelSettings,
      addRoute,
      updateRouteWaypoints,
      updateRouteEndCoordinates,
      updateRouteSettings,
      setRouteOsrmCoordinates,
      setRouteOsrmLegsCoordinates,
      invalidateRouteOsrmForPoint,
      resetRouteSettings,
      setRouteBuildMode,
      setTheme,
      videoSettings,
      updateGeoTitle,
      resetGeoTitle,
      updateVideoSettings,
      commitVideoSettings,
      applyMapThemePreview,
    }),
    [
      elements,
      selectedElementId,
      hoveredElementId,
      theme,
      videoSettings,
      geoTitle,
      routeBuildMode,
      setHoveredElement,
      addPoint,
      removeElement,
      moveElement,
      updatePointSettings,
      changePointAnimation,
      updateLabelSettings,
      updateLabelText,
      resetPointSettings,
      resetPointLocation,
      resetLabelLocation,
      resetLabelSettings,
      addRoute,
      updateRouteWaypoints,
      updateRouteEndCoordinates,
      updateRouteSettings,
      setRouteOsrmCoordinates,
      setRouteOsrmLegsCoordinates,
      invalidateRouteOsrmForPoint,
      resetRouteSettings,
      setRouteBuildMode,
      setTheme,
      updateGeoTitle,
      resetGeoTitle,
      updateVideoSettings,
      commitVideoSettings,
      applyMapThemePreview,
    ]
  );

  return <EditorStateContext.Provider value={value}>{children}</EditorStateContext.Provider>;
}

export function useEditorState(): EditorStateValue {
  const ctx = useContext(EditorStateContext);
  if (!ctx) throw new Error('useEditorState used outside <EditorStateProvider>');
  return ctx;
}

// Pure helper — exported so it can be unit-tested independently of a
// mounted map instance. Returns the viewport that resetView() should use.
export function computeResetView(elements: MapElement[]): {
  kind: 'world' | 'center' | 'bounds';
  center?: [number, number];
  bounds?: [[number, number], [number, number]];
} {
  const pointById = new Map<string, MapPoint>();
  for (const el of elements) {
    if (el.kind === 'point') pointById.set(el.id, el);
  }

  const coords: LngLat[] = [];
  for (const el of elements) {
    if (el.kind === 'point' || el.kind === 'label') {
      coords.push(el.coordinates);
      continue;
    }
    if (el.kind !== 'route') continue;
    if (el.waypoints && el.waypoints.length >= 2) {
      for (const pointId of el.waypoints) {
        const p = pointById.get(pointId);
        if (p) coords.push(p.coordinates);
      }
      if (el.end.type === 'coordinates') {
        coords.push(el.end.coordinates);
      }
      continue;
    }
    const startPoint = pointById.get(el.start.pointId);
    if (startPoint) coords.push(startPoint.coordinates);
    if (el.end.type === 'point') {
      const endPoint = pointById.get(el.end.pointId);
      if (endPoint) coords.push(endPoint.coordinates);
    } else {
      coords.push(el.end.coordinates);
    }
  }

  if (coords.length === 0) return { kind: 'world' };
  if (coords.length === 1) {
    const { lng, lat } = coords[0];
    return { kind: 'center', center: [lng, lat] };
  }
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const c of coords) {
    if (c.lng < minLng) minLng = c.lng;
    if (c.lat < minLat) minLat = c.lat;
    if (c.lng > maxLng) maxLng = c.lng;
    if (c.lat > maxLat) maxLat = c.lat;
  }
  return { kind: 'bounds', bounds: [[minLng, minLat], [maxLng, maxLat]] };
}
