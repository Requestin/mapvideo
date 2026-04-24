import { http } from './http';

// Matches backend contract (GET /api/fonts).
// `url` is served by backend `/assets/fonts/...` proxied through Vite.
export interface FontEntry {
  family: string;
  fileName: string;
  url: string;
  /** CSS numeric weight (100..900). Added in task13 так, что `Montserrat-Bold.ttf`
   *  отдаётся отдельным вариантом (700) — без этого PIXI рисует только
   *  последний подхваченный файл по имени семейства. */
  weight: number;
  /** Человекочитаемое имя начертания (для селекта «Начертание»). */
  weightLabel: string;
}

interface FontsResponse {
  fonts: FontEntry[];
}

export async function fetchFonts(): Promise<FontEntry[]> {
  const res = await http.get<FontsResponse>('/fonts');
  return res.data.fonts;
}
