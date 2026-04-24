import { describe, expect, it } from 'vitest';
import { normalizeZoomForRenderV2 } from '../src/utils/render-camera-normalization';

describe('normalizeZoomForRenderV2', () => {
  it('не меняет zoom когда preview уже 1920', () => {
    expect(normalizeZoomForRenderV2(10, 1920)).toBeCloseTo(10, 8);
  });

  it('увеличивает zoom для узкого preview', () => {
    // 960 -> 1920 => +1 zoom level.
    expect(normalizeZoomForRenderV2(8, 960)).toBeCloseTo(9, 8);
  });

  it('уменьшает zoom для широкого preview', () => {
    // 3840 -> 1920 => -1 zoom level.
    expect(normalizeZoomForRenderV2(12, 3840)).toBeCloseTo(11, 8);
  });
});
