import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import type { ExplosionPointSettings, PointSettings } from '../../state/types';
import { percentToAlpha } from './colors';
import { sizeSpriteToPixels } from '../sprite-sizing';
import type { PointAnimation } from './types';

const ICON_URL = '/assets/icons/explosion.png';
const RING_COUNT = 3;
const RING_COLOR = 0xff4400;

export function createExplosion(settings: PointSettings): PointAnimation {
  if (settings.kind !== 'explosion') {
    throw new Error(`createExplosion called with kind=${settings.kind}`);
  }
  const s: ExplosionPointSettings = settings;
  const container = new PIXI.Container();
  container.sortableChildren = true;

  const alpha = percentToAlpha(s.opacity);

  // Rings sit *below* the icon so the art stays visible in the centre.
  const timelines: gsap.core.Timeline[] = [];
  const normalizedSpeed = Math.max(1, Math.min(100, s.speed)) / 50;
  const ringDuration = 1.5 / normalizedSpeed;
  // Keep the first ring tied to icon size, but much closer to the icon body.
  // (previously `size * 2` produced a large empty gap before the first ring)
  const baseRadius = Math.max(10, s.size * 0.73);
  const spread = Number.isFinite(s.spread) ? s.spread : 50;
  const maxScale = 1 + (Math.max(0, Math.min(100, spread)) / 100) * 2;

  for (let i = 0; i < RING_COUNT; i++) {
    const ring = new PIXI.Graphics();
    ring.lineStyle(2, RING_COLOR, 0.8);
    ring.drawCircle(0, 0, baseRadius);
    ring.zIndex = 0;
    container.addChild(ring);

    const tl = gsap
      .timeline({ repeat: -1, delay: i * (ringDuration / RING_COUNT) })
      .fromTo(
        ring.scale,
        { x: 1, y: 1 },
        { x: maxScale, y: maxScale, duration: ringDuration, ease: 'power1.out' }
      )
      .fromTo(
        ring,
        { alpha: 0.8 },
        { alpha: 0, duration: ringDuration, ease: 'power1.out' },
        '<'
      );
    timelines.push(tl);
  }

  // Static icon on top. Size is set asynchronously once the texture finishes
  // loading — see sprite-sizing.ts for why we can't use `scale.set(...)` here.
  const icon = PIXI.Sprite.from(ICON_URL);
  // Requested behavior: epicenter in the center of the whole icon image.
  icon.anchor.set(0.5);
  icon.alpha = alpha;
  icon.zIndex = 1;
  container.addChild(icon);
  const cancelSizing = sizeSpriteToPixels(icon, s.size);

  return {
    container,
    hitRadius: s.size,
    dispose(): void {
      cancelSizing();
      for (const tl of timelines) tl.kill();
      container.destroy({ children: true });
    },
  };
}
