# Фаза 6 — Маршруты

**Статус:** ✅ Завершено
**Связанные файлы:** SPEC.md (раздел "Маршрут")
**Зависит от:**

- task4.md — PixiJS слой, координаты↔пиксели, overlay событий
- task5.md — точки на карте (маршруты соединяют точки созданные там)
- task2.md — авторизация middleware для защищённых API
**Следующая фаза:** task7.md (настройки видео не зависят от маршрутов напрямую)

---

## Цель фазы

## Реализовать построение маршрутов между точками, все виды линий,

иконки транспорта с движением, OSRM интеграцию, дуги.

## Skills для этой фазы


| Skill                    | Когда активировать                                                 |
| ------------------------ | ------------------------------------------------------------------ |
| **mastering-typescript** | При написании TypeScript/React кода                                |
| **frontend-design**      | При создании UI меню настроек маршрутов                            |
| **systematic-debugging** | При отладке OSRM интеграции и MotionPath анимаций                  |
| **api-contract-checker** | При изменении `GET /api/route` запроса/ответа и fallback-семантики |
| **spec-driven-workflow** | Для удержания фазы в рамках `task6.md` и пошаговой проверки        |


### Когда skill указывать явно

- Явно указывать **api-contract-checker**, если меняются координатные DTO/status codes.
- Явно указывать **systematic-debugging**, если есть расхождения route preview vs route render.
- Явно указывать **frontend-design**, когда UX построения маршрута неоднозначен.

---

## Задачи

- Бэкенд: GET /api/route (проксирование OSRM)
- Кнопка "Маршрут" (появляется при 2+ точках)
- Режим построения маршрута (линия за курсором)
- Отмена по Escape
- Маршрут между двумя отмеченными точками
- Маршрут со стрелкой (конец в произвольном месте)
- Перестройка маршрута при перемещении точки
- Удаление маршрута при удалении точки
- Анимация прямой линии (пульсация)
- Анимация пунктирной линии (движение А→Б циклично)
- Иконки транспорта (автомобиль, самолёт, вертолёт, корабль)
- Поворот иконки по направлению движения
- Маршрут по дороге (OSRM) для автомобиля
- Маршрут дугой для самолёта/вертолёта/корабля
- Стрелка на конце (масштабируется с толщиной)
- Меню настроек маршрута (правая панель) с live preview
- Список маршрутов в левой панели

---

## Бэкенд: GET /api/route

```typescript
// GET /api/route?start=37.618,55.751&end=30.315,59.939
// Проксирует запрос к OSRM

router.get('/route', requireAuth, async (req, res) => {
  const { start, end } = req.query as { start: string, end: string };

  try {
    const url = `http://osrm:5000/route/v1/driving/${start};${end}?overview=full&geometries=geojson`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.code !== 'Ok' || !data.routes[0]) {
      return res.status(404).json({ error: 'Маршрут не найден' });
    }

    const coordinates = data.routes[0].geometry.coordinates.map(
      ([lng, lat]: [number, number]) => ({ lng, lat })
    );

    res.json({
      coordinates,
      distance: data.routes[0].distance,
      duration: data.routes[0].duration,
      fallback: false,
    });
  } catch (err) {
    // OSRM недоступен — честно говорим фронту, что это прямая линия (fallback),
    // чтобы он показал toast "Маршрут по дороге временно недоступен".
    logger.warn({ err }, 'OSRM недоступен, возвращаем прямую линию');
    const [fromPoint, toPoint] = [start, end].map(point => {
      const [lng, lat] = point.split(',').map(Number);
      return { lng, lat };
    });
    res.status(200).json({
      coordinates: [fromPoint, toPoint],
      distance: 0,
      duration: 0,
      fallback: true,
    });
  }
});
```

---

## Режим построения маршрута

```typescript
// При нажатии кнопки "Маршрут" — активируем режим
// В режиме построения курсор меняется на crosshair
// Первый клик на точку — запоминаем начало, тянем линию за курсором
// Второй клик — создаём маршрут
// Escape — отменяем

function activateRouteMode(): void {
  routeBuildMode = true;
  startPoint = null;
  // Показываем подсказку "Нажмите на начальную точку"
}

