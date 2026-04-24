import { http } from './http';

// Mirrors backend /api/geocode/search contract (see backend/src/routes/geocode.ts).
export interface GeocodeResult {
  name: string;
  fullName: string;
  coordinates: { lng: number; lat: number };
}

interface GeocodeResponse {
  results: GeocodeResult[];
}

export async function geocodeSearch(q: string, limit = 5): Promise<GeocodeResult[]> {
  const res = await http.get<GeocodeResponse>('/geocode/search', {
    params: { q, limit },
  });
  return res.data.results;
}
