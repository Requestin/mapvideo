import { describe, it, expect } from 'vitest';
import { __pickTargetForTests as pickTarget } from '../src/pixi/use-element-drag';
import type { HitTarget } from '../src/pixi/pixi-layer';

const circle = (id: string, x: number, y: number, r: number): HitTarget => ({
  id,
  kind: 'point',
  x,
  y,
  hit: { shape: 'circle', radius: r },
});

const rect = (id: string, x: number, y: number, w: number, h: number): HitTarget => ({
  id,
  kind: 'label',
  x,
  y,
  hit: { shape: 'rect', halfW: w / 2, halfH: h / 2 },
});

describe('pickTarget', () => {
  it('returns null when no targets are hit', () => {
    expect(pickTarget([circle('p1', 0, 0, 10)], 100, 100)).toBeNull();
  });

  it('hits a circle within its radius', () => {
    expect(pickTarget([circle('p1', 50, 50, 10)], 55, 55)?.id).toBe('p1');
  });

  it('misses outside the circle', () => {
    expect(pickTarget([circle('p1', 50, 50, 10)], 70, 70)).toBeNull();
  });

  it('hits a rectangle within half-extents', () => {
    expect(pickTarget([rect('l1', 100, 100, 40, 20)], 115, 105)?.id).toBe('l1');
  });

  it('prefers topmost target when overlapping', () => {
    const targets = [circle('bg', 0, 0, 50), circle('fg', 0, 0, 50)];
    expect(pickTarget(targets, 0, 0)?.id).toBe('fg');
  });
});
