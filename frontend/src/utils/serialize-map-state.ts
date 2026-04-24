import type { Map as MapLibreMap } from 'maplibre-gl';
import type { GeoTitleSettings, MapElement, VideoSettings } from '../state/types';
import {
  MAP_STATE_VERSION,
  RENDER_ENGINE_VERSION_V2,
  type MapStateV1,
} from '../types/map-state';

export interface RenderSnapshotContext {
  previewFrame: { widthPx: number; heightPx: number };
  devicePixelRatio: number;
  pageZoom: number;
}

export function serializeMapState(
  elements: MapElement[],
  map: MapLibreMap,
  videoSettings: VideoSettings,
  geoTitle: GeoTitleSettings,
  renderSnapshot: RenderSnapshotContext
): MapStateV1 {
  const c = map.getCenter();
  const bearing =
    typeof (map as unknown as { getBearing?: () => number }).getBearing === 'function'
      ? (map as unknown as { getBearing: () => number }).getBearing()
      : 0;
  const pitch =
    typeof (map as unknown as { getPitch?: () => number }).getPitch === 'function'
      ? (map as unknown as { getPitch: () => number }).getPitch()
      : 0;
  return {
    version: MAP_STATE_VERSION,
    map: {
      center: { lng: c.lng, lat: c.lat },
      zoom:
        videoSettings.cameraBreathing > 0 && videoSettings.cameraBreathingReferenceZoom != null
          ? videoSettings.cameraBreathingReferenceZoom
          : map.getZoom(),
      bearing,
      pitch,
      theme: videoSettings.theme,
    },
    video: { ...videoSettings },
    geoTitle: { ...geoTitle },
    render: {
      engineVersion: RENDER_ENGINE_VERSION_V2,
      previewFrame: {
        widthPx: Math.max(1, Math.round(renderSnapshot.previewFrame.widthPx)),
        heightPx: Math.max(1, Math.round(renderSnapshot.previewFrame.heightPx)),
      },
      devicePixelRatio: Number.isFinite(renderSnapshot.devicePixelRatio)
        ? Math.max(0.1, renderSnapshot.devicePixelRatio)
        : 1,
      pageZoom: Number.isFinite(renderSnapshot.pageZoom)
        ? Math.max(0.1, renderSnapshot.pageZoom)
        : 1,
    },
    elements: structuredClone(elements),
  };
}
