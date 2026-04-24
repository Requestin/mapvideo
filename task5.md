# Фаза 5 — Точки и подписи

**Статус:** ✅ Сделано
**Связанные файлы:** SPEC.md (раздел "Элементы карты — Точка, Подпись")
**Зависит от:**

- task4.md — карта и PixiJS слой должны быть готовы
(координаты→пиксели, overlay для событий мыши)
- task2.md — геосаджест использует GET /api/geocode/search
**Следующая фаза:** task6.md (маршруты соединяют точки созданные здесь)

---

## Цель фазы

## Реализовать добавление точек на карту через геосаджест, все 4 вида анимаций,

подписи, меню настроек с live preview, перетаскивание.

## Skills для этой фазы


| Skill                    | Когда активировать                                                      |
| ------------------------ | ----------------------------------------------------------------------- |
| **mastering-typescript** | При написании TypeScript/React кода                                     |
| **frontend-design**      | При создании UI меню настроек точек и подписей                          |
| **systematic-debugging** | При отладке анимаций PixiJS + GSAP                                      |
| **api-contract-checker** | При изменении контракта `GET /api/geocode/search` и формата результатов |
| **spec-driven-workflow** | Для синхронного выполнения задач фазы и обновления checklist            |


### Когда skill указывать явно

- Явно указывать **api-contract-checker**, если меняется структура ответа геосаджеста.
- Явно указывать **systematic-debugging**, если анимации/drag-drop работают нестабильно.
- Явно указывать **frontend-design**, если есть неоднозначность в UI настроек элемента.

---

## Задачи

- [x] Бэкенд: GET /api/geocode/search (проксирование Photon)
- [x] Фронтенд: загрузка шрифтов при старте (`GET /api/fonts` + `@font-face`, `await document.fonts.ready`)
- [x] Модальное окно "Добавить точку" с геосаджестом
- [x] Добавление точки на PixiJS слой
- [x] Автоматическое добавление подписи рядом с точкой
- [x] Автомасштаб карты при добавлении нескольких точек
- [x] Анимация "Мигающая точка" (процедурная)
- [x] Анимация "Взрыв" (PNG + круги)
- [x] Анимация "Огонь" (PNG секвенция)
- [x] Анимация "Землетрясение" (статичная PNG)
- [x] Перетаскивание точки
- [x] Перетаскивание подписи
- [x] Меню настроек точки (правая панель) с live preview
- [x] Меню настроек подписи (правая панель) с live preview
- [x] Кнопки: Сбросить настройки, Сбросить местоположение, Удалить
- [x] Диалог подтверждения удаления
- [x] Список элементов (левая панель) — точки и подписи
- [x] Обновление списка при добавлении/удалении элементов

---

## Геосаджест (бэкенд)

```typescript
// GET /api/geocode/search?q=Москва&limit=5
// Проксирует запрос к публичному Photon: https://photon.komoot.io/api
// (вариант "в" из решения — без self-hosted индекса. Если упрёмся в rate limit
// или сервис ляжет — переключаемся на self-hosted worldwide индекс 75 ГБ,
// поднимаем komoot/photon как docker-сервис и меняем URL на http://photon:2322/api)

const PHOTON_URL = process.env.PHOTON_URL || 'https://photon.komoot.io/api';
// ВАЖНО: на публичном komoot-инстансе lang поддерживает только
// default|de|en|fr. Передавать lang=ru → 400 "Language is not supported".
// Без lang Photon отдаёт имена в нативном языке OSM (для российских городов
// — кириллица), что и нужно русскоязычному UI. Когда поднимем self-hosted
// с отдельным русским индексом — включим через env GEOCODE_LANG=ru.
const PHOTON_LANG = process.env.GEOCODE_LANG || '';

router.get('/geocode/search', requireAuth, async (req, res) => {
  const { q, limit = 5 } = req.query;
  const qs = new URLSearchParams({ q: String(q), limit: String(limit) });
  if (PHOTON_LANG) qs.set('lang', PHOTON_LANG);
  const response = await fetch(`${PHOTON_URL}?${qs.toString()}`);
  const data = await response.json();

  const results = data.features.map((f: any) => ({
    name: f.properties.name,
    fullName: [f.properties.name, f.properties.city,
      f.properties.country].filter(Boolean).join(', '),
    coordinates: {
      lng: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
    },
  }));

  res.json({ results });
});
```

Для защиты публичного Photon от abuse добавить мягкий лимит на прокси-эндпоинт
(`GET /api/geocode/search`), например 60 req/min на пользователя/IP, с сообщением
`{ error: "Слишком много запросов, попробуйте позже" }`.

---

## Хранение состояния элементов

