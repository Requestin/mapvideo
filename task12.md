# Фаза 12 — Выпадающие/overlay-панели (UX-багфиксы 3)

**Статус:** ✅ Сделано

**Цель:** освободить превью 16:9, превратив обе боковые панели в overlay-элементы
поверх карты, а нижний toolbar — сделать крупнее (+50%). Визуальный размер превью
важен: пользователь должен видеть в нём ровно то, что получит в финальном видео.

## Задачи

- [x] Убрать `grid-template-columns: 1fr 320px` у `editor-page__body`; превью во всю ширину
- [x] Левое меню «Элементы» — выпадающее по кнопке (кнопка видна всегда, список — по клику)
- [x] Правая панель — overlay, рендерится **только** когда выбран элемент
- [x] Esc и клик по пустому месту карты (не по элементу) — закрывают обе панели
- [x] Нижний toolbar +50%: `--layout-toolbar-height` 56 → 84, кнопки крупнее
- [x] Превью строго 16:9 сохраняется (панели оверлейные, не сдвигают канвас)

## Не входит в эту фазу

- task13 (геокод/админка/шрифты), task14 (палитра с пресетами и кастомами)

## Заметка для следующей сессии

**Layout-перекройка.** `editor-page__body` раньше был `display:grid; grid-template-columns:1fr 320px` — поэтому при любом selected правый sidebar отжирал 320 px у превью. Теперь это `display:flex` с единственной колонкой (`editor-page__stage` получил `flex:1`). `.editor-page__preview` остался с `aspect-ratio:16/9 + max-width/max-height:100%` — превью само масштабируется по короткой оси сцены, а обе панели плавают **внутри** него.

**Elements-list как выпадающее меню.** Компонент теперь controlled — принимает `open` + `onToggle`. Всегда виден триггер `<button>` со счётчиком элементов и chevron ▲/▼; тело (`.elements-list__body`) рендерится только когда `open === true`. Счётчик берётся из `elements.length` (точка + её подпись ⇒ 2 элемента). При открытии у триггера скругляются только верхние углы — визуальная связка с выпадашкой снизу.

**RightSidebar как overlay.** Возвращает `null`, когда `selectedElementId === null` — никакого «placeholder-текста» больше нет. При выбранном элементе — `position:absolute; top:16px; right:16px; z-index:11; max-height:calc(100% - 32px); overflow-y:auto`. Фон полупрозрачный + `backdrop-filter:blur(6px)` — единый визуальный язык с `ElementsList`.

**Closure через Esc + клик по пустому.** Оба обработчика живут в `EditorWorkspace`:
- Esc: `document.addEventListener('keydown', …)`, проверка `modalOpenRef.current` чтобы не конкурировать с `AddPointModal`-ом; `setElementsListOpen(false); selectElement(null)`.
- Клик по пустому: `map.on('click', …)` — MapLibre стреляет `click` только на «чистый» тап (drag-release не стреляет). Внутри обходим `hitRegistry.targets` тем же алгоритмом, что и `pickTarget` из `use-element-drag`: если клик попал в элемент — early return, иначе закрываем обе панели. Регистрацию делаем inline (не через импорт) сознательно, чтобы не плодить третью подписку на hit-registry.
- Бонус: при любом `selectedElementId !== null` автоматически закрываем `ElementsList` — иначе дропдаун слева и панель справа визуально налезали бы друг на друга на узких экранах.

**Toolbar +50%.** `--layout-toolbar-height`: 56 → 84. В `bottom-toolbar.css` добавлен scope-selector `.bottom-toolbar .app-button { padding:12px 20px; font-size:16px; min-height:44px; }` — только для нижней панели, кнопки в модалках и правой панели остаются компактными (padding:8px/14px, 14px).

**Тесты:** новый `tests/overlay-panels.test.tsx` — 5 кейсов:
1. `RightSidebar` возвращает `null` без selected.
2. `RightSidebar` появляется после `selectElement(id)`.
3. `ElementsList` — триггер всегда виден, body скрыт при `open=false`.
4. Клик по триггеру разворачивает/сворачивает и меняет `aria-expanded`.
5. Счётчик отражает `elements.length` (добавили точку → `2`, точка + подпись).

Мок `useEditorMap` минимальный — тесты проверяют только React-решения (render vs null, атрибуты), MapLibre/Pixi-реальности не нужны.

**Метрики.** Фронт 53/53, typecheck + build чисты. Bundle вырос на ~1 KB CSS (overlay-стили). Бэкенд не трогали.

**Что в очереди:** task13 — геокод-фикс (дедупликация, "Москва, Тоҷикистон" и пр.), кнопка «Админка» в меню пользователя (видна только `role:'admin'`), начертания шрифтов вторым селектом. Потом task14 — палитра цветов с пресетами + per-user сохранение до 10 кастомных цветов (понадобится backend-эндпоинт `/api/users/me/colors` и миграция БД).