function handleRouteModeClick(x: number, y: number): void {
  const pointUnderCursor = findPointUnderCursor(x, y);

  if (!startPoint) {
    // Первый клик — только на отмеченную точку
    if (pointUnderCursor) {
      startPoint = pointUnderCursor;
    }
    return;
  }

  // Второй клик
  if (pointUnderCursor && pointUnderCursor.id !== startPoint.id) {
    // Маршрут между двумя отмеченными точками
    createRoute(startPoint, pointUnderCursor, 'point');
  } else {
    // Маршрут в произвольное место — конец со стрелкой
    const coordinates = pixelsToCoordinates(x, y);
    createRoute(startPoint, coordinates, 'coordinates');
  }

  deactivateRouteMode();
}

// Escape отменяет
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && routeBuildMode) {
    deactivateRouteMode();
  }
});
```

---

## Хранение маршрута

```typescript
interface Route {
  id: string;
  start: {
    type: 'point' | 'coordinates';
    pointId?: string;
    coordinates?: Coordinates;
  };
  end: {
    type: 'point' | 'coordinates';
    pointId?: string;
    coordinates?: Coordinates;
  };
  osrmCoordinates: Coordinates[] | null;
  settings: RouteSettings;
  pixiContainer: PIXI.Container;
}
```

---

## Рисование линий

### Прямая (пульсирующая)

```typescript
function drawSolidRouteLine(
  points: { x: number, y: number }[],
  settings: RouteSettings
): PIXI.Container {
  const container = new PIXI.Container();

  const line = new PIXI.Graphics();
  line.lineStyle(settings.thickness, settings.color, settings.opacity / 100);
  if (settings.stroke.enabled) {
    line.lineStyle(settings.thickness + settings.stroke.size * 2,
      settings.stroke.color, settings.stroke.opacity / 100);
    drawPolyline(line, points);
  }
  line.lineStyle(settings.thickness, settings.color, settings.opacity / 100);
  drawPolyline(line, points);

  // Пульсирующий слой поверх
  const pulse = new PIXI.Graphics();
  pulse.lineStyle(settings.thickness * 1.5, settings.color, 0.3);
  drawPolyline(pulse, points);

  container.addChild(line);
  container.addChild(pulse);
  gsap.to(pulse, { alpha: 0, duration: 1, repeat: -1, yoyo: true, ease: 'sine.inOut' });

  return container;
}
```

### Пунктирная (движение)

```typescript
// Пунктир перерисовывается каждый кадр со смещением offset
let dashOffset = 0;

pixiApp.ticker.add(() => {
  for (const route of routes.values()) {
    if (route.settings.lineType === 'dashed') {
      route.pixiContainer.removeChildren();
      dashOffset = (dashOffset + 1) % 20;
      drawDashedLine(route.pixiContainer, route.pointsInPixels,
        route.settings, dashOffset);
    }
  }
});
```

### Стрелка на конце маршрута

```typescript
// Цвет/прозрачность передаём параметрами — в PIXI.Graphics v7 нет линия.line.color
function addArrowHead(
  line: PIXI.Graphics,
  penultimatePoint: { x: number, y: number },
  lastPoint: { x: number, y: number },
  thickness: number,
  color: number,
  opacity: number
): void {
  const angle = Math.atan2(
    lastPoint.y - penultimatePoint.y,
    lastPoint.x - penultimatePoint.x
  );
  const arrowSize = thickness * 4;

  line.beginFill(color, opacity);
  line.drawPolygon([
    lastPoint.x, lastPoint.y,
    lastPoint.x - arrowSize * Math.cos(angle - 0.4),
    lastPoint.y - arrowSize * Math.sin(angle - 0.4),
    lastPoint.x - arrowSize * Math.cos(angle + 0.4),
    lastPoint.y - arrowSize * Math.sin(angle + 0.4),
  ]);
  line.endFill();
}
```

---

## Иконки транспорта

GSAP MotionPath — **премиум плагин**, не используем. Вместо него — собственная функция интерполяции по полилинии с поворотом.

```typescript
// Считает позицию и угол на полилинии по прогрессу t ∈ [0, 1]
function sampleAlongPolyline(
  path: { x: number, y: number }[],
  t: number
): { x: number, y: number, angle: number } {
  // Считаем общую длину и длины сегментов
  const segLens: number[] = [];
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const dx = path[i+1].x - path[i].x;
    const dy = path[i+1].y - path[i].y;
    const len = Math.hypot(dx, dy);
    segLens.push(len);
    total += len;
  }
  const target = t * total;
  let acc = 0;
  for (let i = 0; i < segLens.length; i++) {
    if (acc + segLens[i] >= target) {
      const local = (target - acc) / segLens[i];
      const a = path[i], b = path[i+1];
      return {
        x: a.x + (b.x - a.x) * local,
        y: a.y + (b.y - a.y) * local,
        angle: Math.atan2(b.y - a.y, b.x - a.x),
      };
    }
    acc += segLens[i];
  }
  const last = path[path.length - 1];
  const prev = path[path.length - 2] ?? last;
  return { x: last.x, y: last.y, angle: Math.atan2(last.y - prev.y, last.x - prev.x) };
}

