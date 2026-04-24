import * as PIXI from 'pixi.js';
import type { FirePointSettings, PointSettings } from '../../state/types';
import { percentToAlpha } from './colors';
import { sizeSpriteToPixels } from '../sprite-sizing';
import type { PointAnimation } from './types';

// Actual assets on disk: fire_loop000000.png … fire_loop000149.png (see
// SPEC.md update in task5 review, docs/... for rationale). 150 frames, the
// naming offset is 000000 — index `i` maps directly without a +1.
const FRAME_COUNT = 150;
const FRAME_PREFIX = 'fire_loop';
const FRAME_DIGITS = 6;
const FRAME_DIR = '/assets/icons/fire_loop';

// Cache textures across point instances so re-creating fire on another point
// doesn't re-parse 150 PNGs. This survives destroy() because we destroy
// sprites only, not textures (see EditorMap: pixi.destroy(...texture:false)).
let cachedFrames: PIXI.Texture[] | null = null;

function getFrames(): PIXI.Texture[] {
  if (cachedFrames) return cachedFrames;
  cachedFrames = [];
  for (let i = 0; i < FRAME_COUNT; i++) {
    const url = `${FRAME_DIR}/${FRAME_PREFIX}${String(i).padStart(FRAME_DIGITS, '0')}.png`;
    cachedFrames.push(PIXI.Texture.from(url));
  }
  return cachedFrames;
}

export function createFire(settings: PointSettings): PointAnimation {
  if (settings.kind !== 'fire') {
    throw new Error(`createFire called with kind=${settings.kind}`);
  }
  const s: FirePointSettings = settings;
  const container = new PIXI.Container();

  const frames = getFrames();
  const animation = new PIXI.AnimatedSprite(frames);
  // Bottom-center anchor so the base of the flame sticks to the point.
  animation.anchor.set(0.5, 1);
  // SPEC slider 0..100 maps to 0..1 animationSpeed via `/50*0.5` — 50 → 0.5,
  // matching the reference code in task5.md.
  animation.animationSpeed = (Math.max(0, Math.min(100, s.speed)) / 50) * 0.5;
  animation.loop = true;
  animation.play();
  animation.alpha = percentToAlpha(s.opacity);
  container.addChild(animation);
  // AnimatedSprite extends Sprite — the same sizing trick works. We size once
  // (against the first frame) and keep scale; subsequent frames are uniform
  // 512×512, so the rendered size stays at `s.size` across the loop.
  const cancelSizing = sizeSpriteToPixels(animation, s.size);

  return {
    container,
    // The flame extends upward from the anchor; pick a hit zone that tracks
    // the visible centre of the flame rather than a fat rectangle around it.
    hitRadius: s.size * 0.7,
    dispose(): void {
      cancelSizing();
      animation.stop();
      container.destroy({ children: true });
    },
  };
}
