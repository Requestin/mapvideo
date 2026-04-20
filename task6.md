# Фаза 6 — Маршруты

**Статус:** Не начато
**Связанные файлы:** SPEC.md (раздел "Маршрут")
**Зависит от:**
- task4.md — PixiJS слой, координаты↔пиксели, overlay событий
- task5.md — точки на карте (маршруты соединяют точки созданные там)
- task2.md — авторизация middleware для защищённых API
**Следующая фаза:** task7.md (настройки видео не зависят от маршрутов напрямую)

---

## Цель фазы
Реализовать построение маршрутов между точками, все виды линий,
иконки транспорта с движением, OSRM интеграцию, дуги.
---

## Skills для этой фазы

| Skill | Когда активировать |
|-------|--------------------|
| **mastering-typescript** | При написании TypeScript/React кода |
| **frontend-design** | При создании UI меню настроек маршрутов |
| **systematic-debugging** | При отладке OSRM интеграции и MotionPath анимаций |
| **api-contract-checker** | При изменении `GET /api/route` запроса/ответа и fallback-семантики |
| **spec-driven-workflow** | Для удержания фазы в рамках `task6.md` и пошаговой проверки |

### Когда skill указывать явно

- Явно указывать **api-contract-checker**, если меняются координатные DTO/status codes.
- Явно указывать **systematic-debugging**, если есть расхождения route preview vs route render.
- Явно указывать **frontend-design**, когда UX построения маршрута неоднозначен.

---

## Задачи

- [ ] Бэкенд: GET /api/route (проксирование OSRM)
- [ ] Кнопка "Маршрут" (появляется при 2+ точках)
- [ ] Режим построения маршрута (линия за курсором)
- [ ] Отмена по Escape
- [ ] Маршрут между двумя отмеченными точками
- [ ] Маршрут со стрелкой (конец в произвольном месте)
- [ ] Перестройка маршрута при перемещении точки
- [ ] Удаление маршрута при удалении точки
- [ ] Анимация прямой линии (пульсация)
- [ ] Анимация пунктирной линии (движение А→Б циклично)
- [ ] Иконки транспорта (автомобиль, самолёт, вертолёт, корабль)
- [ ] Поворот иконки по направлению движения
- [ ] Маршрут по дороге (OSRM) для автомобиля
- [ ] Маршрут дугой для самолёта/вертолёта/корабля
- [ ] Стрелка на конце (масштабируется с толщиной)
- [ ] Меню настроек маршрута (правая панель) с live preview
- [ ] Список маршрутов в левой панели

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
  const icon = PIXI.Sprite.from(`/assets/icons/${settings.icon}.png`); // car | plane | helicopter | ship
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

## Заметка для следующей сессии
*(заполняется завершения задачи или перед завершением сессии)*
