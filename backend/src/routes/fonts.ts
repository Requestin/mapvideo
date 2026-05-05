import path from 'node:path';
import fs from 'node:fs';
import { Router, type Request, type Response } from 'express';
import { logger } from '../utils/logger';
import { resolveAssetsDir } from '../utils/resolve-assets';

const router = Router();

// Путь до папки со шрифтами. FONTS_DIR (env) — явное переопределение для
// тестов. По умолчанию берём `<assets>/fonts`, где `<assets>` — общий для
// бэкенда каталог ресурсов (см. utils/resolve-assets.ts).
const FONTS_DIR = process.env.FONTS_DIR ?? path.join(resolveAssetsDir(), 'fonts');

type FontEntry = {
  family: string;
  fileName: string;
  url: string;
  /** CSS numeric font-weight (100..900). 400 — «Regular»/без суффикса. */
  weight: number;
  /** Человекочитаемое имя начертания для селекта во фронте. */
  weightLabel: string;
};

// Соответствие имени начертания в имени файла и CSS-веса. Фронт сгенерирует
// `@font-face { font-weight: X }` для каждого варианта — без этого браузер
// и PIXI.Text могут при нескольких `Montserrat-*.ttf` выбрать случайный файл
// и игнорировать стиль.
const WEIGHT_BY_NAME: ReadonlyArray<{ name: string; weight: number; label: string }> = [
  { name: 'thin', weight: 100, label: 'Тонкий' },
  { name: 'extralight', weight: 200, label: 'Сверхлёгкий' },
  { name: 'ultralight', weight: 200, label: 'Сверхлёгкий' },
  { name: 'light', weight: 300, label: 'Лёгкий' },
  { name: 'regular', weight: 400, label: 'Обычный' },
  { name: 'normal', weight: 400, label: 'Обычный' },
  { name: 'book', weight: 400, label: 'Обычный' },
  { name: 'medium', weight: 500, label: 'Средний' },
  { name: 'semibold', weight: 600, label: 'Полужирный' },
  { name: 'demibold', weight: 600, label: 'Полужирный' },
  { name: 'bold', weight: 700, label: 'Жирный' },
  { name: 'extrabold', weight: 800, label: 'Сверхжирный' },
  { name: 'ultrabold', weight: 800, label: 'Сверхжирный' },
  { name: 'black', weight: 900, label: 'Чёрный' },
  { name: 'heavy', weight: 900, label: 'Чёрный' },
];

function resolveWeight(suffix: string): { weight: number; label: string } {
  const normalized = suffix.toLowerCase().replace(/[^a-z]/g, '');
  for (const entry of WEIGHT_BY_NAME) {
    if (normalized === entry.name) return { weight: entry.weight, label: entry.label };
  }
  // Любое неизвестное начертание (например Italic, Condensed) по умолчанию
  // трактуем как Regular-400 — это лучше, чем падать или молча терять файл.
  return { weight: 400, label: suffix || 'Обычный' };
}

// Filename convention: "Family-Weight.ttf" → family="Family", weight-suffix
// отображаем на числовой CSS-вес. Файл без `-` (например `Supermolot.ttf`) —
// считаем Regular-400.
function parseFontFile(fileName: string): FontEntry | null {
  if (!/\.(ttf|otf|woff2?)$/i.test(fileName)) return null;
  const base = fileName.replace(/\.[^.]+$/, '');
  const dashIdx = base.indexOf('-');
  const family = dashIdx > 0 ? base.slice(0, dashIdx) : base;
  const suffix = dashIdx > 0 ? base.slice(dashIdx + 1) : '';
  const { weight, label } = suffix
    ? resolveWeight(suffix)
    : { weight: 400, label: 'Обычный' };
  return { family, fileName, url: `/assets/fonts/${fileName}`, weight, weightLabel: label };
}

// One-time scan at startup — fonts never change during a process' lifetime.
// If the directory is missing we log and serve an empty list rather than
// crash; that keeps local dev working when assets haven't been copied yet.
const cache: FontEntry[] = (() => {
  try {
    const files = fs.readdirSync(FONTS_DIR, { withFileTypes: true });
    const entries: FontEntry[] = [];
    for (const f of files) {
      if (!f.isFile()) continue;
      const parsed = parseFontFile(f.name);
      if (parsed) entries.push(parsed);
    }
    entries.sort((a, b) => a.fileName.localeCompare(b.fileName));
    logger.info({ count: entries.length, dir: FONTS_DIR }, 'Fonts cache loaded');
    return entries;
  } catch (err) {
    logger.warn({ err, dir: FONTS_DIR }, 'Fonts directory not readable, serving empty list');
    return [];
  }
})();

// Public: the actual font binaries are already served from `/assets/fonts/*`,
// so exposing the directory metadata does not widen access in practice. This
// also lets headless render pages preload the exact same font set as the
// authenticated editor preview without requiring a user session cookie.
router.get('/', (_req: Request, res: Response) => {
  res.json({ fonts: cache });
});

export default router;
