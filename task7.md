# Фаза 7 — Настройки видео

**Статус:** ✅ Завершено
**Связанные файлы:** SPEC.md (раздел "Настройки видео")
**Зависит от:**

- task4.md — карта должна работать (переключение темы меняет стиль карты)
- task5.md, task6.md — анимации должны быть готовы (дыхание камеры показывается на превью)
**Следующая фаза:** task8.md — настройки видео передаются в рендер

---

## Цель фазы

## Реализовать модальное окно настроек видео со всеми параметрами.

Тема карты и дыхание камеры работают в реальном времени на превью.

## Skills для этой фазы


| Skill                    | Когда активировать                                            |
| ------------------------ | ------------------------------------------------------------- |
| **mastering-typescript** | При написании TypeScript/React кода                           |
| **frontend-design**      | При создании UI модального окна настроек видео                |
| **spec-driven-workflow** | Для контроля последовательности задач и фиксации статуса фазы |


### Когда skill указывать явно

- Явно указывать **frontend-design**, если спор по UX модального окна/контролов.
- Явно указывать **spec-driven-workflow**, если нужно аккуратно синхронизировать изменения с `task7.md`.

---

## Задачи

- Кнопка "Настройки видео" в нижней панели
- Модальное окно настроек
- Выбор разрешения (radio)
- Выбор FPS (radio)
- Выбор формата (radio)
- Поле длительности (3–60 сек, валидация)
- Выбор темы карты (radio, live preview)
- Ползунок "Дыхание камеры" (live preview пока открыто меню)
- Кнопки "Сохранить" и "Сбросить настройки"
- Хранение настроек в состоянии редактора

---

## Хранение настроек

```typescript
interface VideoSettings {
  resolution: '1920x1080' | '3840x2160';
  fps: 25 | 30 | 50 | 60;
  format: 'mp4' | 'mxf';
  duration: number;       // seconds, 3-60
  theme: 'light' | 'dark';
  cameraBreathing: number;      // 0-100
}

const DEFAULT_VIDEO_SETTINGS: VideoSettings = {
  resolution: '1920x1080',
  fps: 25,
  format: 'mp4',
  duration: 10,
  theme: 'dark',
  cameraBreathing: 0,
};
```

Семантика `fps`:

- для MP4: `25/30/50/60` трактуются как progressive (`25p/30p/50p/60p`);
- для MXF: `50` трактуется как `50i` (через `tinterlace` в `task8.md`), остальные остаются progressive.

---

## Переключение темы карты

Связь с task4.md: там реализованы объекты `DARK_MAP_STYLE`
и `LIGHT_MAP_STYLE`. Здесь просто вызываем:

```typescript
function applyMapTheme(theme: 'light' | 'dark'): void {
  map.setStyle(theme === 'dark' ? DARK_MAP_STYLE : LIGHT_MAP_STYLE);
}
// Вызывается немедленно при изменении radio кнопки — live preview
```

---

## Дыхание камеры

Анимация активна **только пока открыто меню** настроек видео (режим preview).
Сохранённое значение `cameraBreathing` входит в `VideoSettings` и используется при серверном
рендере в `task8.md`, даже когда меню закрыто.

```typescript
let isBreathingActive = false;
let baseZoom = 0;
let breathingTween: gsap.core.Tween | null = null;

function startCameraBreathing(strength: number): void {
  if (strength === 0) {
    stopCameraBreathing();
    return;
  }

  baseZoom = map.getZoom();
  const amplitude = (strength / 100) * 0.4;       // max ±0.4 zoom
  const duration = 4 - (strength / 100) * 2.5;    // 1.5-4 seconds

  breathingTween = gsap.to({ zoom: baseZoom }, {
    zoom: baseZoom + amplitude,
    duration,
    repeat: -1,
    yoyo: true,
    ease: 'sine.inOut',
    onUpdate: function() {
      map.setZoom(this.targets()[0].zoom);
    },
  });
}

function stopCameraBreathing(): void {
  breathingTween?.kill();
  breathingTween = null;
  if (baseZoom > 0) map.setZoom(baseZoom);
}

// При изменении ползунка — перезапустить с новой силой
// При открытии меню — запустить если сила > 0
// При закрытии меню — остановить
```

---

## Валидация длительности

```typescript
function validateDuration(value: string): number | null {
  const num = parseInt(value, 10);
  if (isNaN(num)) return null;
  if (num < 3) return 3;
  if (num > 60) return 60;
  return num;
}
// Поле показывает ошибку если введено значение вне диапазона 3-60
```

---

## Важные моменты

1. **Кнопка "Сохранить"** — применяет настройки и закрывает меню.
  Тема и дыхание уже применены в live режиме, остальное просто сохраняется.
2. **Кнопка "Сбросить"** — возвращает к `DEFAULT_VIDEO_SETTINGS`.
  Тему и дыхание также сбрасывает с live preview.
3. **Дыхание** при закрытии меню кнопкой × или кликом вне модала —
  останавливается и карта возвращается в исходное положение.
4. **Настройки используются в task8.md** — передаются в запрос рендера.
  Формат передачи описан в task8.md.

---

## Заметка для следующей сессии

### Сделано

- **Типы:** `VideoSettings`, `DEFAULT_VIDEO_SETTINGS`, `parseDurationField` (`state/types.ts`).
- **State:** `videoSettings`, `commitVideoSettings`, `applyMapThemePreview`; `setTheme` обновляет и `theme` (карта), и `videoSettings.theme`. Модалка меняет только превью темы через `applyMapThemePreview`, пока пользователь не нажмёт «Сохранить».
- **UI:** `VideoSettingsModal` + `video-settings-modal.css`; ползунок дыхания → `gsap.to` на `{ zoom }` с `map.setZoom` в `onUpdate` (карта из `mapRef`); при `open === false` tween снимается и зум возвращается к снимку `baseZoomRef`. Ожидание появления карты: короткий `setInterval` + `bump` state, если `mapRef` ещё null.
- **Интеграция:** `BottomToolbar` (`onOpenVideoSettings`), `EditorWorkspace` (снимок темы при открытии, Esc после add-point modal). Кнопка «Сбросить» в модалке — `DEFAULT_VIDEO_SETTINGS` + `applyMapThemePreview`.
- **Тесты:** `parse-duration-field.test.ts`, `editor-state-video.test.tsx`, smoke в `editor-page.test.tsx`; расширен мок `gsap.to` для модалки.

### Следующий шаг (task8)

Передавать `videoSettings` в запрос рендера и ffmpeg-пайплайн по SPEC.