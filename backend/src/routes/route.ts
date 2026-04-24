import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/require-auth';
import { routeLimiter } from '../middleware/rate-limit';
import { logger } from '../utils/logger';

// Прокси к OSRM-демону. URL берётся из env так же, как `PHOTON_URL`/`MARTIN_URL`
// в соседних прокси-роутах, чтобы тесты могли подменить его на mock-сервер
// без трогания compose, а локальный запуск работал вне Docker.
const OSRM_URL = process.env.OSRM_URL ?? 'http://osrm:5000';
// OSRM v5.27 отвечает в пределах 1–2 с на маршрут по России. 10 с — страховка
// на "холодный" маршрут + сетевые задержки.
const OSRM_TIMEOUT_MS = 10_000;

const router = Router();

type OsrmResponse = {
  code: string;
  routes?: Array<{
    geometry: { type: 'LineString'; coordinates: [number, number][] };
    distance: number;
    duration: number;
  }>;
};

/** Парсит "lng,lat" с валидацией диапазонов. */
function parseCoord(raw: unknown): { lng: number; lat: number } | null {
  if (typeof raw !== 'string') return null;
  const parts = raw.split(',');
  if (parts.length !== 2) return null;
  const lng = Number(parts[0]);
  const lat = Number(parts[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (lng < -180 || lng > 180) return null;
  if (lat < -90 || lat > 90) return null;
  return { lng, lat };
}

// GET /api/route?start=37.618,55.751&end=30.315,59.939
//
// Успех: { coordinates: [{lng,lat}...], distance, duration, fallback: false }
// Фолбэк (OSRM недоступен / network / code!==Ok): возвращаем прямую линию
// `[start, end]` с `fallback: true` и статусом 200 — фронт дальше покажет toast
// "Маршрут по дороге временно недоступен" и отрисует прямой отрезок вместо
// дорожной геометрии. 200+fallback выбран сознательно: с клиентской точки
// зрения маршрут "есть", просто деградированный, и UX-ветка у фронта одна.
router.get('/', requireAuth, routeLimiter, async (req: Request, res: Response) => {
  const start = parseCoord(req.query.start);
  const end = parseCoord(req.query.end);
  if (!start || !end) {
    res.status(400).json({ error: 'Неверный формат координат' });
    return;
  }

  const startStr = `${start.lng},${start.lat}`;
  const endStr = `${end.lng},${end.lat}`;
  const url =
    `${OSRM_URL.replace(/\/$/, '')}/route/v1/driving/${startStr};${endStr}` +
    '?overview=simplified&geometries=geojson&steps=false&annotations=false';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OSRM_TIMEOUT_MS);

  const fallback = (reason: string, statusHint?: number): void => {
    logger.warn({ reason, statusHint, start, end }, 'OSRM недоступен, возвращаем прямую линию');
    res.status(200).json({
      coordinates: [start, end],
      distance: 0,
      duration: 0,
      fallback: true,
    });
  };

  try {
    const upstream = await fetch(url, { signal: controller.signal });
    if (!upstream.ok) {
      fallback('osrm-non-200', upstream.status);
      return;
    }
    const data = (await upstream.json()) as OsrmResponse;
    if (data.code !== 'Ok' || !data.routes || !data.routes[0]) {
      // OSRM вернул 200, но с code вроде "NoRoute"/"InvalidQuery" — для UI это
      // та же деградация: сырые точки остались, просто без дорожной привязки.
      fallback('osrm-code-' + (data.code ?? 'unknown'));
      return;
    }

    const r = data.routes[0];
    const coordinates = r.geometry.coordinates.map(([lng, lat]) => ({ lng, lat }));
    res.json({
      coordinates,
      distance: r.distance,
      duration: r.duration,
      fallback: false,
    });
  } catch (err) {
    const isAbort = (err as { name?: string })?.name === 'AbortError';
    fallback(isAbort ? 'osrm-timeout' : 'osrm-network');
  } finally {
    clearTimeout(timer);
  }
});

export default router;
