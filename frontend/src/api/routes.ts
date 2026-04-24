import { http } from './http';
import type { LngLat } from '../state/types';

// Матчит ответ backend/src/routes/route.ts. `fallback: true` означает, что
// OSRM был недоступен и coordinates = [start, end] — фронт всё равно рисует
// линию (прямую), но показывает toast-предупреждение.
export interface RouteFetchResult {
  coordinates: LngLat[];
  distance: number;
  duration: number;
  fallback: boolean;
}

export async function fetchRoute(start: LngLat, end: LngLat): Promise<RouteFetchResult> {
  const params = {
    start: `${start.lng},${start.lat}`,
    end: `${end.lng},${end.lat}`,
  };
  const res = await http.get<RouteFetchResult>('/route', { params });
  return res.data;
}
