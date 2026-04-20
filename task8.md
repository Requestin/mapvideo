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
| **vibesec-skill** | При работе с файловой системой, временными файлами и путями |

---

## Задачи

- [ ] Сериализация состояния карты в JSON
- [ ] POST /api/render — запуск рендера
- [ ] GET /api/render/status/:jobId — статус и прогресс
- [ ] GET /api/render/active — активный рендер пользователя
- [ ] GET /api/render/download/:jobId — скачивание файла
- [ ] Страница /render-page (для Puppeteer)
- [ ] Puppeteer: запуск браузера с WebGL флагами
- [ ] Puppeteer: ожидание загрузки карты и ассетов
- [ ] Puppeteer: покадровый захват через GSAP таймлайн
- [ ] FFmpeg: сборка MP4
- [ ] FFmpeg: сборка MXF
- [ ] FFmpeg: создание миниатюры (первый кадр)
- [ ] Очередь рендеров
- [ ] Прогресс-бар на фронтенде (polling каждые 2 сек)
- [ ] Блокировка интерфейса во время рендера
- [ ] Восстановление состояния рендера при возврате на страницу
- [ ] Автоскачивание файла после завершения
- [ ] GET /api/videos — список видео пользователя
- [ ] GET /api/videos/:id/download — скачивание из истории
- [ ] GET /api/videos/:id/thumbnail — миниатюра
- [ ] Cron задача: удаление видео старше 10 дней

---

## Сериализация состояния

Перед отправкой на рендер — собрать всё состояние редактора в JSON:

```typescript
function сериализоватьСостояние(): СостояниеКарты {
  return {
    версия: '1.0',
    карта: {
      центр: карта.getCenter(),
      зум: карта.getZoom(),
      тема: настройкиВидео.тема,
    },
    настройкиВидео: {
      разрешение: настройкиВидео.разрешение,
      fps: настройкиВидео.fps,
      формат: настройкиВидео.формат,
      длительность: настройкиВидео.длительность,
      дыханиеКамеры: настройкиВидео.дыханиеКамеры,
    },
    элементы: Array.from(состояниеРедактора.элементы.values()).map(э => ({
      id: э.id,
      тип: э.тип,
      координаты: э.координаты,
      настройки: э.настройки,
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
// frontend/src/страницы/СтраницаРендера.tsx
// URL: /render-page?job_id=xxx

export function СтраницаРендера() {
  const jobId = new URLSearchParams(window.location.search).get('job_id');

  useEffect(() => {
    async function инициализировать() {
      // Получаем состояние с бэкенда
      const состояние = await fetch(`/api/render/state/${jobId}`).then(r => r.json());

      // Воспроизводим карту с этим состоянием
      await инициализироватьКарту(состояние);
      await инициализироватьЭлементы(состояние.элементы);

      // Дыхание камеры если включено
      if (состояние.настройкиВидео.дыханиеКамеры > 0) {
        запуститьДыхание(состояние.настройкиВидео.дыханиеКамеры);
      }

      // Ставим флаг — карта готова к захвату
      window.картаГотова = true;
    }
    инициализировать();
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
  state: MapState,
  updateProgress: (p: number) => void
): Promise<string> {
  const [width, height] = state.video.resolution.split('x').map(Number);
  const { fps, duration, format } = state.video;
  const totalFrames = fps * duration;
  const outputPath = `/data/videos/${state.userId}/${jobId}.${format}`;

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',   // программный WebGL — работает и в WSL2, и на сервере без GPU
      '--no-sandbox',
      '--disable-setuid-sandbox',
      `--window-size=${width},${height}`,
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });

  updateProgress(5);

  // Бэкенд и puppeteer в одной Docker-сети — ходим на frontend по имени сервиса
  await page.goto(`http://frontend:3000/render-page?job_id=${jobId}`);
  await page.waitForFunction(() => (window as any).mapReady === true, { timeout: 30000 });
  updateProgress(10);

  // Запускаем FFmpeg, кадры в stdin как PNG поток
  const ffmpeg = spawn('ffmpeg', [
    '-y',
    '-f', 'image2pipe',
    '-framerate', String(fps === 50 ? 25 : fps),   // 50i = 25 кадров прогрессивных, позже интерлейсим
    '-i', '-',
    ...buildOutputArgs(format, fps, `${width}x${height}`),
    outputPath,
  ]);
  ffmpeg.stderr.on('data', (d) => логгер.debug(d.toString()));
  const ffmpegDone = new Promise<void>((res, rej) => {
    ffmpeg.on('close', (code) => code === 0 ? res() : rej(new Error(`ffmpeg exit ${code}`)));
  });

  // Покадровый захват
  for (let frame = 0; frame < totalFrames; frame++) {
    await page.evaluate((t) => {
      (window as any).masterTimeline.seek(t, false);
      (window as any).pixiApp.renderer.render((window as any).pixiApp.stage);
    }, frame / fps);

    const buf = await page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width, height },
      omitBackground: false,
    });
    ffmpeg.stdin.write(buf);
    updateProgress(10 + Math.floor((frame / totalFrames) * 70));
  }

  ffmpeg.stdin.end();
  await browser.close();
  await ffmpegDone;
  updateProgress(85);

  return outputPath;
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
  const args = [
    '-c:v', 'mpeg2video', '-pix_fmt', 'yuv422p',
    '-q:v', '2', '-s', res, '-r', String(fps === 50 ? 25 : fps),
  ];
  if (fps === 50) {
    // 50i — интерлейс из 25p прогрессивного источника
    args.push('-vf', 'tinterlace=4,fieldorder=tff', '-flags', '+ilme+ildct', '-top', '1');
  }
  args.push('-f', 'mxf');
  return args;
}
```

---

## FFmpeg — сборка видео

```typescript
import ffmpeg from 'fluent-ffmpeg';

