import path from 'node:path';
import fs from 'node:fs';

// Путь до `assets/` зависит от развёртывания:
// • В docker-compose.yml в сервис backend монтируется `./assets:/app/assets`,
//   и `process.cwd()` в контейнере равен `/app` — значит ассеты лежат в
//   `/app/assets`.
// • При локальном запуске `npm run dev` из `backend/`, `cwd` — это
//   `repo/backend`, и ассеты лежат на уровень выше — `repo/assets`.
// До task13 код использовал только второй вариант, из-за чего в Docker все
// `/assets/**` возвращали 404 (а `/api/fonts` — пустой список, потому что
// FONTS_DIR указывал на несуществующую директорию). Этот helper честно
// проверяет оба кандидата и берёт первый существующий.
//
// Переопределение через `ASSETS_DIR` (process.env) по-прежнему работает —
// тесты и экзотичные деплои этим пользуются.
export function resolveAssetsDir(): string {
  const override = process.env.ASSETS_DIR;
  if (override) return override;
  const candidates = [
    path.resolve(process.cwd(), 'assets'),
    path.resolve(process.cwd(), '..', 'assets'),
  ];
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isDirectory()) return c;
    } catch {
      // Пропускаем: пробуем следующий кандидат.
    }
  }
  // Ни один путь не найден — возвращаем первый, чтобы лог «directory not
  // readable» в routes/fonts.ts был осмысленным, а express.static просто
  // отдавал 404 на каждый запрос к `/assets/*`.
  return candidates[0];
}
