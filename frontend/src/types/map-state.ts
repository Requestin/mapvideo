// task8: wire format POST /api/render + GET /api/render/state — keep in sync
// with `backend/src/render/map-state.ts`.
import type { GeoTitleSettings, MapElement, VideoSettings } from '../state/types';

export const MAP_STATE_VERSION = '1.0' as const;
export const RENDER_ENGINE_VERSION_V2 = 'v2' as const;

export interface RenderSnapshotV2 {
  engineVersion: typeof RENDER_ENGINE_VERSION_V2;
  previewFrame: {
    widthPx: number;
    heightPx: number;
  };
  devicePixelRatio: number;
  pageZoom: number;
}

export interface MapStateV1 {
  version: typeof MAP_STATE_VERSION;
  map: {
    center: { lng: number; lat: number };
    zoom: number;
    bearing?: number;
    pitch?: number;
    theme: 'light' | 'dark';
  };
  video: VideoSettings;
  geoTitle?: GeoTitleSettings;
  render: RenderSnapshotV2;
  elements: MapElement[];
}