// Иконки ориентированы носом вправо (угол 0), поэтому rotation = angle напрямую.
// Передаём экземпляр PIXI.Application явно — статического getApplication() в PixiJS нет.
function createTransportIcon(
  app: PIXI.Application,
  settings: RouteSettings,
  pathPoints: { x: number, y: number }[],
  videoDuration: number,
  options?: { deterministicClock?: () => number; registerCleanup?: (fn: () => void) => void }
): PIXI.Sprite {
  const icon = PIXI.Sprite.from(`/assets/icons/${settings.icon}.png`); // car | airplane | helicopter | ship
  // ВАЖНО: нативный размер спрайта = 1x1 до загрузки текстуры.
  // Используем утилиту sizeSpriteToPixels (pixi/sprite-sizing.ts, task10),
  // которая дожидается `baseTexture.valid` и только потом выставляет
  // icon.width/height из settings.iconSize. Без неё на первом кадре
  // иконка транспорта будет невидимой точкой.
  sizeSpriteToPixels(icon, settings.iconSize);
  icon.anchor.set(0.5);

  // В превью по умолчанию используем real-time clock.
  // Для /render-page передаём deterministicClock(), привязанный к времени masterTimeline,
  // чтобы не было рассинхрона между seek(t) и position/rotation иконки.
  const now = options?.deterministicClock ?? (() => performance.now());
  const startTs = now();
  const ticker = () => {
    const elapsed = (now() - startTs) / 1000;
    const t = (elapsed / videoDuration) % 1;
    const { x, y, angle } = sampleAlongPolyline(pathPoints, t);
    icon.position.set(x, y);
    icon.rotation = angle;
  };
  app.ticker.add(ticker);
  options?.registerCleanup?.(() => app.ticker.remove(ticker));
  (icon as any).__ticker = ticker;   // fallback cleanup

  return icon;
}
```

**Важно:** PNG иконки ориентированы **носом вправо** (см. `SPEC.md` раздел Ассеты). Угол 0 рад = вправо, поэтому `icon.rotation = angle` без коррекции.

---

## Маршрут дугой

```typescript
function calculateArcPoints(
  start: Coordinates,
  end: Coordinates,
  pointCount = 50
): Coordinates[] {
  const points: Coordinates[] = [];
  const distance = Math.sqrt(
    Math.pow(end.lng - start.lng, 2) + Math.pow(end.lat - start.lat, 2)
  );
  const arcHeight = distance * 0.2; // 20% of distance

  for (let i = 0; i <= pointCount; i++) {
    const t = i / pointCount;
    points.push({
      lng: start.lng + (end.lng - start.lng) * t,
      // Параболическая дуга: sin(π*t) даёт максимум в середине
      lat: start.lat + (end.lat - start.lat) * t + Math.sin(Math.PI * t) * arcHeight,
    });
  }

  return points;
}
```

---

## Обработка fallback OSRM на фронте

Если `GET /api/route` вернул `fallback: true` — это значит, что OSRM недоступен
и бэк отдал прямую линию между двумя точками. Фронт показывает toast
"Маршрут по дороге временно недоступен. Построена прямая линия." (см. task9)
и рисует маршрут как прямой.

---

## Координаты -> пиксели для отрисовки маршрута

Маршрут в API приходит в географических координатах (`lng/lat`), а Pixi рисует в пикселях.
Нужен явный мост-конвертация перед `drawPolyline`.

```typescript
function routeCoordinatesToPixels(coords: Coordinates[]): { x: number; y: number }[] {
  return coords.map((c) => {
    const p = map.project([c.lng, c.lat]);
    return { x: p.x, y: p.y };
  });
}
```

---

## Перестройка маршрута при перемещении точки

```typescript
// Вызывается из task5.md при переносе точки
function rebuildRoutesForPoint(pointId: string): void {
  for (const route of routes.values()) {
    const touchesPoint =
      route.start.pointId === pointId ||
      route.end.pointId === pointId;

    if (touchesPoint) {
      // Если маршрут по дороге — перезапросить OSRM
      if (route.settings.useRoadRoute) {
        requestOSRMAndRefresh(route);
      } else {
        // Просто обновить точки пути
        refreshRoutePath(route);
      }
    }
  }
}
```

---

## Применение к текущей архитектуре (после task10–14)

Примеры выше писались в начале проекта — до того, как определились основные
подсистемы редактора. Реализация task6 **должна встраиваться в существующую
архитектуру**, а не создавать параллельную. Ниже — обязательные точки интеграции,
выявленные по ходу task5/10–14:

### Состояние

- Маршруты хранятся в `state/editor-state.tsx` (тот же reducer, что и точки/подписи),
а не в модульных `let routeBuildMode / startPoint / routes`.
Actions: `addRoute`, `updateRouteSettings`, `removeRoute`, `setRouteBuildMode`.
- `routeBuildMode` = `null | { startPointId: string }` в state, не в замыкании.
- Удаление точки через `removePoint` делает каскадное удаление связанных маршрутов
(как уже делает для подписи — task5). `rebuildRoutesForPoint` — это реакция
reducer'а на `updatePointCoordinates`, а не императивный вызов.

### Рендер в PIXI

- Маршрут — это ещё один тип `Record` в `pixi/pixi-layer.tsx` (наряду с `point`/`label`),
с полем `dispose()` и обновлением в reconcile по `state.routes`.
Никакого `route.pixiContainer` в state — Pixi-ресурсы живут в `recordsRef` внутри слоя.
- Sync позиций маршрутов — в том же `syncPositions()` по `map.on('render')`
(через `map.project(lngLat)` — координаты маршрута хранятся в `lng/lat`, а рисуются в пикселях).
- Тикер-анимации (пульсация solid, движение пунктира, ход транспорта)
регистрируются **в общем `pixi.ticker`** через фабрики по аналогии с
`createPointAnimation` из task5; каждая фабрика возвращает `dispose()`, который
вызывается из record.dispose() при reconcile-удалении и из effect-cleanup
при unmount. Не писать один глобальный `ticker.add(() => for (const r of routes.values()) {...})`
— он не переживёт StrictMode double-invoke.
- Teardown обязан быть StrictMode-safe: проверка `pixi.stage` перед `removeChild`
и `try/catch` вокруг `record.dispose()` — так же, как в hover-ring и record-teardown
после фиксов task10/текущей сессии.

### Иконки транспорта

- Файлы в `assets/icons/` называются `car.png`, `airplane.png`, `helicopter.png`, `ship.png`
(см. SPEC «Ассеты»). В `RouteSettings.icon` держим идентификатор ровно этим же словарём
(`'car' | 'airplane' | 'helicopter' | 'ship' | 'none'`).
- Размер иконки выставляем через `sizeSpriteToPixels(icon, settings.iconSize)`
(task10) — иначе до загрузки PNG будет 1×1.
- Zoom-зависимое масштабирование иконки + стрелки — тем же правилом, что у точек
(`scale = clamp(0.3 + (zoom-2)*0.06, 0.3, 1.3)`, task10), чтобы маршрут
и связанные точки не расходились в размере.

### Hit-test для режима построения

- `findPointUnderCursor(x, y)` из примера — это `hitRegistry.pickTarget(x, y)`
с фильтром `target.type === 'point'` (registry уже заполняется `PixiLayer.syncPositions`
в task5). Не изобретать свой pick-loop.
- Клик в route-build-mode ловим на том же overlay-слое MapLibre, что и drag точек
(`use-element-drag.ts` / `editor-map.tsx`), а не через `document.addEventListener`.

### Escape и прочие глобальные клавиши

- Глобальный `keydown`-обработчик Escape обязан уважать `modalOpenRef` из task12:
если открыта модалка/дропдаун — Esc уходит им, а не сбрасывает route-mode.
Новый handler заводим **рядом** с существующим в `editor-page.tsx`, а не
делаем второй независимый listener на window.

### Правая панель и цветовые поля

- Меню настроек маршрута — новый компонент `RouteSettingsPanel`
в `components/right-sidebar/`, выбирается из `RightSidebar` по
`selectedElement.type === 'route'` (`RightSidebar` уже работает как absolute-оверлей,
закрывается по Esc/клик по пустой карте — task12; ничего дополнительно
не трогаем).
- Все цветовые поля (линия, окантовка, стрелка) — через существующий `ColorField`
(поповер + пресеты + кастомные, task14). Голый `<input type="color">` не использовать —
он выбивается из UX остальных панелей.
- Inline-компоненты внутри `RouteSettingsPanel` **поднимать на уровень модуля**
(как `*Controls` в `PointSettingsPanel` после task11), иначе React на каждом
ре-рендере будет пересоздавать `<input type="range">` и ломать drag ползунков.

### Бэкенд: `/api/route`

- `OSRM_URL` читаем из env (default `http://osrm:5000` для compose), по аналогии
с `MARTIN_URL` и `PHOTON_URL`. Это нужно тестам (подмена на mock-сервер) и
локальному запуску вне compose.
- Для `ASSETS_DIR` уже есть `resolveAssetsDir()` (`backend/src/utils/resolve-assets.ts`) —
транспортные иконки отдаются тем же `express.static(ASSETS_DIR)`, отдельной настройки
не требуется.
- Логи ошибок/fallback — на русском (в формате `logger.warn({ err }, 'OSRM недоступен ...')`).
- `requireAuth` обязателен; CSRF — только на мутирующих роутах (на `/route` не нужен,
т.к. `GET`).

