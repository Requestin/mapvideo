import { describe, expect, it, vi } from 'vitest';
import { serializeMapState } from '../src/utils/serialize-map-state';
import { DEFAULT_GEO_TITLE_SETTINGS, DEFAULT_VIDEO_SETTINGS } from '../src/state/types';
import type { MapElement } from '../src/state/types';

describe('serializeMapState (task8)', () => {
  it('собирает MapStateV1 с версией, картой, video и клоном elements', () => {
    const getCenter = vi.fn(() => ({ lng: 30, lat: 59 }));
    const getZoom = vi.fn(() => 11);
    const map = { getCenter, getZoom } as never;
    const elements: MapElement[] = [];
    const s = serializeMapState(
      elements,
      map,
      { ...DEFAULT_VIDEO_SETTINGS, theme: 'light' },
      DEFAULT_GEO_TITLE_SETTINGS,
      {
        previewFrame: { widthPx: 1600, heightPx: 900 },
        devicePixelRatio: 2,
        pageZoom: 1.25,
      }
    );
    expect(s.version).toBe('1.0');
    expect(s.map.center).toEqual({ lng: 30, lat: 59 });
    expect(s.map.zoom).toBe(11);
    expect(s.map.theme).toBe('light');
    expect(s.video.theme).toBe('light');
    expect(s.geoTitle).toEqual(DEFAULT_GEO_TITLE_SETTINGS);
    expect(s.render?.engineVersion).toBe('v2');
    expect(s.render?.previewFrame).toEqual({ widthPx: 1600, heightPx: 900 });
    expect(s.render?.devicePixelRatio).toBe(2);
    expect(s.render?.pageZoom).toBe(1.25);
    expect(s.elements).toEqual([]);
  });
});
