import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { EditorStateProvider, useEditorState } from '../src/state/editor-state';
import type { MapPoint, MapRoute } from '../src/state/types';
import type { ReactNode } from 'react';

const wrapper = ({ children }: { children: ReactNode }) => (
  <EditorStateProvider>{children}</EditorStateProvider>
);

function seedTwoPoints(result: { current: ReturnType<typeof useEditorState> }) {
  let a = '';
  let b = '';
  act(() => {
    a = result.current.addPoint({ label: 'Москва', coordinates: { lng: 37.6, lat: 55.7 } });
  });
  act(() => {
    b = result.current.addPoint({ label: 'Питер', coordinates: { lng: 30.3, lat: 59.9 } });
  });
  return { a, b };
}

describe('editor-state — routes (task6)', () => {
  it('addRoute inserts a MapRoute with a computed "start → end" label', () => {
    const { result } = renderHook(() => useEditorState(), { wrapper });
    const { a, b } = seedTwoPoints(result);

    let routeId = '';
    act(() => {
      routeId = result.current.addRoute({
        startPointId: a,
        end: { type: 'point', pointId: b },
      });
    });

    const route = result.current.elements.find((e) => e.id === routeId) as MapRoute | undefined;
    expect(route).toBeDefined();
    expect(route?.kind).toBe('route');
    expect(route?.label).toBe('Москва → Питер');
    expect(route?.start.pointId).toBe(a);
    expect(route?.end.type === 'point' && route.end.pointId).toBe(b);
    expect(route?.osrmCoordinates).toBeNull();
  });

  it('addRoute supports waypoint chains as one route element', () => {
    const { result } = renderHook(() => useEditorState(), { wrapper });
    const { a, b } = seedTwoPoints(result);
    let c = '';
    act(() => {
      c = result.current.addPoint({ label: 'Казань', coordinates: { lng: 49.1, lat: 55.8 } });
    });
    let routeId = '';
    act(() => {
      routeId = result.current.addRoute({
        startPointId: a,
        end: { type: 'point', pointId: c },
        waypoints: [a, b, c],
      });
    });
    const route = result.current.elements.find((e) => e.id === routeId) as MapRoute | undefined;
    expect(route?.waypoints).toEqual([a, b, c]);
    expect(route?.label).toBe('Москва → Питер → Казань');
  });

  it('supports free-end coordinates in build flow updates', () => {
    const { result } = renderHook(() => useEditorState(), { wrapper });
    const { a, b } = seedTwoPoints(result);
    let routeId = '';
    act(() => {
      routeId = result.current.addRoute({
        startPointId: a,
        end: { type: 'point', pointId: b },
        waypoints: [a, b],
      });
    });
    act(() => {
      result.current.updateRouteEndCoordinates(routeId, { lng: 40, lat: 60 });
    });
    const route = result.current.elements.find((e) => e.id === routeId) as MapRoute | undefined;
    expect(route?.end.type).toBe('coordinates');
    if (route?.end.type === 'coordinates') {
      expect(route.end.coordinates).toEqual({ lng: 40, lat: 60 });
    }
    expect(route?.label).toContain('произвольная точка');
  });

  it('addRoute with coordinates end labels it "произвольная точка"', () => {
    const { result } = renderHook(() => useEditorState(), { wrapper });
    const { a } = seedTwoPoints(result);

    let routeId = '';
    act(() => {
      routeId = result.current.addRoute({
        startPointId: a,
        end: { type: 'coordinates', coordinates: { lng: 10, lat: 10 } },
      });
    });

    const route = result.current.elements.find((e) => e.id === routeId) as MapRoute | undefined;
    expect(route?.label).toBe('Москва → произвольная точка');
  });

  it('updateRouteSettings merges line fields and keeps stroke atomic', () => {
    const { result } = renderHook(() => useEditorState(), { wrapper });
    const { a, b } = seedTwoPoints(result);
    let id = '';
    act(() => {
      id = result.current.addRoute({ startPointId: a, end: { type: 'point', pointId: b } });
    });
    act(() => result.current.updateRouteSettings(id, { color: '#abcdef', thickness: 7 }));
    act(() =>
      result.current.updateRouteSettings(id, {
        stroke: { enabled: false } as never, // exercise the merge path
      })
    );

    const route = result.current.elements.find((e) => e.id === id) as MapRoute | undefined;
    expect(route?.settings.color).toBe('#abcdef');
    expect(route?.settings.thickness).toBe(7);
    expect(route?.settings.stroke.enabled).toBe(false);
    // Merge must preserve the other stroke fields — this is the whole
    // point of spreading inside the reducer.
    expect(typeof route?.settings.stroke.size).toBe('number');
  });

  it('flipping useRoadRoute invalidates the OSRM cache', () => {
    const { result } = renderHook(() => useEditorState(), { wrapper });
    const { a, b } = seedTwoPoints(result);
    let id = '';
    act(() => {
      id = result.current.addRoute({ startPointId: a, end: { type: 'point', pointId: b } });
    });
    // Pretend OSRM has been fetched.
    act(() =>
      result.current.setRouteOsrmCoordinates(id, [
        { lng: 1, lat: 1 },
        { lng: 2, lat: 2 },
      ])
    );
    const before = result.current.elements.find((e) => e.id === id) as MapRoute;
    expect(before.osrmCoordinates?.length).toBe(2);
    // Toggling useRoadRoute must clear the stale road geometry.
    act(() => result.current.updateRouteSettings(id, { useRoadRoute: true }));
    const after = result.current.elements.find((e) => e.id === id) as MapRoute;
    expect(after.osrmCoordinates).toBeNull();
    expect(after.settings.icon).toBe('none');
  });

  it('removing a point cascades to every route that references it', () => {
    const { result } = renderHook(() => useEditorState(), { wrapper });
    const { a, b } = seedTwoPoints(result);
    // Third point so we can keep at least one route alive after the cascade.
    let c = '';
    act(() => {
      c = result.current.addPoint({ label: 'Казань', coordinates: { lng: 49, lat: 55 } });
    });
    act(() => {
      result.current.addRoute({ startPointId: a, end: { type: 'point', pointId: b } });
    });
    act(() => {
      result.current.addRoute({ startPointId: b, end: { type: 'point', pointId: c } });
    });
    act(() => {
      result.current.addRoute({
        startPointId: a,
        end: { type: 'coordinates', coordinates: { lng: 5, lat: 5 } },
      });
    });

    expect(result.current.elements.filter((e) => e.kind === 'route')).toHaveLength(3);
    // Remove b: routes (a→b), (b→c) should disappear; (a→free) stays.
    act(() => result.current.removeElement(b));

    const survivingRoutes = result.current.elements.filter((e) => e.kind === 'route');
    expect(survivingRoutes).toHaveLength(1);
    const r = survivingRoutes[0] as MapRoute;
    expect(r.start.pointId).toBe(a);
    expect(r.end.type).toBe('coordinates');
  });

  it('invalidateRouteOsrmForPoint clears OSRM cache only after drag end', () => {
    const { result } = renderHook(() => useEditorState(), { wrapper });
    const { a, b } = seedTwoPoints(result);
    let id = '';
    act(() => {
      id = result.current.addRoute({ startPointId: a, end: { type: 'point', pointId: b } });
    });
    act(() =>
      result.current.setRouteOsrmCoordinates(id, [
        { lng: 0, lat: 0 },
        { lng: 1, lat: 1 },
      ])
    );
    act(() => result.current.moveElement(a, { lng: 40, lat: 60 }));
    // During drag, cache is kept (rebuild is deferred to drag-end).
    let route = result.current.elements.find((e) => e.id === id) as MapRoute;
    expect(route.osrmCoordinates?.length).toBe(2);
    act(() => result.current.invalidateRouteOsrmForPoint(a));
    route = result.current.elements.find((e) => e.id === id) as MapRoute;
    expect(route.osrmCoordinates).toBeNull();
    const moved = result.current.elements.find((e) => e.id === a) as MapPoint;
    expect(moved.coordinates).toEqual({ lng: 40, lat: 60 });
  });

  it('setRouteBuildMode toggles build state', () => {
    const { result } = renderHook(() => useEditorState(), { wrapper });
    expect(result.current.routeBuildMode).toBeNull();
    act(() => result.current.setRouteBuildMode({ waypointIds: [], routeId: null }));
    expect(result.current.routeBuildMode).toEqual({ waypointIds: [], routeId: null });
    act(() => result.current.setRouteBuildMode({ waypointIds: ['p-1'], routeId: 'r-1' }));
    expect(result.current.routeBuildMode?.waypointIds).toEqual(['p-1']);
    expect(result.current.routeBuildMode?.routeId).toBe('r-1');
    act(() => result.current.setRouteBuildMode(null));
    expect(result.current.routeBuildMode).toBeNull();
  });
});
