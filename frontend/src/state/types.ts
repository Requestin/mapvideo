// Shared types for the editor. Routes arrive in task6 — kept here as a
// future-proof enum so ElementsList etc. don't have to change then.

export interface LngLat {
  lng: number;
  lat: number;
}

export type MapElementKind = 'point' | 'label' | 'route';

export type PointAnimationKind =
  | 'blinking'
  | 'explosion'
  | 'fire'
  | 'earthquake';

// Common stroke descriptor reused by point+label settings.
export interface StrokeSettings {
  enabled: boolean;
  color: string;
  size: number;
  opacity: number; // 0..100
}

// Blinking point supports colour, pulse speed, stroke.
export interface BlinkingPointSettings {
  kind: 'blinking';
  color: string;
  size: number; // px
  opacity: number; // 0..100
  speed: number; // 0..100
  stroke: StrokeSettings;
}

// Explosion = static icon + procedural expanding rings.
export interface ExplosionPointSettings {
  kind: 'explosion';
  size: number;
  opacity: number;
  speed: number;
  /** 0..100, how far rings travel from the epicenter. */
  spread: number;
}

// Fire = baked PNG sequence, speed controls playback rate.
export interface FirePointSettings {
  kind: 'fire';
  size: number;
  opacity: number;
  speed: number;
}

// Earthquake = single static icon, no animation.
export interface EarthquakePointSettings {
  kind: 'earthquake';
  size: number;
  opacity: number;
}

export type PointSettings =
  | BlinkingPointSettings
  | ExplosionPointSettings
  | FirePointSettings
  | EarthquakePointSettings;

export interface LabelSettings {
  fontFamily: string;
  /** CSS numeric weight (100..900). 400 — Regular. Нужен для PIXI.TextStyle и
   *  для согласования с `@font-face { font-weight }` на стороне браузера. */
  fontWeight: number;
  fontSize: number;
  color: string;
  opacity: number; // 0..100
  stroke: StrokeSettings;
  uppercase: boolean;
  // "до запятой": trim after first comma (SPEC.md §"Настройки подписи")
  truncateAtComma: boolean;
}

export interface MapElementBase {
  id: string;
  kind: MapElementKind;
  label: string;
}

export interface MapPoint extends MapElementBase {
  kind: 'point';
  coordinates: LngLat;
  /** Point this was born at — used by "Сбросить местоположение". */
  originCoordinates: LngLat;
  settings: PointSettings;
  /** Paired MapLabel id (set by addPoint). */
  labelId: string;
}

export interface MapLabel extends MapElementBase {
  kind: 'label';
  /** The MapPoint this label belongs to. */
  pointId: string;
  /** Current position in geo-space (labels drift with the map). */
  coordinates: LngLat;
  /** Where the label started, relative to the paired point (lng/lat delta). */
  originOffset: LngLat;
  /** Verbatim name from geocoder, kept so "до запятой" / "только заглавные"
   *  can be recomputed without losing the original. */
  originalText: string;
  settings: LabelSettings;
}

// === task6: Routes ========================================================
// SPEC §Маршрут:
//   Вид: Прямая (пульсирующая) | Пунктирная (движение А→Б циклично)
//   Параметры линии: цвет, толщина, прозрачность, окантовка (цвет/размер/%)
//   Стрелка (только если конец в произвольной точке)
//   Иконка: нет | автомобиль | самолёт | вертолёт | корабль
//   Автомобиль → "Маршрут по дороге" (OSRM), самолёт/вертолёт/корабль → "Прямая | Дуга".
// Для точечных эндпоинтов — хранится только `pointId`; координаты
// резолвятся из `elements[]` на каждом рендере (одна точка → одна истина,
// перемещение точки автоматически обновит маршрут в PixiLayer reconcile).
export type RouteLineType = 'solid' | 'dashed';

export type RouteTransportIcon =
  | 'none'
  | 'car'
  | 'airplane'
  | 'helicopter'
  | 'ship';

export const ROUTE_ICON_SIZE_MIN = 16;
export const ROUTE_ICON_SIZE_MAX = 128;
export const ROUTE_ICON_SIZE_DEFAULT = 36;

export interface RouteSettings {
  /** Solid — сплошная с пульсацией alpha; dashed — бегущий пунктир А→Б. */
  lineType: RouteLineType;
  color: string;
  /** Толщина основной линии в пикселях. Стрелка/окантовка масштабируются. */
  thickness: number;
  /** 0..100 — общая прозрачность линии. */
  opacity: number;
  /** 0..100 — частота пульсации (solid) / скорость бегущего пунктира. */
  speed: number;
  stroke: StrokeSettings;
  icon: RouteTransportIcon;
  /** Transport icon size in pixels. */
  iconSize: number;
  /** true → OSRM road geometry, false → straight/arc rendering. */
  useRoadRoute: boolean;
  /** Имеет смысл для airplane/helicopter/ship: true → дуга, false → прямая. */
  arc: boolean;
}

// SPEC: «Клик на другую отмеченную точку → маршрут между точками»; «Клик
// на произвольное место → маршрут заканчивается стрелкой (без иконки)».
// Соответственно: старт всегда типа 'point' (первый клик SPEC-ом ограничен
// точками). Конец — 'point' ИЛИ 'coordinates' (свободная точка со стрелкой).
export type RouteEndpoint =
  | { type: 'point'; pointId: string }
  | { type: 'coordinates'; coordinates: LngLat };

