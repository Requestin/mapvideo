# Фаза 4 — Карта и базовый редактор

**Статус:** ✅ Сделано
**Связанные файлы:** SPEC.md (раздел "Главная страница"), cursor.md (стек)
**Зависит от:** task3.md — скелет редактора уже создан
**Следующая фаза:** task5.md (точки и анимации рисуются поверх карты)

---

## Цель фазы

## Встроить интерактивную карту MapLibre в редактор. Создать PixiJS слой поверх
карты для будущих анимаций. Реализовать список элементов и правую панель.

## Skills для этой фазы


| Skill                    | Когда активировать                                         |
| ------------------------ | ---------------------------------------------------------- |
| **mastering-typescript** | При написании TypeScript/React кода                        |
| **frontend-design**      | При создании UI редактора карты, панелей, кнопок           |
| **systematic-debugging** | При отладке интеграции MapLibre + PixiJS                   |
| **spec-driven-workflow** | Для контроля выполнения шагов и фиксации прогресса по фазе |


### Когда skill указывать явно

- Явно указывать **systematic-debugging**, если карта/overlay рендерятся нестабильно.
- Явно указывать **frontend-design**, если нужно принять UX-решение по панелям и layout.
- Явно указывать **spec-driven-workflow**, если нужно строго держаться рамок фазы.

---

## Задачи

- Установить и настроить MapLibre GL JS
- Карта 16:9 в области превью
- Подключить тайлы Martin (тёмная тема)
- Интерактивность карты (зум, перемещение)
- Создать PixiJS слой поверх карты
- Overlay div для перехвата событий мыши
- Кнопка "Сбросить положение карты"
- Список элементов (левая панель, пока пустой)
- Правая боковая панель (контейнер, пока пустой)
- Нижняя панель инструментов с кнопками
- Переключение темы карты (светлая/тёмная)
- Хук useEditorMap (состояние карты, методы управления)

---

## Архитектура MapLibre + PixiJS

Два canvas слоя один поверх другого:

```typescript
// src/components/EditorMap.tsx

export function EditorMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const pixiRef = useRef<PIXI.Application | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // 1. Инициализируем MapLibre
    mapRef.current = new maplibregl.Map({
      container: containerRef.current,
      style: DARK_MAP_STYLE,  // style URL from Martin
      center: [37.618, 55.751],    // Москва по умолчанию
      zoom: 5,
    });

    // 2. Инициализируем PixiJS поверх (v7.4.2: transparent устарел → backgroundAlpha: 0)
    pixiRef.current = new PIXI.Application({
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      backgroundAlpha: 0,
      antialias: true,
      resolution: window.devicePixelRatio,   // превью — используем DPR экрана;
                                              // при серверном рендере задаём resolution: 1 (см. task8)
    });

    // 3. Позиционируем canvas PixiJS поверх MapLibre
    const pixiCanvas = pixiRef.current.view as HTMLCanvasElement;
    pixiCanvas.style.position = 'absolute';
    pixiCanvas.style.top = '0';
    pixiCanvas.style.left = '0';
    pixiCanvas.style.pointerEvents = 'none'; // mouse events pass to map
    containerRef.current.appendChild(pixiCanvas);

    // 4. При движении карты — обновляем позиции PixiJS объектов
    mapRef.current.on('move', updateElementPositions);
    mapRef.current.on('zoom', updateElementPositions);

    return () => {
      mapRef.current?.remove();
      pixiRef.current?.destroy();
    };
  }, []);

  return (
    <div className="preview-wrapper"> {/* 16:9 ratio */}
      <div ref={containerRef} className="map-preview" />
      <ElementsOverlay map={mapRef} pixi={pixiRef} />
      <ResetViewButton />
    </div>
  );
}
```

---

## Стиль карты из Martin

```typescript
// ВАЖНО: source-layer должен СОВПАДАТЬ с именем таблицы в PostGIS
// (Martin публикует слои по именам таблиц: planet_osm_polygon, planet_osm_line).
// PixiJS pinned в 7.4.2 — не использовать v8 async init API.

const DARK_MAP_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm_polygon: {
      type: 'vector',
      tiles: ['/tiles/planet_osm_polygon/{z}/{x}/{y}'],
      minzoom: 0, maxzoom: 18,
    },
    osm_line: {
      type: 'vector',
      tiles: ['/tiles/planet_osm_line/{z}/{x}/{y}'],
      minzoom: 0, maxzoom: 18,
    },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#1a1a2e' } },
    {
      id: 'water',
      type: 'fill',
      source: 'osm_polygon',
      'source-layer': 'planet_osm_polygon',
      filter: ['any', ['==', ['get', 'natural'], 'water'], ['has', 'water']],
      paint: { 'fill-color': '#16213e' },
    },
    {
      id: 'roads-major',
      type: 'line',
      source: 'osm_line',
      'source-layer': 'planet_osm_line',
      filter: ['match', ['get', 'highway'], ['motorway', 'trunk', 'primary'], true, false],
      paint: {
        'line-color': '#1a5276',
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1, 10, 3],
      },
    },
    {
      id: 'roads-minor',
      type: 'line',
      source: 'osm_line',
      'source-layer': 'planet_osm_line',
      minzoom: 10,
      filter: ['match', ['get', 'highway'], ['secondary', 'tertiary', 'residential'], true, false],
      paint: { 'line-color': '#0d3b6e', 'line-width': 1 },
    },
  ],
};

// Светлая тема — отдельный объект стиля с другими цветами
const LIGHT_MAP_STYLE = { /* ... */ };
```

