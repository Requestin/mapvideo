import type { LngLat, MapElement, MapPoint, MapRoute } from '../../state/types';

// SPEC §Маршрут дугой: "Параболическая дуга: sin(π*t) даёт максимум в
// середине". Мы используем простую геометрию в lat-пространстве — это
// достаточно честно для внутрироссийских расстояний, и соответствует
// примерам из task6.md.
export function computeArcPoints(
  start: LngLat,
  end: LngLat,
  pointCount = 50
): LngLat[] {
  const points: LngLat[] = [];
  const dx = end.lng - start.lng;
  const dy = end.lat - start.lat;
  const distance = Math.hypot(dx, dy);
  // More gentle arc profile (was 0.2): keeps a visible curve without the
  // overly exaggerated "rainbow" shape on long distances.
  const arcHeight = distance * 0.12;
  for (let i = 0; i <= pointCount; i++) {
    const t = i / pointCount;
    points.push({
      lng: start.lng + dx * t,
      lat: start.lat + dy * t + Math.sin(Math.PI * t) * arcHeight,
    });
  }
  return points;
}

export function computeRouteLegsLngLat(route: MapRoute, elements: MapElement[]): LngLat[][] {
  if (route.settings.useRoadRoute) {
    if (route.osrmLegsCoordinates && route.osrmLegsCoordinates.length > 0) {
      return route.osrmLegsCoordinates.filter((leg) => leg.length >= 2);
    }
    if (route.osrmCoordinates && route.osrmCoordinates.length >= 2) {
      return [route.osrmCoordinates];
    }
  }

  const waypointCoords = resolveRouteWaypointCoords(route, elements);
  if (waypointCoords && waypointCoords.length >= 1) {
    const legs: LngLat[][] = [];
    for (let i = 0; i < waypointCoords.length - 1; i++) {
      const start = waypointCoords[i];
      const end = waypointCoords[i + 1];
      if (
        route.settings.arc &&
        (route.settings.icon === 'airplane' ||
          route.settings.icon === 'helicopter' ||
          route.settings.icon === 'ship' ||
          (route.settings.icon === 'car' && !route.settings.useRoadRoute))
      ) {
        legs.push(computeArcPoints(start, end));
      } else {
        legs.push([start, end]);
      }
    }
    if (route.end.type === 'coordinates') {
      const start = waypointCoords[waypointCoords.length - 1];
      const end = route.end.coordinates;
      if (
        route.settings.arc &&
        (route.settings.icon === 'airplane' ||
          route.settings.icon === 'helicopter' ||
          route.settings.icon === 'ship' ||
          (route.settings.icon === 'car' && !route.settings.useRoadRoute))
      ) {
        legs.push(computeArcPoints(start, end));
      } else {
        legs.push([start, end]);
      }
    }
    if (legs.length === 0) return [];
    return legs;
  }

  const startPoint = elements.find(
    (e): e is MapPoint => e.id === route.start.pointId && e.kind === 'point'
  );
  if (!startPoint) return [];
  let endLngLat: LngLat | null = null;
  if (route.end.type === 'point') {
    const endPointId = route.end.pointId;
    endLngLat =
      elements.find(
        (e): e is MapPoint => e.id === endPointId && e.kind === 'point'
      )?.coordinates ?? null;
  } else {
    endLngLat = route.end.coordinates;
  }
  if (!endLngLat) return [];

  if (
    route.settings.arc &&
    (route.settings.icon === 'airplane' ||
      route.settings.icon === 'helicopter' ||
      route.settings.icon === 'ship' ||
      (route.settings.icon === 'car' && !route.settings.useRoadRoute))
  ) {
    return [computeArcPoints(startPoint.coordinates, endLngLat)];
  }
  return [[startPoint.coordinates, endLngLat]];
}

/** Resolve a MapRoute to the full lng/lat polyline that should be drawn. */
export function computeRoutePathLngLat(
  route: MapRoute,
  elements: MapElement[]
): LngLat[] {
  const legs = computeRouteLegsLngLat(route, elements);
  return flattenRouteLegs(legs);
}

export function flattenRouteLegs(legs: LngLat[][]): LngLat[] {
  if (legs.length === 0) return [];
  const out: LngLat[] = [];
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    if (leg.length === 0) continue;
    if (i === 0) {
      out.push(...leg);
    } else {
      out.push(...leg.slice(1));
    }
  }
  return out;
}

/** Interpolate position + facing angle along a pixel polyline.
 *  Used by transport icons (SPEC: "Иконка поворачивается по направлению
 *  движения") and by the arrow-head draw. Angle is in radians; 0 = right.
 *  Returns null when the path is too short. */