### Тесты

- Бэк: добавить кейсы в `tests/misc.test.ts` (или отдельный `tests/route.test.ts`) —
happy-path с mock-OSRM (`nock`/подмена `global.fetch`), 404 `code !== 'Ok'`,
fallback при недоступном OSRM.
- Фронт: регрессионный тест на `RouteSettingsPanel` (identity-check полей после
`onChange`, по шаблону `point-settings-panel.test.tsx` из task11), и тест
на действие `activateRouteBuildMode` / `setRouteBuildMode(null)` в reducer.
- Keep 46/46 бэк + актуальный счёт фронта зелёными.

---

## Заметка для следующей сессии

### Что сделано фактически

- **Типы (`state/types.ts`):** добавлены `RouteLineType`, `RouteTransportIcon`,
`RouteSettings`, `RouteEndpoint`, `MapRoute` с полем `osrmCoordinates: LngLat[] | null`
для кэша дорожной геометрии; `defaultRouteSettings()` (solid, синий, stroke включён,
icon='none'); `MapElementKind` расширен `'route'`.
- **State (`state/editor-state.tsx`):** новые экшены `addRoute`, `updateRouteSettings`,
`setRouteOsrmCoordinates`, `resetRouteSettings`, `setRouteBuildMode` +
`routeBuildMode` в контексте. `removeElement` каскадно удаляет все маршруты,
ссылающиеся на точку; `moveElement` сбрасывает `osrmCoordinates` для маршрутов,
касающихся двинувшейся точки, — `useEffect` в `EditorWorkspace` потом
перезапрашивает OSRM. Переключение `useRoadRoute` также инвалидирует кэш.
- **Backend (`backend/src/routes/route.ts`):** `GET /api/route?start=lng,lat&end=...&mode=driving|straight`
— прокси к OSRM (`OSRM_URL`, default `http://osrm:5000`, `OSRM_TIMEOUT_MS`=6000),
всегда отвечает 200 с `{coordinates, distance, duration, fallback}`.
`fallback: true` — при non-200, `code !== 'Ok'` или таймауте (`AbortController`);
геометрия — `[start, end]` прямой. Логи предупреждений на русском.
Завёрнут `requireAuth`; зарегистрирован в `backend/src/app.ts`.
- **Frontend API (`frontend/src/api/routes.ts`):** `fetchRoute()` через
`http` (axios + CSRF), `RouteFetchResult`.
- **Build-mode (`components/bottom-toolbar.tsx` + `editor-workspace.tsx`):**
кнопка «↗ Маршрут» — toggle `routeBuildMode` (active-style, disabled <2 точек).
Клик 1 — только по `point` (через `hitRegistry.pickTarget` + фильтр shape='rect'),
клик 2 — либо по другой точке, либо `pixelsToCoordinates` → `coordinates`-endpoint.
Escape приоритетнее гасит build-mode, чем оверлеи (учитывает `modalOpenRef` task12).
Preview-линия — Graphics-overlay в PixiLayer, курсор из `mousemove` обновляется
через ref (без re-render), при `mouseout` — скрывается. Курсор `crosshair`
через класс `editor-page--route-build` (с `!important`, т.к. MapLibre ставит
inline `cursor: grab`).
- **PIXI (`pixi/routes/path.ts` + `pixi/routes/route-render.ts`
  - `pixi/pixi-layer.tsx`):** `RouteRecord` как очередной тип в
  общем `recordsRef` с `dispose()`. Геометрия — `computeRoutePathLngLat`
  (priority: OSRM кэш → `computeArcPoints` (sin(π·t)·20%) → прямая).
  `redraw(timeMs)`: `solid` — пульсация alpha по `sin(timeMs·speed)`,
  `dashed` — смещение dash offset. Stroke-обводка рисуется первым слоем.
  Стрелка (`drawArrowHead`) — в конечной точке по углу из `sampleAlongPolyline(1)`.
  Транспортная иконка — `PIXI.Sprite` из `/assets/icons/<icon>.png` через
  `sizeSpriteToPixels` (task10), позиционируется и поворачивается
  `sampleAlongPolyline(t)` где `t = (timeMs·speed) % 1`, alpha ease-in/out.
  Ticker добавлен только здесь (единый `pixi.ticker.add(handler)`) — реконсилер
  удаляет record'ы безопасно (`try/catch` вокруг `dispose()`, проверка `pixi.stage`).
