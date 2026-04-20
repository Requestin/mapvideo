# Фаза 4 — Карта и базовый редактор

**Статус:** Не начато
**Связанные файлы:** SPEC.md (раздел "Главная страница"), cursor.md (стек)
**Зависит от:** task3.md — скелет редактора уже создан
**Следующая фаза:** task5.md (точки и анимации рисуются поверх карты)

---

## Цель фазы
Встроить интерактивную карту MapLibre в редактор. Создать PixiJS слой поверх
карты для будущих анимаций. Реализовать список элементов и правую панель.
---

## Skills для этой фазы

| Skill | Когда активировать |
|-------|--------------------|
| **mastering-typescript** | При написании TypeScript/React кода |
| **frontend-design** | При создании UI редактора карты, панелей, кнопок |
| **systematic-debugging** | При отладке интеграции MapLibre + PixiJS |
| **spec-driven-workflow** | Для контроля выполнения шагов и фиксации прогресса по фазе |

### Когда skill указывать явно

- Явно указывать **systematic-debugging**, если карта/overlay рендерятся нестабильно.
- Явно указывать **frontend-design**, если нужно принять UX-решение по панелям и layout.
- Явно указывать **spec-driven-workflow**, если нужно строго держаться рамок фазы.

---

## Задачи

- [ ] Установить и настроить MapLibre GL JS
- [ ] Карта 16:9 в области превью
- [ ] Подключить тайлы Martin (тёмная тема)
- [ ] Интерактивность карты (зум, перемещение)
- [ ] Создать PixiJS слой поверх карты
- [ ] Overlay div для перехвата событий мыши
- [ ] Кнопка "Сбросить положение карты"
- [ ] Список элементов (левая панель, пока пустой)
- [ ] Правая боковая панель (контейнер, пока пустой)
- [ ] Нижняя панель инструментов с кнопками
- [ ] Переключение темы карты (светлая/тёмная)
- [ ] Хук useEditorMap (состояние карты, методы управления)

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
*(заполняется завершения задачи или перед завершением сессии)*