---

## Overlay для перехвата событий мыши

PixiJS canvas имеет `pointer-events: none`, поэтому события перехватываются
через отдельный прозрачный div поверх всего:

```typescript
// Overlay перехватывает mousedown
// Если курсор над элементом — начинает перетаскивание
// Если нет — пропускает событие к MapLibre (карта двигается)

function hitTestElement(x: number, y: number): MapElement | null {
  // Перебираем все элементы и проверяем дистанцию до их позиции в пикселях
  // Используем карта.project([lng, lat]) для перевода координат
}
```

---

## Перевод координат карты ↔ пиксели

```typescript
// Географические координаты → пиксели экрана
function coordinatesToPixels(lng: number, lat: number): { x: number, y: number } {
  const point = map.project([lng, lat]);
  return { x: point.x, y: point.y };
}

// Пиксели экрана → географические координаты
function pixelsToCoordinates(x: number, y: number): { lng: number, lat: number } {
  const coords = map.unproject([x, y]);
  return { lng: coords.lng, lat: coords.lat };
}

// Эти функции используются в task5 и task6
```

---

## Кнопка "Сбросить положение"

```typescript
function resetMapView(elements: MapElement[]): void {
  if (elements.length === 0) {
    map.flyTo({ center: [0, 20], zoom: 2 }); // world view
    return;
  }
  if (elements.length === 1) {
    map.flyTo({ center: [elements[0].coordinates.lng, elements[0].coordinates.lat], zoom: 10 });
    return;
  }
  // Несколько точек — fitBounds
  const bounds = calculateBounds(elements.map((e) => e.coordinates));
  map.fitBounds(bounds, { padding: 80 });
}
```

---

## Соотношение 16:9 для превью

```css
.preview-wrapper {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;     /* CSS aspect-ratio */
  overflow: hidden;
}

.map-preview {
  position: absolute;
  inset: 0;
}
```

---

## Правая боковая панель

В этой фазе — только контейнер без содержимого.
Содержимое добавляется в task5.md и task6.md.

```typescript
// Состояние: какой элемент выбран для настройки
const [selectedElementId, setSelectedElementId] = useState<string | null>(null);

// Открывается при двойном клике на элемент карты
// Закрывается при клике вне панели и вне элементов карты
// Анимация: translateX(320px → 0), 200ms ease-out
```

---

## Заметка для следующей сессии

**Статус:** фаза 4 закрыта (12/12 задач). Редактор имеет живую карту MapLibre + прозрачный PixiJS-слой поверх + overlay-div для событий мыши. Точки и анимации рисуются в task5.

### Стек и зависимости

- `maplibre-gl@4.7.1`, `pixi.js@7.4.2` (строго v7 — в `package.json` без caret: `"pixi.js": "7.4.2"`, cursor.md предостерегает от v8 async init).
- CSS MapLibre подключён в `editor-map.tsx` через `import 'maplibre-gl/dist/maplibre-gl.css'`.

### Архитектура

- `src/state/editor-state.tsx` — React Context с `elements`, `selectedElementId`, `theme`. Плюс чистая функция `computeResetView(elements)` — покрыта 5 unit-тестами.
- `src/hooks/use-editor-map.tsx` — отдельный Context с imperative handle: `mapRef`, `pixiRef`, `attachMap/attachPixi`, `resetView`, `coordinatesToPixels`, `pixelsToCoordinates`. Провайдер (`EditorMapProvider`) монтируется внутри `EditorStateProvider` (нужен доступ к `elements` для `resetView`). Все компоненты карты получают одни и те же refs через context → нет prop-drilling.
- `src/components/editor-map.tsx` — единая точка создания/уничтожения карты:
  1. MapLibre в `container` (абсолют, inset: 0).
  2. PixiJS поверх, canvas добавляется через `container.appendChild(pixi.view as HTMLCanvasElement)`, `pointer-events: none`, `autoDensity: true`, `resolution: window.devicePixelRatio`.
  3. `ResizeObserver` следит за размером контейнера → `map.resize()` + `pixi.renderer.resize()`.
  4. Overlay `<div>` поверх всего с `pointer-events: none` (включается на `auto` только в момент перетаскивания — логика в task5).
  5. При смене темы — `map.setStyle(styleForTheme(theme))` без пересоздания карты/пикси.

### Тайлы Martin

