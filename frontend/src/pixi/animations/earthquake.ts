import * as PIXI from 'pixi.js';
import type { EarthquakePointSettings, PointSettings } from '../../state/types';
import { percentToAlpha } from './colors';
import { sizeSpriteToPixels } from '../sprite-sizing';
import type { PointAnimation } from './types';

const ICON_URL = '/assets/icons/earthquake.png';

export function createEarthquake(settings: PointSettings): PointAnimation {
  if (settings.kind !== 'earthquake') {
    throw new Error(`createEarthquake called with kind=${settings.kind}`);
  }
  const s: EarthquakePointSettings = settings;
  const container = new PIXI.Container();

  const icon = PIXI.Sprite.from(ICON_URL);
  icon.anchor.set(0.5);
  icon.alpha = percentToAlpha(s.opacity);
  container.addChild(icon);
  const cancelSizing = sizeSpriteToPixels(icon, s.size);

  return {
    container,
    hitRadius: s.size * 0.8,
    dispose(): void {
      cancelSizing();
      container.destroy({ children: true });
    },
  };
}
