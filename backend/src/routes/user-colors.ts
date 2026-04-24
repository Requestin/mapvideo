import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/require-auth';
import { requireCsrf } from '../middleware/require-csrf';
import { getUserCustomColors, setUserCustomColors } from '../services/users-service';
import { logger } from '../utils/logger';

const router = Router();

// Бизнес-лимит палитры — 10 ячеек (жёсткий потолок массива в БД = 20 оставлен
// про запас, на случай ошибки синхронизации между миграцией и релизом фронта).
const MAX_COLORS = 10;
const HEX_RE = /^#[0-9a-f]{6}$/i;

/**
 * Нормализует и проверяет входной массив:
 *  - отсекает не-строки;
 *  - приводит к нижнему регистру;
 *  - дедуплицирует с сохранением порядка (стратегия LRU-истории на фронте
 *    рассчитывает на то, что первый элемент — «самый свежий»);
 *  - отбрасывает всё, что не матчится `#rrggbb`.
 *
 * Возвращает `null` на непригодный ввод (не массив или слишком длинный), иначе —
 * нормализованный список до `MAX_COLORS`.
 */
function normalizeColors(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length > MAX_COLORS) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const hex = item.trim().toLowerCase();
    if (!HEX_RE.test(hex)) continue;
    if (seen.has(hex)) continue;
    seen.add(hex);
    out.push(hex);
  }
  return out;
}

router.use(requireAuth);

router.get('/me/colors', async (req: Request, res: Response) => {
  const colors = await getUserCustomColors(req.user!.id);
  res.json({ colors });
});

router.put('/me/colors', requireCsrf, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { colors?: unknown };
  const normalized = normalizeColors(body.colors);
  if (normalized === null) {
    res
      .status(400)
      .json({ error: `Ожидался массив из ≤${MAX_COLORS} hex-цветов в формате #rrggbb` });
    return;
  }

  await setUserCustomColors(req.user!.id, normalized);
  logger.debug(
    { userId: req.user!.id, count: normalized.length },
    'Updated user custom colors'
  );
  res.json({ colors: normalized });
});

export default router;