```typescript
// Глобальное состояние карты — все элементы
interface EditorState {
  elements: Map<string, MapElement>;
  addPoint: (data: PointData) => void;
  updateElement: (id: string, settings: Partial<ElementSettings>) => void;
  deleteElement: (id: string) => void;
  moveElement: (id: string, coordinates: Coordinates) => void;
}
```

---

## Анимации (PixiJS + GSAP)

Детальный код каждой анимации описан ниже.
Все анимации работают постоянно пока элемент на карте.
При изменении настроек — анимация пересоздаётся с новыми параметрами.

### Мигающая точка (процедурная)

```typescript
function createBlinkingPoint(settings: PointSettings): PIXI.Container {
  const container = new PIXI.Container();

  // Пульсирующий круг (расходится наружу, затухает)
  const pulse = new PIXI.Graphics();
  pulse.beginFill(settings.color, 0.3);
  pulse.drawCircle(0, 0, settings.size);
  pulse.endFill();

  // Основной круг
  const core = new PIXI.Graphics();
  core.beginFill(settings.color, settings.opacity / 100);
  core.drawCircle(0, 0, settings.size);
  core.endFill();
  if (settings.stroke.enabled) {
    core.lineStyle(settings.stroke.size, settings.stroke.color,
      settings.stroke.opacity / 100);
    core.drawCircle(0, 0, settings.size);
  }

  container.addChild(pulse);
  container.addChild(core);

  // GSAP анимация пульса — ОБЯЗАТЕЛЬНО fromTo, иначе на repeat:-1 значения
  // останутся как на конце первого цикла и анимации не будет.
  const speed = 1.5 / (settings.speed / 50);
  gsap.timeline({ repeat: -1 })
    .fromTo(pulse.scale, { x: 1, y: 1 },
                         { x: 2.5, y: 2.5, duration: speed, ease: 'power2.out' })
    .fromTo(pulse,       { alpha: 0.3 },
                         { alpha: 0,        duration: speed, ease: 'power2.out' }, '<');

  return container;
}
```

### Взрыв (PNG иконка + круги)

```typescript
function createExplosion(settings: PointSettings): PIXI.Container {
  const container = new PIXI.Container();

  // Статичная иконка (имена файлов — только английский, см. SPEC.md раздел "Ассеты")
  const icon = PIXI.Sprite.from('/assets/icons/explosion.png');
  icon.anchor.set(0.5);
  icon.scale.set(settings.size / 64);
  icon.alpha = settings.opacity / 100;

  // 3 кольца со сдвигом по времени
  for (let i = 0; i < 3; i++) {
    const ring = new PIXI.Graphics();
    ring.lineStyle(2, 0xFF4400, 0.8);
    ring.drawCircle(0, 0, settings.size * 0.5);
    container.addChild(ring);

    const speed = 1.5 / (settings.speed / 50);
    gsap.timeline({ repeat: -1, delay: i * (speed / 3) })
      .fromTo(ring.scale, { x: 0.5, y: 0.5 }, { x: 3, y: 3, duration: speed, ease: 'power1.out' })
      .fromTo(ring, { alpha: 0.8 }, { alpha: 0, duration: speed, ease: 'power1.out' }, '<');
  }

  container.addChild(icon);
  return container;
}
```

### Огонь (PNG секвенция 150 кадров)

```typescript
function createFire(settings: PointSettings): PIXI.Container {
  // Файлы: /assets/icons/fire_loop/ — готовая PNG секвенция (имена — английский).
  // Реальный паттерн имён: fire_loop000000.png ... fire_loop000149.png
  // (префикс `fire_loop`, 6 цифр, начиная с 000000).
  const frames = Array.from({ length: 150 }, (_, i) =>
    PIXI.Texture.from(`/assets/icons/fire_loop/fire_loop${String(i).padStart(6, '0')}.png`)
  );

  const animation = new PIXI.AnimatedSprite(frames);
  animation.anchor.set(0.5, 1); // bottom center anchor
  animation.animationSpeed = settings.speed / 50 * 0.5;
  animation.loop = true;
  animation.play();
  animation.scale.set(settings.size / 64);
  animation.alpha = settings.opacity / 100;

  const container = new PIXI.Container();
  container.addChild(animation);
  return container;
}
```

`fire_loop` содержит 150 кадров (`fire_loop000000.png`...`fire_loop000149.png`) —
это фиксированное допущение для v1 и совпадает с фактическими ассетами на сервере.

### Землетрясение (статичная иконка)

```typescript
function createEarthquake(settings: PointSettings): PIXI.Container {
  const icon = PIXI.Sprite.from('/assets/icons/earthquake.png');
  icon.anchor.set(0.5);
  icon.scale.set(settings.size / 64);
  icon.alpha = settings.opacity / 100;

  const container = new PIXI.Container();
  container.addChild(icon);
  return container;
}
```

---

## Ассеты

