import { describe, it, expect } from 'vitest';
import {
  bucketRouteZoom,
  computeArcPoints,
  computeRouteLegsLngLat,
  computeRoutePathLngLat,
  flattenRouteLegs,
  routeSimplifyTolerancePx,
  sampleAlongPolyline,
  simplifyLngLatPathForZoom,
} from '../src/pixi/routes/path';
import {
  defaultRouteSettings,
  type MapElement,
  type MapPoint,
  type MapRoute,
} from '../src/state/types';

function makePoint(id: string, lng: number, lat: number): MapPoint {
  return {
    id,
    kind: 'point',
    label: id,
    coordinates: { lng, lat },
    originCoordinates: { lng, lat },
    settings: { kind: 'blinking', color: '#fff', size: 10, speed: 50 } as never,
    labelId: `label-${id}`,
  };
}

function makeRoute(overrides: Partial<MapRoute> = {}): MapRoute {
  const base: MapRoute = {
    id: 'r1',
    kind: 'route',
    label: 'A → B',
    start: { type: 'point', pointId: 'a' },
    end: { type: 'point', pointId: 'b' },
    settings: defaultRouteSettings(),
    osrmCoordinates: null,
  };
  return { ...base, ...overrides, settings: { ...base.settings, ...(overrides.settings ?? {}) } };
}

