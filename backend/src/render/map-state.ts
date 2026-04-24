// Mirror of frontend `src/types/map-state.ts` (task8).
export const MAP_STATE_VERSION = '1.0' as const;

export interface MapStateV1 {
  version: typeof MAP_STATE_VERSION;
  map: {
    center: { lng: number; lat: number };
    zoom: number;
    bearing?: number;
    pitch?: number;
    theme: 'light' | 'dark';
  };
  video: {
    resolution: '1920x1080';
    fps: 25 | 50;
    format: 'mp4';
    duration: number;
    theme: 'light' | 'dark';
    cameraBreathing: number;
    cameraBreathingReferenceZoom?: number | null;
  };
  geoTitle?: {
    enabled: boolean;
    text: string;
    originalText: string;
    uppercase: boolean;
    truncateAtComma: boolean;
    fontFamily: string;
    fontWeight: number;
  };
  render: {
    engineVersion: 'v2';
    previewFrame: {
      widthPx: number;
      heightPx: number;
    };
    devicePixelRatio: number;
    pageZoom: number;
  };
  elements: unknown;
}

const VALID_RESOLUTIONS = new Set(['1920x1080']);
const VALID_FPS = new Set([25, 50]);
const VALID_FORMATS = new Set(['mp4']);
const VALID_THEMES = new Set(['light', 'dark']);
const MAX_ELEMENTS = 500;

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function isMapStateV1(x: unknown): x is MapStateV1 {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  if (o.version !== '1.0') return false;

  const map = o.map as Record<string, unknown> | null;
  if (!map || typeof map !== 'object') return false;
  const center = map.center as Record<string, unknown> | null;
  if (!center || typeof center !== 'object') return false;
  if (!isFiniteNum(center.lng) || !isFiniteNum(center.lat)) return false;
  if (!isFiniteNum(map.zoom) || (map.zoom as number) < 0 || (map.zoom as number) > 22) return false;
  if (map.bearing !== undefined && (!isFiniteNum(map.bearing) || (map.bearing as number) < -360 || (map.bearing as number) > 360)) return false;
  if (map.pitch !== undefined && (!isFiniteNum(map.pitch) || (map.pitch as number) < 0 || (map.pitch as number) > 85)) return false;
  if (!VALID_THEMES.has(map.theme as string)) return false;

  const video = o.video as Record<string, unknown> | null;
  if (!video || typeof video !== 'object') return false;
  if (!VALID_RESOLUTIONS.has(video.resolution as string)) return false;
  if (!VALID_FPS.has(video.fps as number)) return false;
  if (!VALID_FORMATS.has(video.format as string)) return false;
  if (!isFiniteNum(video.duration) || (video.duration as number) < 3 || (video.duration as number) > 30) return false;
  if (!VALID_THEMES.has(video.theme as string)) return false;
  if (!isFiniteNum(video.cameraBreathing) || (video.cameraBreathing as number) < 0 || (video.cameraBreathing as number) > 100) return false;
  if (
    video.cameraBreathingReferenceZoom !== undefined &&
    video.cameraBreathingReferenceZoom !== null &&
    (!isFiniteNum(video.cameraBreathingReferenceZoom) ||
      (video.cameraBreathingReferenceZoom as number) < 0 ||
      (video.cameraBreathingReferenceZoom as number) > 22)
  ) {
    return false;
  }

  if (o.geoTitle !== undefined) {
    const gt = o.geoTitle as Record<string, unknown> | null;
    if (!gt || typeof gt !== 'object') return false;
    if (typeof gt.enabled !== 'boolean') return false;
    if (typeof gt.text !== 'string') return false;
    if (typeof gt.originalText !== 'string') return false;
    if (typeof gt.uppercase !== 'boolean') return false;
    if (typeof gt.truncateAtComma !== 'boolean') return false;
    if (typeof gt.fontFamily !== 'string' || gt.fontFamily.trim().length === 0) return false;
    if (!isFiniteNum(gt.fontWeight) || (gt.fontWeight as number) < 100 || (gt.fontWeight as number) > 900) {
      return false;
    }
    if (gt.enabled && (gt.text as string).trim().length === 0) return false;
  }

  const r = o.render as Record<string, unknown> | null;
  if (!r || typeof r !== 'object') return false;
  if (r.engineVersion !== 'v2') return false;
  const frame = r.previewFrame as Record<string, unknown> | null;
  if (!frame || typeof frame !== 'object') return false;
  if (!isFiniteNum(frame.widthPx) || (frame.widthPx as number) <= 0) return false;
  if (!isFiniteNum(frame.heightPx) || (frame.heightPx as number) <= 0) return false;
  if (!isFiniteNum(r.devicePixelRatio) || (r.devicePixelRatio as number) <= 0) return false;
  if (!isFiniteNum(r.pageZoom) || (r.pageZoom as number) <= 0) return false;

  if (!Array.isArray(o.elements) || o.elements.length > MAX_ELEMENTS) return false;

  return true;
}
