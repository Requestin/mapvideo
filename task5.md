# Фаза 5 — Точки и подписи

**Статус:** Не начато
**Связанные файлы:** SPEC.md (раздел "Элементы карты — Точка, Подпись")
**Зависит от:**
- task4.md — карта и PixiJS слой должны быть готовы
  (координаты→пиксели, overlay для событий мыши)
- task2.md — геосаджест использует GET /api/geocode/search
**Следующая фаза:** task6.md (маршруты соединяют точки созданные здесь)

---

## Цель фазы
Реализовать добавление точек на карту через геосаджест, все 4 вида анимаций,
подписи, меню настроек с live preview, перетаскивание.
---

## Skills для этой фазы

| Skill | Когда активировать |
|-------|--------------------|
| **mastering-typescript** | При написании TypeScript/React кода |
| **frontend-design** | При создании UI меню настроек точек и подписей |
| **systematic-debugging** | При отладке анимаций PixiJS + GSAP |
| **api-contract-checker** | При изменении контракта `GET /api/geocode/search` и формата результатов |
| **spec-driven-workflow** | Для синхронного выполнения задач фазы и обновления checklist |

### Когда skill указывать явно

- Явно указывать **api-contract-checker**, если меняется структура ответа геосаджеста.
- Явно указывать **systematic-debugging**, если анимации/drag-drop работают нестабильно.
- Явно указывать **frontend-design**, если есть неоднозначность в UI настроек элемента.

---

## Задачи

- [ ] Бэкенд: GET /api/geocode/search (проксирование Photon)
- [ ] Фронтенд: загрузка шрифтов при старте (`GET /api/fonts` + `@font-face`, `await document.fonts.ready`)
- [ ] Модальное окно "Добавить точку" с геосаджестом
- [ ] Добавление точки на PixiJS слой
- [ ] Автоматическое добавление подписи рядом с точкой
- [ ] Автомасштаб карты при добавлении нескольких точек
- [ ] Анимация "Мигающая точка" (процедурная)
- [ ] Анимация "Взрыв" (PNG + круги)
- [ ] Анимация "Огонь" (PNG секвенция)
- [ ] Анимация "Землетрясение" (статичная PNG)
- [ ] Перетаскивание точки
- [ ] Перетаскивание подписи
- [ ] Меню настроек точки (правая панель) с live preview
- [ ] Меню настроек подписи (правая панель) с live preview
- [ ] Кнопки: Сбросить настройки, Сбросить местоположение, Удалить
- [ ] Диалог подтверждения удаления
- [ ] Список элементов (левая панель) — точки и подписи
- [ ] Обновление списка при добавлении/удалении элементов

---

## Геосаджест (бэкенд)

```typescript
// GET /api/geocode/search?q=Москва&limit=5
// Проксирует запрос к публичному Photon: https://photon.komoot.io/api
// (вариант "в" из решения — без self-hosted индекса. Если упрёмся в rate limit
// или сервис ляжет — переключаемся на self-hosted worldwide индекс 75 ГБ,
// поднимаем komoot/photon как docker-сервис и меняем URL на http://photon:2322/api)

const PHOTON_URL = process.env.PHOTON_URL || 'https://photon.komoot.io/api';

router.get('/geocode/search', requireAuth, async (req, res) => {
  const { q, limit = 5 } = req.query;
  const response = await fetch(`${PHOTON_URL}?q=${encodeURIComponent(String(q))}&limit=${limit}&lang=ru`);
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
  // Файлы: /assets/icons/fire_loop/ — готовая PNG секвенция (имена — английский)
  const frames = Array.from({ length: 150 }, (_, i) =>
    PIXI.Texture.from(`/assets/icons/fire_loop/${String(i + 1).padStart(4, '0')}.png`)
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

`fire_loop` содержит 150 кадров (`0001.png`...`0150.png`) — это фиксированное допущение
для v1 и должно совпадать с фактическими ассетами.

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
*(заполняется завершения задачи или перед завершением сессии)*