export interface MapRoute extends MapElementBase {
  kind: 'route';
  /** New multi-point route model: one route may contain a full chain
   *  of point ids (A→B→C...). Legacy routes may omit this field. */
  waypoints?: string[];
  /** Всегда ссылается на существующий MapPoint. Удаление точки каскадно
   *  удалит маршрут (см. removeElement в editor-state). */
  start: { type: 'point'; pointId: string };
  end: RouteEndpoint;
  settings: RouteSettings;
  /** Последняя OSRM-геометрия (для `useRoadRoute: true`). Хранится в
   *  lng/lat, null — «пока ничего не грузили / нужно перестроить».
   *  При переносе точки обнуляется reducer'ом — дальше PixiLayer увидит
   *  null и либо покажет прямую, либо отправит запрос за обновлённой
   *  геометрией через свой usеEffect. */
  osrmCoordinates: LngLat[] | null;
  /** Optional per-leg OSRM geometry for waypoint chains. */
  osrmLegsCoordinates?: LngLat[][] | null;
}

export type MapElement = MapPoint | MapLabel | MapRoute;

// Factory-grade defaults (SPEC.md §"Настройки точки" / §"Настройки подписи").
// Keeping them here rather than in UI so they are the single source of truth
// for "Сбросить настройки" buttons across panels and tests.
export function defaultPointSettings(
  kind: PointAnimationKind = 'blinking'
): PointSettings {
  switch (kind) {
    case 'blinking':
      return {
        kind: 'blinking',
        color: '#ff4444',
        size: 12,
        opacity: 100,
        speed: 50,
        stroke: { enabled: true, color: '#ffffff', size: 2, opacity: 90 },
      };
    case 'explosion':
      return { kind: 'explosion', size: 48, opacity: 100, speed: 50, spread: 50 };
    case 'fire':
      return { kind: 'fire', size: 64, opacity: 100, speed: 50 };
    case 'earthquake':
      return { kind: 'earthquake', size: 64, opacity: 100 };
  }
}

// SPEC: "цвет, толщина, прозрачность" — дефолты чуть жирнее для читаемости
// поверх тайлов MapLibre (тонкая 2px линия едва видна на светлой теме).
export function defaultRouteSettings(): RouteSettings {
  return {
    lineType: 'solid',
    color: '#3d8bff',
    thickness: 4,
    opacity: 100,
    speed: 50,
    stroke: { enabled: true, color: '#000000', size: 2, opacity: 60 },
    icon: 'none',
    iconSize: ROUTE_ICON_SIZE_DEFAULT,
    useRoadRoute: false,
    arc: false,
  };
}

export function defaultLabelSettings(fontFamily = 'Montserrat'): LabelSettings {
  return {
    fontFamily,
    fontWeight: 400,
    fontSize: 18,
    color: '#ffffff',
    opacity: 100,
    stroke: { enabled: true, color: '#000000', size: 3, opacity: 90 },
    uppercase: false,
    truncateAtComma: true,
  };
}

// Matches first comma in "Moscow, Russia" → "Moscow". Pure — reused by both
// the PixiJS text renderer and unit tests.
export function renderLabelText(raw: string, s: LabelSettings): string {
  let text = raw;
  if (s.truncateAtComma) text = text.split(',')[0].trim();
  if (s.uppercase) text = text.toUpperCase();
  return text;
}

// === task7: Video export (editor settings, render uses in task8) =============
// SPEC.md §"Настройки видео" + task7.md
export type VideoResolution = '1920x1080' | '3840x2160';
export type VideoFps = 25 | 30 | 50 | 60;
export type VideoFormat = 'mp4' | 'mxf';
/** Temporary product lock: only Full HD render is available. */
export const LOCKED_VIDEO_RESOLUTION: VideoResolution = '1920x1080';
export const ACTIVE_VIDEO_FPS: readonly VideoFps[] = [25, 50];
export const ACTIVE_VIDEO_FORMAT: VideoFormat = 'mp4';

export interface VideoSettings {
  resolution: VideoResolution;
  fps: VideoFps;
  format: VideoFormat;
  /** seconds, 3–30 */
  duration: number;
  /** Must stay aligned with the live map style (task4). */
  theme: 'light' | 'dark';
  /** 0–100, strength of optional zoom "breathing" in preview. */
  cameraBreathing: number;
  /** Reference zoom captured at breathing activation time. */
  cameraBreathingReferenceZoom: number | null;
}

export interface GeoTitleSettings {
  enabled: boolean;
  /** Text after applying uppercase/truncate rules. */
  text: string;
  /** Raw user-entered text before formatting rules. */
  originalText: string;
  uppercase: boolean;
  truncateAtComma: boolean;
  fontFamily: string;
  fontWeight: number;
}

export const DEFAULT_GEO_TITLE_SETTINGS: GeoTitleSettings = {
  enabled: false,
  text: '',
  originalText: '',
  uppercase: true,
  truncateAtComma: true,
  fontFamily: 'Supermolot',
  fontWeight: 700,
};

export const DEFAULT_VIDEO_SETTINGS: VideoSettings = {
  resolution: LOCKED_VIDEO_RESOLUTION,
  fps: 25,
  format: 'mp4',
  duration: 10,
  theme: 'dark',
  cameraBreathing: 0,
  cameraBreathingReferenceZoom: null,
};

/** Clamps 3..30. Returns `null` if the string is not a valid integer. */
export function parseDurationField(value: string): number | null {
  const num = parseInt(value, 10);
  if (Number.isNaN(num)) return null;
  if (num < 3) return 3;
  if (num > 30) return 30;
  return num;
}

export function renderGeoTitleText(
  raw: string,
  opts: Pick<GeoTitleSettings, 'uppercase' | 'truncateAtComma'>
): string {
  let text = raw;
  if (opts.truncateAtComma) text = text.split(',')[0].trim();
  if (opts.uppercase) text = text.toUpperCase();
  return text;
}
