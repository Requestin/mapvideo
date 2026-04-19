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
- [ ] Хук useКарта (состояние карты, методы управления)

---

## Архитектура MapLibre + PixiJS

Два canvas слоя один поверх другого:

```typescript
// src/компоненты/КартаРедактора.tsx

export function КартаРедактора() {
  const контейнерRef = useRef<HTMLDivElement>(null);
  const картаRef = useRef<maplibregl.Map | null>(null);
  const пиксиRef = useRef<PIXI.Application | null>(null);

  useEffect(() => {
    if (!контейнерRef.current) return;

    // 1. Инициализируем MapLibre
    картаRef.current = new maplibregl.Map({
      container: контейнерRef.current,
      style: СТИЛЬ_ТЁМНОЙ_КАРТЫ,  // URL стиля из Martin
      center: [37.618, 55.751],    // Москва по умолчанию
      zoom: 5,
    });

    // 2. Инициализируем PixiJS поверх
    пиксиRef.current = new PIXI.Application({
      width: контейнерRef.current.clientWidth,
      height: контейнерRef.current.clientHeight,
      transparent: true,
      antialias: true,
      resolution: window.devicePixelRatio,
    });

    // 3. Позиционируем canvas PixiJS поверх MapLibre
    const пиксиCanvas = пиксиRef.current.view as HTMLCanvasElement;
    пиксиCanvas.style.position = 'absolute';
    пиксиCanvas.style.top = '0';
    пиксиCanvas.style.left = '0';
    пиксиCanvas.style.pointerEvents = 'none'; // мышь проходит к карте
    контейнерRef.current.appendChild(пиксиCanvas);

    // 4. При движении карты — обновляем позиции PixiJS объектов
    картаRef.current.on('move', обновитьПозицииЭлементов);
    картаRef.current.on('zoom', обновитьПозицииЭлементов);

    return () => {
      картаRef.current?.remove();
      пиксиRef.current?.destroy();
    };
  }, []);

  return (
    <div className="превью-обёртка"> {/* соотношение 16:9 */}
      <div ref={контейнерRef} className="превью-карты" />
      <ОверлейЭлементов карта={картаRef} пикси={пиксиRef} />
      <КнопкаСбросаПоложения />
    </div>
  );
}
```

---

## Стиль карты из Martin

```typescript
const СТИЛЬ_ТЁМНОЙ_КАРТЫ = {
  version: 8,
  sources: {
    полигоны: {
      type: 'vector',
      tiles: ['/tiles/planet_osm_polygon/{z}/{x}/{y}'],
      minzoom: 0, maxzoom: 18,
    },
    линии: {
      type: 'vector',
      tiles: ['/tiles/planet_osm_line/{z}/{x}/{y}'],
      minzoom: 0, maxzoom: 18,
    },
  },
  layers: [
    { id: 'фон', type: 'background', paint: { 'background-color': '#1a1a2e' } },
    {
      id: 'вода',
      type: 'fill',
      source: 'полигоны',
      'source-layer': 'polygons',
      filter: ['any', ['==', ['get', 'natural'], 'water'], ['has', 'water']],
      paint: { 'fill-color': '#16213e' },
    },
    {
      id: 'дороги-главные',
      type: 'line',
      source: 'линии',
      'source-layer': 'lines',
      filter: ['match', ['get', 'highway'], ['motorway', 'trunk', 'primary'], true, false],
      paint: {
        'line-color': '#1a5276',
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1, 10, 3],
      },
    },
    {
      id: 'дороги-второстепенные',
      type: 'line',
      source: 'линии',
      'source-layer': 'lines',
      minzoom: 10,
      filter: ['match', ['get', 'highway'], ['secondary', 'tertiary', 'residential'], true, false],
      paint: { 'line-color': '#0d3b6e', 'line-width': 1 },
    },
  ],
};

// Светлая тема — отдельный объект стиля с другими цветами
const СТИЛЬ_СВЕТЛОЙ_КАРТЫ = { /* ... */ };
```

---

## Overlay для перехвата событий мыши

PixiJS canvas имеет `pointer-events: none`, поэтому события перехватываются
через отдельный прозрачный div поверх всего:

```typescript
// Overlay перехватывает mousedown
// Если курсор над элементом — начинает перетаскивание
// Если нет — пропускает событие к MapLibre (карта двигается)

function проверитьПопаданиеВЭлемент(x: number, y: number): ЭлементКарты | null {
  // Перебираем все элементы и проверяем дистанцию до их позиции в пикселях
  // Используем карта.project([lng, lat]) для перевода координат
}
```

---

## Перевод координат карты ↔ пиксели

```typescript
// Географические координаты → пиксели экрана
function координатыВПиксели(lng: number, lat: number): { x: number, y: number } {
  const точка = карта.project([lng, lat]);
  return { x: точка.x, y: точка.y };
}

// Пиксели экрана → географические координаты
function пикселиВКоординаты(x: number, y: number): { lng: number, lat: number } {
  const координаты = карта.unproject([x, y]);
  return { lng: координаты.lng, lat: координаты.lat };
}

// Эти функции используются в task5 и task6
```

---

## Кнопка "Сбросить положение"

```typescript
function сброситьПоложениеКарты(элементы: ЭлементКарты[]): void {
  if (элементы.length === 0) {
    карта.flyTo({ center: [0, 20], zoom: 2 }); // Весь мир
    return;
  }
  if (элементы.length === 1) {
    карта.flyTo({ center: [элементы[0].координаты.lng, элементы[0].координаты.lat], zoom: 10 });
    return;
  }
  // Несколько точек — fitBounds
  const границы = вычислитьГраницы(элементы.map(э => э.координаты));
  карта.fitBounds(границы, { padding: 80 });
}
```

---

## Соотношение 16:9 для превью

```css
.превью-обёртка {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;     /* CSS aspect-ratio */
  overflow: hidden;
}

.превью-карты {
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
const [выбранныйЭлемент, setВыбранныйЭлемент] = useState<string | null>(null);

// Открывается при двойном клике на элемент карты
// Закрывается при клике вне панели и вне элементов карты
// Анимация: translateX(320px → 0), 200ms ease-out
```

---

## Заметка для следующей сессии
*(заполняется завершения задачи или перед завершением сессии)*
