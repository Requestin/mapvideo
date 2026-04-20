# Фаза 8 — Рендер видео

**Статус:** Не начато
**Связанные файлы:** SPEC.md (раздел "Рендер видео", "История видео")
**Зависит от:**
- task2.md — авторизация (рендер привязан к пользователю)
- task3.md — панель истории видео (здесь реализуется бэкенд для неё)
- task4.md — карта (Puppeteer открывает страницу с картой)
- task5.md, task6.md — анимации (должны воспроизводиться в Puppeteer)
- task7.md — настройки видео (передаются в запрос рендера)

---

## Цель фазы
Реализовать полный пайплайн рендера: сериализация состояния редактора,
Puppeteer захват кадров, FFmpeg сборка видео, прогресс-бар, история.
---

## Skills для этой фазы

| Skill | Когда активировать |
|-------|--------------------|
| **mastering-typescript** | При написании TypeScript кода |
| **systematic-debugging** | При отладке Puppeteer + WebGL + FFmpeg пайплайна |
| **owasp-security** | При проверке безопасности download endpoints, файлов и доступа к render jobs |
| **api-contract-checker** | При изменении `POST /api/render`, `GET /api/render/*` и `/api/history/*` контрактов |
| **testing-reviewer** | Перед закрытием фазы для проверки полноты тест-покрытия рендера |
| **spec-driven-workflow** | Для удержания фазы в рамках task и корректного handoff между сессиями |

### Когда skill указывать явно

- Явно указывать **systematic-debugging**, если рендер нестабилен или прогресс не сходится.
- Явно указывать **api-contract-checker**, если меняются DTO статуса рендера/скачивания.
- Явно указывать **testing-reviewer**, если добавлен новый рендер-флоу без очевидных тестов.

---

## Задачи

- [ ] Сериализация состояния карты в JSON
- [ ] POST /api/render — запуск рендера
- [ ] GET /api/render/status/:jobId — статус и прогресс (owner check)
- [ ] GET /api/render/active — активный рендер пользователя
- [ ] GET /api/render/download/:jobId — скачивание файла (owner check)
- [ ] GET /api/render/state/:jobId — состояние карты для /render-page (owner OR internal render token check)
- [ ] Страница /render-page (для Puppeteer)
- [ ] Puppeteer: запуск браузера с WebGL флагами
- [ ] Puppeteer: ожидание загрузки карты, ассетов и `document.fonts.ready`
- [ ] Puppeteer: покадровый захват через GSAP таймлайн
- [ ] FFmpeg: сборка MP4
- [ ] FFmpeg: сборка MXF (50i через tinterlace)
- [ ] FFmpeg: создание миниатюры (первый кадр)
- [ ] Очередь рендеров (single worker, persistent в render_jobs)
- [ ] Прогресс-бар на фронтенде (polling каждые 2 сек)
- [ ] Блокировка интерфейса во время рендера
- [ ] Восстановление состояния рендера при возврате на страницу
- [ ] Автоскачивание файла после завершения
- [ ] GET /api/history — список завершённых рендеров пользователя (`render_jobs WHERE status='done'`)
- [ ] GET /api/history/:id/thumbnail — миниатюра (owner check)
- [ ] Cron задача: удаление завершённых/ошибочных render_jobs и файлов старше 10 дней

---

## Сериализация состояния

Перед отправкой на рендер — собрать всё состояние редактора в JSON:

```typescript
function serializeEditorState(): MapState {
  return {
    version: '1.0',
    map: {
      center: map.getCenter(),
      zoom: map.getZoom(),
      theme: videoSettings.theme,
    },
    video: {
      resolution: videoSettings.resolution,
      fps: videoSettings.fps,
      format: videoSettings.format,
      duration: videoSettings.duration,
      cameraBreathing: videoSettings.cameraBreathing,
    },
    elements: Array.from(editorState.elements.values()).map((el) => ({
      id: el.id,
      type: el.type,
      coordinates: el.coordinates,
      settings: el.settings,
    })),
  };
}
```

---

## Страница /render-page (фронтенд)