describe('pixi/routes/path', () => {
  describe('computeArcPoints', () => {
    it('returns pointCount+1 samples spanning start→end inclusive', () => {
      const pts = computeArcPoints({ lng: 0, lat: 0 }, { lng: 10, lat: 0 }, 20);
      expect(pts).toHaveLength(21);
      expect(pts[0]).toEqual({ lng: 0, lat: 0 });
      // Endpoint exact (sin(π) = 0): lat stays on the baseline.
      expect(pts[pts.length - 1].lng).toBeCloseTo(10, 9);
      expect(pts[pts.length - 1].lat).toBeCloseTo(0, 9);
    });

    it('mid-point is offset north by sin(π/2)·arcHeight (= 0.2·distance)', () => {
      const pts = computeArcPoints({ lng: 0, lat: 0 }, { lng: 10, lat: 0 }, 10);
      // i = 5 → t = 0.5 → sin(π·0.5) = 1 → bump = 0.2·10 = 2
      expect(pts[5].lng).toBeCloseTo(5, 9);
      expect(pts[5].lat).toBeCloseTo(1.2, 9);
    });
  });

  describe('computeRoutePathLngLat', () => {
    const elements: MapElement[] = [
      makePoint('a', 0, 0),
      makePoint('b', 10, 0),
    ];

    it('returns [] when the start point has been removed', () => {
      expect(computeRoutePathLngLat(makeRoute(), [])).toEqual([]);
    });

    it('falls back to a straight segment when no special mode is set', () => {
      const path = computeRoutePathLngLat(makeRoute(), elements);
      expect(path).toHaveLength(2);
      expect(path[0]).toEqual({ lng: 0, lat: 0 });
      expect(path[1]).toEqual({ lng: 10, lat: 0 });
    });

    it('honours cached OSRM geometry whenever useRoadRoute is enabled', () => {
      const osrm = [
        { lng: 0, lat: 0 },
        { lng: 5, lat: 1 },
        { lng: 10, lat: 0 },
      ];
      // useRoadRoute + cache → cache wins (icon is ignored).
      const carRoad = makeRoute({
        osrmCoordinates: osrm,
        settings: { ...defaultRouteSettings(), icon: 'none', useRoadRoute: true },
      });
      expect(computeRoutePathLngLat(carRoad, elements)).toEqual(osrm);

      // useRoadRoute off → cache ignored, straight segment.
      const carStraight = makeRoute({
        osrmCoordinates: osrm,
        settings: { ...defaultRouteSettings(), icon: 'car', useRoadRoute: false },
      });
      expect(computeRoutePathLngLat(carStraight, elements)).toHaveLength(2);
    });

    it('uses a parabolic arc for airplane/arc mode', () => {
      const route = makeRoute({
        settings: { ...defaultRouteSettings(), icon: 'airplane', arc: true },
      });
      const path = computeRoutePathLngLat(route, elements);
      // computeArcPoints default = 50 segments → 51 samples.
      expect(path.length).toBe(51);
      // Middle sample must sit above the baseline (northward bump).
      expect(path[25].lat).toBeGreaterThan(0);
    });

    it('resolves coordinate-only endpoints', () => {
      const route = makeRoute({
        end: { type: 'coordinates', coordinates: { lng: 20, lat: 20 } },
      });
      const path = computeRoutePathLngLat(route, elements);
      expect(path).toEqual([
        { lng: 0, lat: 0 },
        { lng: 20, lat: 20 },
      ]);
    });

    it('builds one route path from waypoint legs', () => {
      const waypointRoute = makeRoute({
        waypoints: ['a', 'b', 'c'],
        end: { type: 'point', pointId: 'c' },
      });
      const all: MapElement[] = [...elements, makePoint('c', 20, 0)];
      const legs = computeRouteLegsLngLat(waypointRoute, all);
      expect(legs).toHaveLength(2);
      expect(flattenRouteLegs(legs)).toEqual([
        { lng: 0, lat: 0 },
        { lng: 10, lat: 0 },
        { lng: 20, lat: 0 },
      ]);
    });

    it('supports waypoint chain with free coordinate end', () => {
      const waypointRoute = makeRoute({
        waypoints: ['a', 'b'],
        end: { type: 'coordinates', coordinates: { lng: 15, lat: 5 } },
      });
      const legs = computeRouteLegsLngLat(waypointRoute, elements);
      expect(legs).toHaveLength(2);
      expect(flattenRouteLegs(legs)).toEqual([
        { lng: 0, lat: 0 },
        { lng: 10, lat: 0 },
        { lng: 15, lat: 5 },
      ]);
    });
  });

  describe('sampleAlongPolyline', () => {
    it('returns null for <2 points', () => {
      expect(sampleAlongPolyline([{ x: 0, y: 0 }], 0.5)).toBeNull();
    });

    it('clamps t to [0,1] and interpolates linearly on a straight 2-point path', () => {
      const path = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ];
      expect(sampleAlongPolyline(path, 0)?.x).toBeCloseTo(0, 9);
      expect(sampleAlongPolyline(path, 0.25)?.x).toBeCloseTo(25, 9);
      expect(sampleAlongPolyline(path, 1)?.x).toBeCloseTo(100, 9);
      // Over-shoot must clamp, not extrapolate.
      expect(sampleAlongPolyline(path, 9)?.x).toBeCloseTo(100, 9);
      // Angle of an east-going segment is 0 rad.
      expect(sampleAlongPolyline(path, 0.5)?.angle).toBeCloseTo(0, 9);
    });

    it('picks the correct segment on a multi-segment path', () => {
      // Two equal-length legs: east then north.
      const path = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ];
      // t = 0.75 → 75% of 20 total = 15 → 5 into the second leg → (10, 5).
      const mid = sampleAlongPolyline(path, 0.75)!;
      expect(mid.x).toBeCloseTo(10, 9);
      expect(mid.y).toBeCloseTo(5, 9);
      // Angle of the north-going leg is π/2.
      expect(mid.angle).toBeCloseTo(Math.PI / 2, 9);
    });

    it('degenerate zero-length path returns the shared origin', () => {
      const res = sampleAlongPolyline(
        [
          { x: 3, y: 4 },
          { x: 3, y: 4 },
        ],
        0.5
      );
      expect(res).toEqual({ x: 3, y: 4, angle: 0 });
    });
  });

  describe('simplifyLngLatPathForZoom', () => {
    const makeNoisyPath = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        lng: 30 + i * 0.01,
        lat: 55 + Math.sin(i * 0.6) * 0.003,
      }));

    it('is deterministic for same input and zoom', () => {
      const path = makeNoisyPath(300);
      const a = simplifyLngLatPathForZoom(path, 6.25);
      const b = simplifyLngLatPathForZoom(path, 6.25);
      expect(a).toEqual(b);
    });

    it('preserves first and last points', () => {
      const path = makeNoisyPath(120);
      const out = simplifyLngLatPathForZoom(path, 5);
      expect(out[0]).toEqual(path[0]);
      expect(out[out.length - 1]).toEqual(path[path.length - 1]);
    });

    it('uses stronger simplification on lower zoom levels', () => {
      const path = makeNoisyPath(500);
      const lowZoom = simplifyLngLatPathForZoom(path, 4);
      const highZoom = simplifyLngLatPathForZoom(path, 12);
      expect(lowZoom.length).toBeLessThan(highZoom.length);
      expect(highZoom.length).toBeLessThanOrEqual(path.length);
      expect(lowZoom.length).toBeGreaterThanOrEqual(2);
    });

    it('buckets zoom to half-steps and exposes monotonic tolerance levels', () => {
      expect(bucketRouteZoom(6.24)).toBe(6);
      expect(bucketRouteZoom(6.26)).toBe(6.5);
      expect(routeSimplifyTolerancePx(4)).toBeGreaterThan(routeSimplifyTolerancePx(8));
      expect(routeSimplifyTolerancePx(8)).toBeGreaterThan(routeSimplifyTolerancePx(12));
    });
  });
});
