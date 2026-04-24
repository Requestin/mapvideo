# Фаза 15 — Критические баги рендер-пайплайна

**Статус:** ✅ Завершено
**Зависит от:** task8.md (рендер видео)

---

## Цель фазы

Устранить четыре критических бага в серверном рендере видео, которые могут привести к падению сервера, двойным рендерам или обходу лимитов.

---

## Задачи

### 15.1 — Гонка в очереди рендера (п.1 ревью)

**Файл:** `backend/src/render/render-queue.ts`

**Проблема:** `processNextJob()` проверяет `if (activeJobId) return`, но два вызова могут одновременно пройти эту проверку и запустить два Puppeteer параллельно.

**Решение:** Заменить флаг `activeJobId` на мьютекс (простой `let processing = false` с выставлением **до** SQL-запроса, не после):

```typescript
let processing = false;

async function processNextJob(): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    // SELECT … FOR UPDATE SKIP LOCKED + renderVideoJob
  } finally {
    processing = false;
    // Проверить, есть ли ещё задачи
  }
}
```

**Тест:** Юнит-тест — два параллельных вызова `processNextJob()`, проверить что `renderVideoJob` вызван ровно один раз.

---

### 15.2 — Утечка браузера Chrome при ошибке (п.2 ревью)

**Файл:** `backend/src/render/render-video.ts`

**Проблема:** Если ошибка произойдёт после `puppeteer.launch()` — браузер не закрывается, Chrome висит в памяти.

**Решение:** Обернуть весь блок в `try/finally`:

```typescript
const browser = await puppeteer.launch(…);
try {
  // page, ffmpeg, screenshot loop…
} finally {
  await browser.close().catch(() => {});
  // Также убить ffmpeg если жив
}
```

**Тест:** Мок-тест — бросить ошибку в `page.goto`, проверить что `browser.close()` вызван.

---

### 15.3 — Обход лимита очереди (TOCTOU) (п.3 ревью)

**Файл:** `backend/src/render/render-queue.ts`, функция `enqueueRender`

**Проблема:** Проверка «есть ли у пользователя рендер» и «не переполнена ли очередь» — отдельные SELECT'ы, между ними может проскочить другой запрос.

**Решение:** Обернуть в одну транзакцию с `SERIALIZABLE` или `SELECT … FOR UPDATE`:

```typescript
const client = await pool.connect();
await client.query('BEGIN');
// SELECT count + SELECT mine FOR UPDATE
// INSERT
await client.query('COMMIT');
```

**Тест:** Существующий тест «429 если уже есть queued job» достаточен; добавить тест с mock-race если возможно.

---

### 15.4 — Слабая валидация MapState (DoS) (п.4 ревью)

**Файл:** `backend/src/render/map-state.ts`

**Проблема:** `isMapStateV1` не проверяет значения — можно прислать `duration: 999999` и загрузить сервер.

**Решение:** Добавить проверку полей:

- `duration` — число, 3 ≤ n ≤ 60
- `fps` — одно из [25, 30, 50, 60]
- `resolution` — одно из ['1920x1080', '3840x2160']
- `format` — одно из ['mp4', 'mxf']
- `center.lng/lat` — конечные числа
- `zoom` — 0 ≤ n ≤ 22
- `elements` — массив (длину можно ограничить, например ≤ 500)

**Тест:** Юнит-тесты на `isMapStateV1` с невалидными данными (duration:999, fps:999, и т.д.).

---

## Порядок выполнения

15.1 → 15.2 → 15.3 → 15.4 (от самого опасного к менее критичному)

---

## Заметка для следующей сессии

*(заполняется по ходу работы)*