Отдельная страница без UI — только карта на весь экран.
Puppeteer открывает эту страницу, передаёт jobId.
Страница запрашивает состояние с бэкенда и воспроизводит карту.

```typescript
// frontend/src/pages/RenderPage.tsx
// URL: /render-page?job_id=xxx

export function RenderPage() {
  const jobId = new URLSearchParams(window.location.search).get('job_id');
  const renderToken = new URLSearchParams(window.location.search).get('render_token');

  useEffect(() => {
    async function initialize() {
      // В рендер-режиме PixiJS строим с resolution: 1 (Puppeteer viewport и так
      // равен целевому разрешению видео, DPR умножать не нужно)
      await loadFonts();                              // @font-face + document.fonts.load(...)
      const state = await fetch(
        `/api/render/state/${jobId}?render_token=${encodeURIComponent(renderToken ?? '')}`
      ).then(r => r.json());

      await initializeMap(state, { resolution: 1 });
      await initializeElements(state.elements);

      if (state.video.cameraBreathing > 0) {
        startCameraBreathing(state.video.cameraBreathing);
      }

      // Критично: дожидаемся готовности всех шрифтов ПЕРЕД тем как сказать
      // Puppeteer, что можно начинать захват — иначе первые кадры нарисуются
      // дефолтным шрифтом.
      await document.fonts.ready;

      (window as any).mapReady = true;
    }
    initialize();
  }, []);

  return <div id="render-container" style={{ width: '100vw', height: '100vh' }} />;
}
```

---

## Puppeteer — захват кадров (pipe в FFmpeg, без записи PNG на диск)

**КРИТИЧНО:** запускать с флагами для WebGL. Кадры идут напрямую в stdin FFmpeg — это экономит до 50+ ГБ временных файлов для 4K60p и ускоряет рендер в 2-3 раза.

```typescript
import puppeteer from 'puppeteer';
import { spawn } from 'node:child_process';

async function renderVideo(
  jobId: string,
  userId: string,                // берётся из req.user.id на уровне API, НЕ из state
  state: MapState,
  updateProgress: (p: number) => Promise<void>
): Promise<{ outputPath: string; thumbnailPath: string }> {
  const [width, height] = state.video.resolution.split('x').map(Number);
  const { fps, duration, format } = state.video;

  // Puppeteer всегда захватывает fps прогрессивных кадров; 50i собирается в FFmpeg
  // через tinterlace (см. buildOutputArgs).
  const captureFps = fps;
  const totalFrames = captureFps * duration;

  const userDir = `/data/videos/${userId}`;
  await fs.mkdir(userDir, { recursive: true });
  const outputPath = `${userDir}/${jobId}.${format}`;

  const browser = await puppeteer.launch({
    headless: true,              // Puppeteer 22+: new headless by default
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader', // программный WebGL — работает на сервере без GPU
      '--no-sandbox',
      '--disable-setuid-sandbox',
      `--window-size=${width},${height}`,
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });

  await updateProgress(5);

  // Бэкенд и puppeteer в одной Docker-сети — ходим на frontend по имени сервиса
  const renderToken = await issueRenderToken(jobId); // одноразовый короткоживущий токен (например, TTL 10 мин)
  await page.goto(
    `http://frontend:3000/render-page?job_id=${jobId}&render_token=${encodeURIComponent(renderToken)}`
  );
  await page.waitForFunction(() => (window as any).mapReady === true, { timeout: 60000 });
  await updateProgress(10);

  // FFmpeg: вход = captureFps кадров/сек в PNG-потоке через stdin.
  const ffmpeg = spawn('ffmpeg', [
    '-y',
    '-f', 'image2pipe',
    '-framerate', String(captureFps),   // input rate = capture rate
    '-i', '-',
    ...buildOutputArgs(format, fps, `${width}x${height}`),
    outputPath,
  ]);
  ffmpeg.stderr.on('data', (d) => logger.debug(d.toString()));
  const ffmpegDone = new Promise<void>((res, rej) => {
    ffmpeg.on('close', (code) => code === 0 ? res() : rej(new Error(`ffmpeg exit ${code}`)));
  });

  // Покадровый захват.
  // В RenderPage на window выставлены masterTimeline и pixiApp — это контракт
  // между фронтом и бэком именно для /render-page.
  for (let frame = 0; frame < totalFrames; frame++) {
    await page.evaluate((t) => {
      (window as any).masterTimeline.seek(t, false);
      (window as any).pixiApp.renderer.render((window as any).pixiApp.stage);
    }, frame / captureFps);

    const buf = await page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width, height },
      omitBackground: false,
    });
    // Backpressure-safe запись, чтобы не раздувать память на 4K/длинных роликах.
    if (!ffmpeg.stdin.write(buf)) {
      await new Promise<void>((resolve) => ffmpeg.stdin.once('drain', resolve));
    }
    await updateProgress(10 + Math.floor((frame / totalFrames) * 70));
  }

  ffmpeg.stdin.end();
  await browser.close();
  await ffmpegDone;
  await updateProgress(85);

  // Миниатюра (первый кадр готового видео)
  const thumbnailPath = `${userDir}/${jobId}.jpg`;
  await new Promise<void>((res, rej) => {
    const t = spawn('ffmpeg', [
      '-y', '-ss', '0', '-i', outputPath, '-vframes', '1',
      '-vf', 'scale=320:-1', thumbnailPath,
    ]);
    t.on('close', (code) => code === 0 ? res() : rej(new Error(`thumb exit ${code}`)));
  });

  return { outputPath, thumbnailPath };
}