export function sampleAlongPolyline(
  path: { x: number; y: number }[],
  t: number
): { x: number; y: number; angle: number } | null {
  if (path.length < 2) return null;
  const segLens: number[] = [];
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const len = Math.hypot(path[i + 1].x - path[i].x, path[i + 1].y - path[i].y);
    segLens.push(len);
    total += len;
  }
  if (total === 0) return { x: path[0].x, y: path[0].y, angle: 0 };
  const target = Math.max(0, Math.min(1, t)) * total;
  let acc = 0;
  for (let i = 0; i < segLens.length; i++) {
    if (acc + segLens[i] >= target) {
      const local = segLens[i] === 0 ? 0 : (target - acc) / segLens[i];
      const a = path[i];
      const b = path[i + 1];
      return {
        x: a.x + (b.x - a.x) * local,
        y: a.y + (b.y - a.y) * local,
        angle: Math.atan2(b.y - a.y, b.x - a.x),
      };
    }
    acc += segLens[i];
  }
  const last = path[path.length - 1];
  const prev = path[path.length - 2] ?? last;
  return {
    x: last.x,
    y: last.y,
    angle: Math.atan2(last.y - prev.y, last.x - prev.x),
  };
}

/** Bucket zoom to a stable half-step to avoid recomputing simplification
 *  on tiny fractional zoom changes while preserving visual continuity. */
export function bucketRouteZoom(zoom: number): number {
  return Math.round(zoom * 2) / 2;
}

/** Pixel tolerance for route simplification in world-space pixels at the
 *  current zoom bucket (lower zoom => stronger simplification). */
export function routeSimplifyTolerancePx(zoom: number): number {
  if (zoom <= 4) return 5;
  if (zoom <= 6) return 3.5;
  if (zoom <= 8) return 2.5;
  if (zoom <= 10) return 1.5;
  if (zoom <= 12) return 0.8;
  return 0.4;
}

/** Deterministic Douglas-Peucker simplification for lng/lat paths.
 *  No hard max-points cap: quality is controlled only by tolerance. */
export function simplifyLngLatPathForZoom(path: LngLat[], zoom: number): LngLat[] {
  if (path.length <= 2) return path.slice();
  const z = bucketRouteZoom(zoom);
  // For already compact paths, keep all turns on low zooms to avoid
  // over-simplified "polyline with 4-5 segments" look on country-scale views.
  if (path.length <= 64 && z <= 6) return path.slice();
  const tolerance = routeSimplifyTolerancePx(z);
  if (tolerance <= 0) return path.slice();

  const projected = path.map((p) => projectToWorldPixels(p, z));
  const keep = new Array<boolean>(path.length).fill(false);
  keep[0] = true;
  keep[path.length - 1] = true;

  const toleranceSq = tolerance * tolerance;
  const stack: Array<[number, number]> = [[0, path.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    if (end - start <= 1) continue;

    let maxDistSq = -1;
    let maxIdx = -1;
    const a = projected[start];
    const b = projected[end];
    for (let i = start + 1; i < end; i++) {
      const d = pointToSegmentDistanceSq(projected[i], a, b);
      if (d > maxDistSq) {
        maxDistSq = d;
        maxIdx = i;
      }
    }
    if (maxIdx !== -1 && maxDistSq > toleranceSq) {
      keep[maxIdx] = true;
      stack.push([start, maxIdx], [maxIdx, end]);
    }
  }

  const out: LngLat[] = [];
  for (let i = 0; i < path.length; i++) {
    if (keep[i]) out.push(path[i]);
  }
  return out;
}

function projectToWorldPixels(p: LngLat, zoom: number): { x: number; y: number } {
  const worldSize = 512 * 2 ** zoom;
  const lng = p.lng;
  const clampedLat = Math.max(Math.min(p.lat, 85.05112878), -85.05112878);
  const x = ((lng + 180) / 360) * worldSize;
  const siny = Math.sin((clampedLat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI)) * worldSize;
  return { x, y };
}

function pointToSegmentDistanceSq(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number }
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) {
    const qx = p.x - a.x;
    const qy = p.y - a.y;
    return qx * qx + qy * qy;
  }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  const px = a.x + t * dx;
  const py = a.y + t * dy;
  const qx = p.x - px;
  const qy = p.y - py;
  return qx * qx + qy * qy;
}

function resolveRouteWaypointCoords(route: MapRoute, elements: MapElement[]): LngLat[] | null {
  if (!route.waypoints || route.waypoints.length < 1) return null;
  const pointsById = new Map<string, LngLat>();
  for (const el of elements) {
    if (el.kind === 'point') pointsById.set(el.id, el.coordinates);
  }
  const coords: LngLat[] = [];
  for (const pointId of route.waypoints) {
    const c = pointsById.get(pointId);
    if (!c) return null;
    coords.push(c);
  }
  return coords;
}