Все ассеты уже находятся на сервере в `assets/icons/`.
Загружать напрямую через `PIXI.Sprite.from()` и `PIXI.Texture.from()`.
Placeholder'ы не нужны.

---

## Загрузка шрифтов для подписей

`PIXI.Text` рендерит в WebGL и **видит только те шрифты, что загружены в документ** —
`@font-face` на `document.fonts`. Без этого подпись нарисуется дефолтным шрифтом браузера.

Флоу на фронте (выполняется один раз при старте приложения, до отрисовки первой точки):

```typescript
// src/services/fonts.ts
export async function loadFonts(): Promise<FontInfo[]> {
  const { fonts } = await http.get<{ fonts: FontInfo[] }>('/fonts').then(r => r.data);

  // Вставляем @font-face для каждого файла
  const style = document.createElement('style');
  style.textContent = fonts.map(f =>
    `@font-face { font-family: "${f.family}"; src: url("${f.url}") format("truetype"); font-display: block; }`
  ).join('\n');
  document.head.appendChild(style);

  // Ждём фактической загрузки всех семейств
  await Promise.all(fonts.map(f => document.fonts.load(`16px "${f.family}"`)));
  await document.fonts.ready;

  return fonts;
}
```

При серверном рендере (`task8.md`) Puppeteer тоже дожидается `document.fonts.ready`
перед установкой `window.mapReady = true`.

---

## Обновление позиций при движении карты

```typescript
// Вызывается при каждом событии move/zoom карты
function updateElementPositions(): void {
  for (const element of editorState.elements.values()) {
    const { x, y } = map.project([element.coordinates.lng, element.coordinates.lat]);
    element.pixiContainer.position.set(x, y);
  }
}
```

---

## Live preview настроек

При изменении любого параметра в правой панели — немедленно пересоздать
PixiJS контейнер элемента с новыми настройками:

```typescript
function updatePointSettings(id: string, newSettings: Partial<PointSettings>): void {
  const element = editorState.elements.get(id);
  if (!element) return;

  // Обновляем настройки
  element.settings = { ...element.settings, ...newSettings };

  // Уничтожаем старый контейнер
  element.pixiContainer.destroy({ children: true });

  // Создаём новый с обновлёнными настройками
  element.pixiContainer = createPointContainer(element.settings);
  const { x, y } = coordinatesToPixels(element.coordinates.lng, element.coordinates.lat);
  element.pixiContainer.position.set(x, y);
  pixiLayer.addChild(element.pixiContainer);
}
```

---

## Заметка для следующей сессии

task5 закрыт полностью (18/18). Редактор теперь умеет добавлять точки с геосаджестом,
анимировать их четырьмя типами, показывать подписи, таскать и точки, и подписи
независимо, редактировать настройки в живом режиме и удалять с подтверждением.

**Архитектура**

- Состояние редактора расширено до «домашних» методов: `addPoint` (создаёт `MapPoint`
  + парный `MapLabel` атомарно), `removeElement` (каскадно удаляет подпись вместе
  с точкой), `moveElement`, `updatePointSettings`, `changePointAnimation`,
  `updateLabelSettings`, `updateLabelText`, `resetPointSettings`,
  `resetPointLocation`, `resetLabelSettings`, `resetLabelLocation`. Все operations
  — через `useEditorState` (`src/state/editor-state.tsx`).
- Типы: `BlinkingPointSettings | ExplosionPointSettings | FirePointSettings |
  EarthquakePointSettings`, `LabelSettings`, `StrokeSettings`. Фабрики
  `defaultPointSettings(kind)` и `defaultLabelSettings()` — единый источник
  дефолтов для "Сбросить настройки".
- PixiJS-слой вынесен в `src/pixi/`:
  - `animations/blinking-point.ts` — пульсирующий ореол + ядро с окантовкой,
    GSAP `timeline({ repeat: -1 })` с `fromTo` (иначе repeat уходит в no-op).
  - `animations/explosion.ts` — статичная PNG + 3 расходящихся кольца со сдвигом
    по фазе.
  - `animations/fire.ts` — `PIXI.AnimatedSprite` из 150 кешированных текстур
    (`getFrames()` кеш переживает destroy, т.к. EditorMap делает
    `pixi.destroy(...texture:false)`).
  - `animations/earthquake.ts` — статичная PNG.
  - `label-renderer.ts` — `PIXI.Text` с ран-тайм применением `truncateAtComma`
    и `uppercase` через чистую `renderLabelText()` из `state/types`.
- `PixiLayer` (`src/pixi/pixi-layer.tsx`) — headless-компонент. На каждый
  render цикл `useEffect([elements])` делает reconcile: создаёт/уничтожает
  PixiJS-контейнеры так, чтобы они совпадали с состоянием. На каждом
  `map.on('render')` — `syncPositions()`: `map.project([lng,lat])` и запись
  в хит-реестр для drag-контроллера.