function buildOutputArgs(format: 'mp4' | 'mxf', fps: number, res: string): string[] {
  if (format === 'mp4') {
    return [
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-preset', 'slow', '-crf', '18',
      '-s', res, '-r', String(fps), '-movflags', '+faststart',
    ];
  }
  // MXF — MPEG-2, XDCAM-совместимый
  if (fps === 50) {
    // 50i: вход 50p → tinterlace=4 объединяет пары соседних кадров в 25 interlaced,
    // выход 25 fps interlaced (= 50 полей/сек, как и нужно для XDCAM 50i).
    return [
      '-c:v', 'mpeg2video', '-pix_fmt', 'yuv422p',
      '-q:v', '2', '-s', res,
      '-vf', 'tinterlace=4,fieldorder=tff',
      '-r', '25',
      '-flags', '+ilme+ildct', '-top', '1',
      '-f', 'mxf',
    ];
  }
  // MXF profiles:
  // - 25  -> progressive 25p
  // - 30  -> progressive 30p (non-broadcast preset, но предсказуемый контракт)
  // - 60  -> progressive 60p (non-broadcast preset, high-motion)
  // Если нужен strict broadcast-профиль, добавить отдельный enum videoProfile и
  // жёсткую матрицу поддерживаемых режимов (например, XDCAM_50I/XDCAM_25P).
  return [
    '-c:v', 'mpeg2video', '-pix_fmt', 'yuv422p',
    '-q:v', '2', '-s', res, '-r', String(fps),
    '-f', 'mxf',
  ];
}
```

---

## Этапы прогресса

```
0-5%    Инициализация Puppeteer
5-10%   Загрузка карты в браузере
10-80%  Захват кадров (+ pipe в FFmpeg параллельно)
80-95%  Ждём завершения FFmpeg (последние буферы)
95-98%  Создание миниатюры (первый кадр через ffmpeg -ss 0 ... -vframes 1)
98-100% Финализация: render_jobs.status='done', progress=100, output_path, thumbnail_path
```

**Миниатюра** создаётся отдельным вызовом FFmpeg по готовому файлу, не требует сохранения отдельного PNG во время рендера.

---

## Прогресс-бар (фронтенд)

```typescript
// Polling каждые 2 секунды пока статус не 'done' или 'error'
async function startPolling(jobId: string): Promise<void> {
  const interval = setInterval(async () => {
    const status = await fetch(`/api/render/status/${jobId}`).then(r => r.json());

    updateProgressBar(status.progress, status.message);

    if (status.status === 'done') {
      clearInterval(interval);
      // Автоматическое скачивание
      const link = document.createElement('a');
      link.href = status.downloadUrl;
      link.click();
      unlockUI();
    }

    if (status.status === 'error') {
      clearInterval(interval);
      showError(status.error);
      unlockUI();
    }
  }, 2000);
}
```

---

## Очередь рендеров (persistent в PostgreSQL)

Источник истины — таблица `render_jobs` (см. task2.md). Single-worker: одновременно
на сервере выполняется **один** рендер (Puppeteer + WebGL на 4K тяжёлый, параллельно
не тянем). Остальные — в очереди.

**Лимиты очереди:**
- один `queued|running` рендер на пользователя (попытка второго → 429);
- общая очередь `queued|running` в системе — до 5 (попытка шестого → 429).

```typescript
const MAX_QUEUE = 5;

