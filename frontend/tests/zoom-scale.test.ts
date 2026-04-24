import { describe, it, expect } from 'vitest';
import {
  computeZoomScale,
  MIN_ZOOM_SCALE,
  MAX_ZOOM_SCALE,
} from '../src/pixi/zoom-scale';

describe('computeZoomScale', () => {
  it('clamps at the lower bound for very low zoom', () => {
    expect(computeZoomScale(0)).toBe(MIN_ZOOM_SCALE);
    expect(computeZoomScale(2)).toBe(MIN_ZOOM_SCALE);
  });

  it('grows monotonically in the linear regime', () => {
    const z6 = computeZoomScale(6);
    const z8 = computeZoomScale(8);
    const z10 = computeZoomScale(10);
    expect(z6).toBeLessThan(z8);
    expect(z8).toBeLessThan(z10);
  });

  it('clamps at the upper bound for very high zoom', () => {
    // The linear curve crosses 1.3 at z≈18.7; anything past that must clamp.
    expect(computeZoomScale(20)).toBe(MAX_ZOOM_SCALE);
    expect(computeZoomScale(22)).toBe(MAX_ZOOM_SCALE);
  });

  it('produces ~1.0 at the intended middle of the editing range', () => {
    // z≈13.6 is the formal crossing of 1.0 with the linear coeffs in
    // zoom-scale.ts. Verify the centre of the range is near unity so the
    // visual pipeline's designer-chosen slider sizes read as such.
    const z13 = computeZoomScale(13);
    expect(z13).toBeGreaterThanOrEqual(0.9);
    expect(z13).toBeLessThanOrEqual(1.05);
  });
});