- `useElementDrag` — хук поверх MapLibre. Ловит `mousedown` на карте, делает
  hit-test через `pickTarget()`, отключает `dragPan`, слушает `mousemove`
  до `mouseup`, через `requestAnimationFrame` троттлит и вызывает
  `moveElement`. Double-click открывает правую панель.
- Автомасштаб — в `EditorWorkspace` через `useEffect`, сравнивающий счётчик
  точек до/после (чтобы не реагировать на смену темы или перетаскивание).
  Использует `computeResetView` + `fitBounds/flyTo` с `maxZoom: 12`.
- Загрузка шрифтов — `src/services/fonts.ts`. Один раз вставляет `@font-face`
  для каждого файла из `/api/fonts`, вызывает `document.fonts.load(...)` для
  принудительной загрузки и ждёт `document.fonts.ready`. Вызывается из
  `EditorWorkspace.useEffect`.

**API и инфра**

- Бэкенд: добавлен `express.static('/assets', ...)` для раздачи иконок и
  шрифтов (`src/app.ts`). Путь конфигурируется через `ASSETS_DIR`.
- Vite proxy `/assets/fonts` → `/assets` (теперь все ассеты идут через бэк).
- `GET /api/geocode/search` и `GET /api/fonts` уже были сделаны в task2, фронт
  теперь их использует.

**UI**

- `AddPointModal` — вход через кнопку `+ Точка` в BottomToolbar. Debounce 250 мс,
  минимум 2 символа до запроса. Клавиатура: ↑↓/Enter/Escape. После выбора
  подсказки — отдельное поле для ручного редактирования подписи.
- Правая панель (`RightSidebar` → `PointSettingsPanel` / `LabelSettingsPanel`):
  - точка: выбор анимации, цвет, размер, прозрачность, скорость + (для мигающей)
    окантовка; три кнопки в низу (сбросить настройки / местоположение / удалить).
  - подпись: редактирование текста, галочки «до запятой» и «только заглавные»,
    семейство шрифта из `/api/fonts`, размер, цвет, прозрачность, окантовка,
    те же три кнопки.
  - Все изменения применяются мгновенно — `PixiLayer` сравнивает ссылку на
    `settings` и пересоздаёт контейнер, когда она меняется.
- `ConfirmDialog` — общий модальный диалог с Escape/backdrop cancel.
- `ElementsList` — теперь показывает 3 вида иконок: `●` для точки, `T` для
  подписи, `↗` для маршрута (task6).

**Обновления документации**

- SPEC.md: `assets/icons/plane.png` → `assets/icons/airplane.png` (совпадает
  с фактическим именем файла в `assets/icons/`).
- task5.md: fire_loop именование выровнено с реальностью —
  `fire_loop000000.png … fire_loop000149.png` (6 цифр, с префиксом, от 000000).

**Проверка**

- `npm run typecheck` (frontend) — чисто.
- `npm run build` (frontend) — 1.6 MB / 473 KB gzip.
- `npm test` (frontend) — 40/40 (добавлены: `editor-state-point`,
  `label-renderer`, `pixi-colors`, `pick-target`, `editor-page` расширен).
- `npm test` (backend) — 39/39.
- Live smoke:
  - `/api/health` → 200.
  - `/api/geocode/search?q=Moscow&limit=3` → возвращает Москву на кириллице.
  - `/api/fonts` → 12 файлов Montserrat + Supermolot.
  - `/assets/icons/explosion.png` → 200 / 63 KB.
  - `/assets/icons/fire_loop/fire_loop000000.png` → 200 / 89 KB.
  - `/assets/fonts/Montserrat-Regular.ttf` → 200 / 257 KB.

**Что стоит знать следующей фазе (task6 — Маршруты)**

- Маршрут будет типа `MapRoute` (уже в `state/types.ts`) — сейчас заглушка.
- `removeElement` для точки уже готов каскадно удалять связанные маршруты —
  в task6 просто расширить фильтр: любой route, где одна из endpoint-точек ===
  удаляемый id, тоже пропадает.
- `ElementsList` уже показывает route-элементы значком `↗`, правая панель
  готова разветвляться по `selected.kind === 'route'`.
- Drag-контроллер в `use-element-drag.ts` сейчас двигает только
  `point/label`. Для маршрута между отмеченными точками перетаскивание не
  требуется (маршрут следует за точками), но если в task6 понадобится таскать
  «свободные» endpoint'ы — расширять там же.
- PixiLayer держит `sortableChildren = true` на контейнерах, так что маршруты
  можно будет положить на stage с `zIndex: 0` и гарантированно оказаться под
  точками.
- При построении маршрутов в task6 обрати внимание на **производительность
  тайлов** — см. `docs/tiles-performance.md`. Пока не трогаем, но после task9
  имеет смысл внедрить SQL-функции Martin.