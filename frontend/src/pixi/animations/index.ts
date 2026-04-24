import type { PointSettings } from '../../state/types';
import { createBlinkingPoint } from './blinking-point';
import { createEarthquake } from './earthquake';
import { createExplosion } from './explosion';
import { createFire } from './fire';
import type { PointAnimation, PointAnimationFactory } from './types';

const factories: Record<PointSettings['kind'], PointAnimationFactory> = {
  blinking: createBlinkingPoint,
  explosion: createExplosion,
  fire: createFire,
  earthquake: createEarthquake,
};

export function createPointAnimation(settings: PointSettings): PointAnimation {
  return factories[settings.kind](settings);
}

export type { PointAnimation };