- **Hit-test (`use-element-hover.ts` + `use-element-drag.ts`):**
`polyline`-таргеты пропускаются — маршруты в v1 выбираются только через
список слева, не перехватывают drag/hover.
- **Right-sidebar (`right-sidebar/route-settings-panel.tsx` + `right-sidebar.tsx`):**
новая панель на базе `SettingsSection` + `SelectField` (lineType, icon) +
`ColorField` (line, stroke) + `SliderField` (thickness/opacity/speed/stroke.size/.opacity)
  - `CheckboxField` (stroke.enabled, useRoadRoute — только для `car`, arc — только для
  airplane/helicopter/ship). Sub-секции (`LineSection`/`StrokeSection`/`IconSection`)
  подняты на уровень модуля (task11-паттерн), чтобы range-drag не рвался.
  Кнопки «Сбросить настройки» / «Удалить» + `ConfirmDialog`.
- **ElementsList:** имя маршрута строится **на лету** из текущих labels точек —
переименование точки моментально отражается в списке без дополнительного экшена.
- **Тесты:**
  - Backend `tests/misc.test.ts` — 6 новых кейсов на `/api/route` (401, 400 на
  кривых координатах, happy path с mocked `fetch`, fallback при non-200 /
  `code: 'NoRoute'` / timeout). Все 52 теста бэка зелёные.
  - Frontend `tests/editor-state-route.test.tsx` — addRoute (label, endpoint
  варианты), updateRouteSettings (merge + stroke-атомарность), invalidation
  OSRM-кэша при `useRoadRoute`/`moveElement`, каскад удаления, build-mode toggle.
  - Frontend `tests/pixi-routes-path.test.ts` — `computeArcPoints` (длина/вершина),
  `computeRoutePathLngLat` (OSRM cache priority, arc, coord-endpoint), 
  `sampleAlongPolyline` (линейная интерполяция/clamp/мультисегмент/вырожденный путь).
  - Обновлён `tests/editor-state.test.ts` (`route` factory) под новую форму `MapRoute`.
  - Итог: frontend 75/75, backend 52/52, typecheck + vite build зелёные.

### Известные ограничения / что дальше

- Маршруты нельзя таскать/выделять кликом по линии (по SPEC — v1, выбор через
список). Если потребуется — расширить `pickTarget` на `polyline` (hit-test с
учётом `thickness`) и добавить подсветку hover-ring для polyline.
- OSRM-запрос стартует в effect после `addRoute`; пока идёт fetch, рисуем прямую
(быстрый визуальный отклик). Debounce не нужен — запрос дёргается максимум раз
на маршрут и на `moveElement` обнулении кэша.
- Зум-зависимое масштабирование транспортной иконки сейчас использует тот же
`scale`, что и точки (через `sizeSpriteToPixels` + зум-коэффициент из task10).