// При старте бэкенда (в т.ч. после рестарта/краша):
//  1. Найти все render_jobs в статусе 'running' — пометить 'error' (сессия потеряна)
//  2. Начать обработку очереди из 'queued' заданий по created_at
async function recoverAndStart(): Promise<void> {
  await db.query(`
    UPDATE render_jobs SET status = 'error',
      error_message = 'Рендер прерван рестартом сервера', updated_at = NOW()
    WHERE status = 'running'
  `);
  processNextJob();
}

let activeJobId: string | null = null;

async function processNextJob(): Promise<void> {
  if (activeJobId) return;
  const { rows } = await db.query(`
    UPDATE render_jobs SET status = 'running', updated_at = NOW()
    WHERE id = (
      SELECT id FROM render_jobs WHERE status = 'queued'
      ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `);
  if (rows.length === 0) return;
  activeJobId = rows[0].id;

  try {
    const { outputPath, thumbnailPath } = await renderVideo(
      rows[0].id,
      rows[0].user_id,                 // userId из БД, не из state
      rows[0].state_json,
      async (p) => {
        await db.query(
          'UPDATE render_jobs SET progress = $1, updated_at = NOW() WHERE id = $2',
          [p, rows[0].id]
        );
      },
    );
    await db.query(
      `UPDATE render_jobs SET status = 'done', progress = 100,
         output_path = $1, thumbnail_path = $2, updated_at = NOW()
       WHERE id = $3`,
      [outputPath, thumbnailPath, rows[0].id],
    );
  } catch (err) {
    logger.error({ err, jobId: rows[0].id }, 'Рендер завершился с ошибкой');
    await db.query(
      `UPDATE render_jobs SET status = 'error', error_message = $1, updated_at = NOW() WHERE id = $2`,
      [err instanceof Error ? err.message : String(err), rows[0].id],
    );
  } finally {
    activeJobId = null;
    setImmediate(processNextJob);
  }
}

