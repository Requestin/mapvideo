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

## Puppeteer — захват кадров

**КРИТИЧНО:** запускать с флагами для WebGL, иначе PixiJS не работает:

```typescript
import puppeteer from 'puppeteer';

async function захватитьКадры(
  jobId: string,
  состояние: СостояниеКарты,
  обновитьПрогресс: (п: number) => void
): Promise<string> {
  const [ширина, высота] = состояние.настройкиВидео.разрешение.split('x').map(Number);
  const папкаКадров = `/tmp/render/${jobId}/frames`;
  await fs.mkdir(папкаКадров, { recursive: true });

  const браузер = await puppeteer.launch({
    headless: 'new',
    args: [
      '--use-gl=angle',           // ОБЯЗАТЕЛЬНО для WebGL/PixiJS
      '--use-angle=swiftshader',  // программный рендерер
      '--no-sandbox',
      '--disable-setuid-sandbox',
      `--window-size=${ширина},${высота}`,
    ],
  });

  const страница = await браузер.newPage();
  await страница.setViewport({ width: ширина, height: высота, deviceScaleFactor: 1 });

  обновитьПрогресс(5);

  // Открываем страницу рендера
  await страница.goto(`http://localhost:3000/render-page?job_id=${jobId}`);

  // Ждём загрузки карты (тайлы, ассеты)
  await страница.waitForFunction(() => window.картаГотова === true, { timeout: 30000 });

  обновитьПрогресс(10);

  const { fps, длительность } = состояние.настройкиВидео;
  const всегоКадров = fps * длительность;

  // Покадровый захват через GSAP таймлайн
  for (let кадр = 0; кадр < всегоКадров; кадр++) {
    // Перематываем таймлайн на нужное время
    await страница.evaluate((время) => {
      window.мастерТаймлайн.seek(время, false);
      window.пиксиПриложение.renderer.render(window.пиксиПриложение.stage);
    }, кадр / fps);

    await страница.screenshot({
      path: `${папкаКадров}/${String(кадр).padStart(6, '0')}.png`,
      clip: { x: 0, y: 0, width: ширина, height: высота },
    });

    // 70% прогресса — захват кадров
    обновитьПрогресс(10 + Math.floor((кадр / всегоКадров) * 70));
  }

  await браузер.close();
  return папкаКадров;
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
10-80%  Захват кадров
80-95%  FFmpeg сборка видео
95-98%  Создание миниатюры
98-100% Сохранение в БД, очистка /tmp
```

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

## Очередь рендеров

```typescript
// Простая in-memory очередь (достаточно для 3-5 пользователей)
const очередь: string[] = [];
let активный: string | null = null;

async function добавитьВОчередь(jobId: string): Promise<void> {
  очередь.push(jobId);
  await обновитьСтатус(jobId, { статус: 'queued', прогресс: 0 });
  if (!активный) обработатьСледующий();
}

async function обработатьСледующий(): Promise<void> {
  if (очередь.length === 0) { активный = null; return; }
  активный = очередь.shift()!;
  try {
    await выполнитьРендер(активный);
  } catch (ошибка) {
    await обновитьСтатус(активный, { статус: 'error', ошибка: String(ошибка) });
  } finally {
    обработатьСледующий();
  }
}
```

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
*(заполняется Claude Code завершения задачи или перед завершением сессии)*