async function собратьMP4(папкаКадров: string, выход: string, fps: number, разрешение: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(`${папкаКадров}/%06d.png`)
      .inputFPS(fps)
      .videoCodec('libx264')
      .outputOptions(['-pix_fmt yuv420p', '-preset slow', '-crf 18', `-s ${разрешение}`, '-movflags +faststart'])
      .output(выход)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

async function собратьMXF(папкаКадров: string, выход: string, fps: number, разрешение: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(`${папкаКадров}/%06d.png`)
      .inputFPS(fps)
      .videoCodec('mpeg2video')
      .outputOptions(['-pix_fmt yuv422p', '-q:v 2', `-s ${разрешение}`, '-f mxf'])
      .output(выход)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

async function создатьМиниатюру(первыйКадр: string, выход: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(первыйКадр)
      .outputOptions(['-vframes 1', '-s 320x180'])
      .output(выход)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
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
98-100% Запись в таблицу videos, удаление render_job
```

**Миниатюра** создаётся отдельным вызовом FFmpeg по готовому файлу, не требует сохранения отдельного PNG во время рендера.

---

## Прогресс-бар (фронтенд)

```typescript
// Polling каждые 2 секунды пока статус не 'done' или 'error'
async function запуститьПоллинг(jobId: string): Promise<void> {
  const интервал = setInterval(async () => {
    const статус = await fetch(`/api/render/status/${jobId}`).then(r => r.json());

    обновитьПрогрессБар(статус.прогресс, статус.сообщение);

    if (статус.статус === 'done') {
      clearInterval(интервал);
      // Автоматическое скачивание
      const ссылка = document.createElement('a');
      ссылка.href = статус.downloadUrl;
      ссылка.click();
      разблокироватьИнтерфейс();
    }

    if (статус.статус === 'error') {
      clearInterval(интервал);
      показатьОшибку(статус.ошибка);
      разблокироватьИнтерфейс();
    }
  }, 2000);
}
```

---

## Очередь рендеров (persistent в PostgreSQL)

Источник истины — таблица `render_jobs` (см. task2.md). In-memory держим только активный воркер.

```typescript
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
    const outputPath = await renderVideo(rows[0].id, rows[0].state_json, async (p) => {
      await db.query('UPDATE render_jobs SET progress = $1, updated_at = NOW() WHERE id = $2', [p, rows[0].id]);
    });
    await db.query(`UPDATE render_jobs SET status = 'done', progress = 100,
      output_path = $1, updated_at = NOW() WHERE id = $2`, [outputPath, rows[0].id]);
  } catch (err) {
    await db.query(`UPDATE render_jobs SET status = 'error',
      error_message = $1, updated_at = NOW() WHERE id = $2`, [String(err), rows[0].id]);
  } finally {
    activeJobId = null;
    setImmediate(processNextJob);
  }
}

// Ограничение: один активный рендер на пользователя
async function enqueueRender(userId: string, state: MapState): Promise<string> {
  const existing = await db.query(
    `SELECT id FROM render_jobs WHERE user_id = $1 AND status IN ('queued','running') LIMIT 1`,
    [userId]
  );
  if (existing.rows.length > 0) {
    throw { status: 429, ошибка: 'У вас уже есть активный рендер' };
  }
  const { rows } = await db.query(
    `INSERT INTO render_jobs (user_id, status, progress, state_json)
     VALUES ($1, 'queued', 0, $2) RETURNING id`,
    [userId, state]
  );
  setImmediate(processNextJob);
  return rows[0].id;
}
```

**Graceful shutdown:** на SIGTERM бэкенд перестаёт брать новые задания и ждёт завершения текущего (до таймаута, после — kill puppeteer и пометить 'error').

---

## Cron — удаление старых видео

```typescript
// Запускать каждый день в 3:00
import cron from 'node-cron';

cron.schedule('0 3 * * *', async () => {
  const устаревшие = await найтиВидеоСтаршеДней(10);
  for (const видео of устаревшие) {
    await fs.unlink(видео.путьКФайлу).catch(() => {});
    await fs.unlink(видео.путьМиниатюры).catch(() => {});
    await удалитьВидеоИзБД(видео.id);
  }
});
```

---

## API эндпоинты этой фазы

```
POST /api/render                       — запуск рендера
GET  /api/render/status/:jobId         — статус и прогресс
GET  /api/render/active                — активный рендер пользователя
GET  /api/render/download/:jobId       — скачать готовый файл
GET  /api/render/state/:jobId          — состояние карты для /render-page
GET  /api/videos                       — история видео пользователя
GET  /api/videos/:id/download          — скачать из истории
GET  /api/videos/:id/thumbnail         — миниатюра
```

---

## Заметка для следующей сессии
*(заполняется завершения задачи или перед завершением сессии)*
