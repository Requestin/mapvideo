# Фаза 11 — Фикс слайдеров (UX-багфиксы 2)

**Статус:** ✅ Сделано

**Цель:** починить баг «слайдеры нельзя тянуть, только кликать» в `PointSettingsPanel`.
Корень — `*Controls` объявлены внутри тела родителя, React их re-mount-ит на каждый
`updatePointSettings`, DOM `<input type="range">` пересоздаётся, браузер теряет
mouse-capture.

## Задачи

- Поднять `BlinkingControls`, `ExplosionControls`, `FireControls`, `EarthquakeControls` на уровень модуля
- Прокинуть `pointId` / `settings` / `onPatch` через props — не через замыкание родителя
- Регрессионный тест: `<input type="range">` сохраняет identity после `onChange`

## Не входит в эту фазу

- Остальной UX-список (task12 — выпадающие панели, task13 — геокод/админка/шрифты, task14 — палитра)

## Заметка для следующей сессии

**Что было сломано:**

`PointSettingsPanel` объявлял `BlinkingControls`/`ExplosionControls`/`FireControls`/`EarthquakeControls`
**внутри своего тела**. React diff-ит детей по `elementType ===` — а каждый re-render
родителя создавал новую функцию-компонент (функции-в-скоупе не кешируются). Поэтому
на каждый тик `updatePointSettings` React видел другой `type`, размонтировал старое
поддерево и монтировал новое. DOM `<input type="range">` пересоздавался → браузер,
который отслеживал mousedown по исходной ноде, терял её, mousemove/mouseup уходили в
void. Итог — клик работает (единичный event, не зависит от drag-capture), drag — нет.

**Что сделано:**

Все четыре `*Controls` вынесены на уровень модуля (`point-settings-panel.tsx`),
объединены общим дженерик-интерфейсом `ControlsProps<S extends PointSettings>`
(`pointId`, `settings`, `onPatch`). Родитель создаёт `onPatch` через `useCallback([point.id, updatePointSettings])`
— identity стабильна, пока не сменится выбранная точка. `LabelSettingsPanel` не трогали:
там вложенных компонентов не было изначально, все поля рендерятся плоско через
module-level `SliderField`/`ColorField`/`CheckboxField`.

**Регрессионный тест:** `tests/point-settings-panel.test.tsx`.

- `SeederWithPanel` сидит точку и рендерит `PointSettingsPanel`.
- Тест 1: сохраняется указатель на `<input#field-Размер>`, fire change → ищет тот же
селектор → `expect(after).toBe(before)` (identity-check).
- Тест 2: симулирует drag серией из 5 change-событий, каждый раз подтверждает identity.

Если кто-нибудь снова объявит sub-компонент в теле `PointSettingsPanel`, оба теста
упадут на `expect(...).toBe(...)` — нода пересоздастся, reference разъедется.

**Метрики:** фронт 48/48 тестов, typecheck чист, build ~1.6 MB (без изменений).
Бэкенд не трогали.

**Что в очереди:** task12 (выпадающие/overlay панели слева и справа, покрупнее
нижний toolbar, расширение превью при скрытых панелях).