// Ограничения: один активный рендер на пользователя + общий лимит очереди
async function enqueueRender(userId: string, state: MapState): Promise<string> {
  const mine = await db.query(
    `SELECT id FROM render_jobs WHERE user_id = $1 AND status IN ('queued','running') LIMIT 1`,
    [userId],
  );
  if (mine.rows.length > 0) {
    throw { status: 429, error: 'У вас уже есть активный рендер' };
  }

  const queued = await db.query(
    `SELECT count(*)::int AS n FROM render_jobs WHERE status IN ('queued','running')`,
  );
  if (queued.rows[0].n >= MAX_QUEUE) {
    throw { status: 429, error: 'Очередь рендеров переполнена, попробуйте позже' };
  }

  const { rows } = await db.query(
    `INSERT INTO render_jobs (user_id, status, progress, state_json)
     VALUES ($1, 'queued', 0, $2) RETURNING id`,
    [userId, state],
  );
  setImmediate(processNextJob);
  return rows[0].id;
}
```

**Graceful shutdown:** на SIGTERM бэкенд перестаёт брать новые задания и ждёт завершения текущего (до таймаута, после — kill puppeteer и пометить 'error').

---

## Авторизация и ownership в эндпоинтах рендера

Для всех `GET /api/render/:op/:jobId` и `GET /api/history/:id/*` обязательно проверять:

```typescript
async function requireJobOwner(req, res, next) {
  const { rows } = await db.query(
    `SELECT * FROM render_jobs WHERE id = $1 AND user_id = $2`,
    [req.params.jobId ?? req.params.id, req.user.id],
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Не найдено' });
  req.job = rows[0];
  next();
}
```

`404` (а не `403`) — чтобы не раскрывать наличие чужого job id.

Для `GET /api/render/state/:jobId` разрешить два режима:
- owner-доступ через `requireAuth + requireJobOwner` (дебаг/ручной просмотр);
- внутренний доступ из рендер-воркера по `render_token` (одноразовый, TTL, привязка к jobId).

Контракт `render_token` (обязательный):
- формат: случайная строка `base64url` (минимум 256 бит энтропии);
- хранение: только `sha256(render_token)` в таблице `render_tokens`;
- привязка: `job_id` + `expires_at` + `used_at`;
- TTL: 10 минут по умолчанию;
- одноразовость: после первого успешного `GET /api/render/state/:jobId` токен помечается `used_at=NOW()` и повторно не принимается;
- cleanup: cron очищает просроченные/использованные токены (например, старше 1 суток).

```sql
CREATE TABLE render_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES render_jobs(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON render_tokens(job_id);
CREATE INDEX ON render_tokens(expires_at);
```

---

## Cron — удаление старых рендеров и render_token

Источник истины — `render_jobs` и `render_tokens`.
Чистим:
- завершённые (`done`/`error`/`cancelled`) рендеры старше 10 дней вместе с файлами на диске;
- `render_tokens` со статусом `used_at IS NOT NULL` или `expires_at < NOW()` (с запасом по возрасту).

```typescript
// Запускать каждый день в 3:00
import cron from 'node-cron';

cron.schedule('0 3 * * *', async () => {
  const { rows } = await db.query(`
    SELECT id, output_path, thumbnail_path FROM render_jobs
    WHERE status IN ('done','error','cancelled')
      AND updated_at < NOW() - INTERVAL '10 days'
  `);
  for (const job of rows) {
    if (job.output_path)    await fs.unlink(job.output_path).catch(() => {});
    if (job.thumbnail_path) await fs.unlink(job.thumbnail_path).catch(() => {});
    await db.query('DELETE FROM render_jobs WHERE id = $1', [job.id]);
  }

  await db.query(`
    DELETE FROM render_tokens
    WHERE used_at IS NOT NULL
       OR expires_at < NOW()
       OR created_at < NOW() - INTERVAL '1 day'
  `);
});
```

---

## API эндпоинты этой фазы

Правила доступа:
- `POST /api/render` требует `requireAuth` + `requireCsrf`;
- `GET /api/render/status/:jobId`, `GET /api/render/active`,
  `GET /api/render/download/:jobId`, `GET /api/history`, `GET /api/history/:id/*`
  требуют `requireAuth` (+ `requireJobOwner` где есть `:jobId/:id`);
- `GET /api/render/state/:jobId` работает в двух режимах:
  `requireAuth + requireJobOwner` ИЛИ валидный `render_token`.

```
POST /api/render                        — запуск рендера (требует X-CSRF-Token)
GET  /api/render/status/:jobId          — статус и прогресс
GET  /api/render/active                 — активный рендер пользователя
GET  /api/render/download/:jobId        — скачать готовый файл
GET  /api/render/state/:jobId           — состояние карты для /render-page
GET  /api/history                       — завершённые рендеры пользователя
                                           (SELECT * FROM render_jobs
                                            WHERE user_id = ? AND status='done'
                                            ORDER BY updated_at DESC)
GET  /api/history/:id/download          — скачать из истории
GET  /api/history/:id/thumbnail         — миниатюра
```

Скачивание файлов (`/api/render/download/:jobId`, `/api/history/:id/download`) должно
возвращать `Content-Disposition: attachment; filename="<jobId>.<ext>"`.

---

## Заметка для следующей сессии
*(заполняется завершения задачи или перед завершением сессии)*
