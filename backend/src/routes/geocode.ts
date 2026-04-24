import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/require-auth';
import { geocodeLimiter } from '../middleware/rate-limit';
import { logger } from '../utils/logger';

const router = Router();

const PHOTON_URL = process.env.PHOTON_URL ?? 'https://photon.komoot.io/api';
// The public komoot instance only supports `default|de|en|fr` — passing
// `lang=ru` returns 400 "Language is not supported". Leaving lang empty
// makes Photon return names in whatever language OSM has them, which for
// Russian cities is Cyrillic — exactly what the Russian UI expects.
// When we self-host (cursor.md: fallback plan with 75GB worldwide index)
// we'll be able to set GEOCODE_LANG=ru to force Russian names for foreign
// places too.
const PHOTON_LANG = process.env.GEOCODE_LANG ?? '';
// Upstream safety net. Public Photon can occasionally respond much slower
// than expected from inside containerized environments (10s+ on cold paths),
// so keep a more tolerant timeout to avoid false 502s.
const PHOTON_TIMEOUT_MS = 15000;

type PhotonFeature = {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: {
    name?: string;
    city?: string;
    country?: string;
    [k: string]: unknown;
  };
};

type PhotonResponse = {
  features?: PhotonFeature[];
};

router.get('/search', requireAuth, geocodeLimiter, async (req: Request, res: Response) => {
  const q = req.query.q;
  if (typeof q !== 'string' || q.trim().length === 0) {
    res.status(400).json({ error: 'Параметр q обязателен' });
    return;
  }

  // Cap limit to avoid tying up Photon with huge queries. 5 is the SPA default.
  const rawLimit = Number(req.query.limit ?? 5);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(1, Math.trunc(rawLimit)), 20) : 5;

  // Photon нередко возвращает несколько OSM-объектов с одним и тем же display
  // name (например «Москва, Россия» × 4 для разных административных границ).
  // Чтобы после дедупликации на нашей стороне пользователь всё равно увидел
  // `limit` уникальных вариантов, оверфетчим в 3 раза (до потолка Photon в 20).
  const upstreamLimit = Math.min(20, limit * 3);
  const qs = new URLSearchParams({ q, limit: String(upstreamLimit) });
  if (PHOTON_LANG) qs.set('lang', PHOTON_LANG);
  const url = `${PHOTON_URL}?${qs.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PHOTON_TIMEOUT_MS);

  try {
    const upstream = await fetch(url, { signal: controller.signal });
    if (!upstream.ok) {
      logger.warn({ status: upstream.status, q }, 'Photon returned non-200');
      res.status(502).json({ error: 'Геокодер недоступен' });
      return;
    }
    const data = (await upstream.json()) as PhotonResponse;
    const features = Array.isArray(data.features) ? data.features : [];

    const mapped = features
      .filter((f): f is PhotonFeature => {
        return (
          f?.geometry?.type === 'Point' &&
          Array.isArray(f.geometry.coordinates) &&
          f.geometry.coordinates.length === 2
        );
      })
      .map((f) => {
        const [lng, lat] = f.geometry.coordinates;
        const name = typeof f.properties.name === 'string' ? f.properties.name : '';
        const city = typeof f.properties.city === 'string' ? f.properties.city : '';
        const country = typeof f.properties.country === 'string' ? f.properties.country : '';
        const fullName = [name, city, country].filter(Boolean).join(', ');
        return { name, fullName, coordinates: { lng, lat } };
      });

    // Дедупликация по нормализованному `fullName`: сохраняем первое вхождение
    // (Photon уже ранжирует ответы по релевантности, так что первый — лучший
    // кандидат). Пустые `fullName` не трогаем — их отфильтрует фронт.
    const seen = new Set<string>();
    const deduped: typeof mapped = [];
    for (const item of mapped) {
      const key = item.fullName.trim().toLowerCase();
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      deduped.push(item);
      if (deduped.length >= limit) break;
    }

    res.json({ results: deduped });
  } catch (err) {
    const isAbort = (err as { name?: string })?.name === 'AbortError';
    logger.warn({ err, q, isAbort }, 'Photon proxy failed');
    res.status(502).json({ error: 'Геокодер недоступен' });
  } finally {
    clearTimeout(timer);
  }
});

export default router;