- `src/map/map-styles.ts` — два стиля (`DARK_MAP_STYLE` / `LIGHT_MAP_STYLE`). Источники — `planet_osm_polygon` и `planet_osm_line` (имена таблиц PostGIS совпадают с именами Martin-слоёв). Минимальные слои: background, landuse, water, roads-major/minor с zoom-интерполяцией ширины.
- Vite dev proxy: `/tiles/`* → `http://127.0.0.1:3002/*` с переписыванием префикса (`rewrite: p => p.replace(/^\/tiles/, '')`). Прод nginx уже настроен в репо (`nginx/mapvideo.gyhyry.ru.conf`, `location /tiles/` → `proxy_pass http://127.0.0.1:3002/`).
- Live-smoke (фоновый vite + docker-compose Martin): `/tiles/catalog` 200, отдаёт `planet_osm_{line,point,polygon,roads}`. Реальные тайлы ходят: `/tiles/planet_osm_polygon/4/9/5` → 200 + protobuf payload.

### Пост-факт: Martin не публиковал таблицы (фикс)

Поначалу `/tiles/catalog` отдавал `{"tiles":{},...}` при том что OSM-данные были импортированы ещё в task1. Причина — Martin v0.14.2 стартовал **раньше** завершения `import-osm.sh` и закешировал пустой список схем (в логе: `Auto-publishing tables in schemas []` вместо `[public]`). После `docker restart mapvideo-martin-1` лог стал: `Auto-publishing tables in schemas [public]` → `Discovered source planet_osm_line/point/polygon/roads`, каталог и тайлы заработали. Это ровно то, что task1 и предупреждал: «после `./scripts/import-osm.sh` и перезапуска `martin` healthcheck должен позеленеть». В рамках task1 сервис был запущен до импорта и остался висеть с пустым каталогом; исправлено сейчас, одноразовой командой `docker restart mapvideo-martin-1`. Постоянного фикса в compose не требуется — после любого рестарта Martin подхватит актуальные таблицы, т.к. на БД `gis` данные уже лежат.

### Layout

- `EditorPage`: Header / `editor-page__stage` (flex-center, padding 16) → `editor-page__preview` (CSS `aspect-ratio: 16/9`, `max-width/max-height: 100%`) / RightSidebar 320px / BottomToolbar. 16:9 соблюдается строго — растягивается по меньшей из осей, letterboxing обеспечивает неискажённый preview, как требует SPEC.md («пользователь видит в превью ровно то что будет на видео»).
- `ElementsList` и `ResetViewButton` — абсолют внутри `editor-page__preview` (а не во всей области карты ранее): теперь позиционируются относительно превью 16:9.
- `ResetViewButton` активна: onClick → `resetView()` хука, логика по `computeResetView`: 0 точек → flyTo world (center [0,20], zoom 2), 1 точка → flyTo(center, zoom 10), 2+ → fitBounds с padding 80.
- `BottomToolbar`: единственная активная кнопка — «🌙 Тёмная / ☀ Светлая» (toggle темы карты). Остальные disabled до своих фаз. «↗ Маршрут» auto-disabled пока меньше 2 точек-элементов.
- `ElementsList`/`RightSidebar` читают state: список с подсветкой активного элемента и закрытием выбора при повторном клике; правая панель показывает `label` выбранного элемента + хинт «настройки в следующих фазах».

### Тесты (Vitest, 17 тестов всего, 7 новых)

- `tests/editor-state.test.ts` — 5 тестов `computeResetView`: пусто / только routes / 1 точка / N точек (bounds) / mixed.
- `tests/editor-page.test.tsx` — 2 smoke-теста: рендер chrome (бренд + список + reset + disabled-кнопки) и переключение темы по клику. Мокаются `maplibre-gl`, `pixi.js`, `ResizeObserver`, auth-API.

### Пограничные моменты для task5+

- При добавлении точек: использовать `coordinatesToPixels(lng, lat)` из `useEditorMap` для позиционирования PIXI-объектов (MapLibre → screen пиксели). На каждом `map.on('move'|'zoom'|'rotate')` — пересчитывать позиции; pattern уже предусмотрен в шаблоне task4/task5.
- Перетаскивание: overlay-div (`data-testid="editor-map-overlay"`) имеет `pointer-events: none` по умолчанию. Инструменты task5 должны переключать на `auto` на время drag (mousedown на Pixi-объекте), чтобы перехватить mousemove/mouseup и не дёргать карту.
- Тема: `setStyle` сбрасывает временные layers, но в task4 их нет. Когда task5 начнёт добавлять `map.addSource/addLayer` для точек — обработка style change потребует пересоздания этих слоёв по событию `map.on('styledata')` или через ре-декларацию при смене `theme`.
- PixiJS v7.4.2: `pixi.view as HTMLCanvasElement` (а не `pixi.canvas`), `new PIXI.Application({...})` синхронный конструктор. Код уже завязан корректно; если в task5 кто-то обновит Pixi до v8 — всё сломается.

### Build/test

- `npm run typecheck` чист.
- `npm run build`: 588 модулей, `dist/assets/index-*.js` 1.5 MB (gzip 437 KB), `index-*.css` 77 KB (gzip 12 KB). Bundle большой из-за MapLibre+Pixi; code-splitting оставил на task9 (деплой/полировка) по рекомендации Vite.
- `npm test`: 17/17, 5 файлов.

