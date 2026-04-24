import { describe, it, expect } from 'vitest';
import { hexToPixiColor, percentToAlpha } from '../src/pixi/animations/colors';

describe('hexToPixiColor', () => {
  it('parses 6-digit hex', () => {
    expect(hexToPixiColor('#ff4400')).toBe(0xff4400);
  });

  it('expands 3-digit hex', () => {
    expect(hexToPixiColor('#abc')).toBe(0xaabbcc);
  });

  it('tolerates missing #', () => {
    expect(hexToPixiColor('00ff00')).toBe(0x00ff00);
  });

  it('falls back to white on bogus input', () => {
    expect(hexToPixiColor('not-a-colour')).toBe(0xffffff);
    expect(hexToPixiColor(undefined as unknown as string)).toBe(0xffffff);
  });
});

describe('percentToAlpha', () => {
  it('maps 0..100 to 0..1', () => {
    expect(percentToAlpha(0)).toBe(0);
    expect(percentToAlpha(50)).toBe(0.5);
    expect(percentToAlpha(100)).toBe(1);
  });

  it('clamps out-of-range inputs', () => {
    expect(percentToAlpha(-10)).toBe(0);
    expect(percentToAlpha(999)).toBe(1);
  });

  it('NaN fallback', () => {
    expect(percentToAlpha(Number.NaN)).toBe(1);
  });
});
