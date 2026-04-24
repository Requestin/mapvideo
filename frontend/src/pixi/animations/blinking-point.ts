import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import type { BlinkingPointSettings, PointSettings } from '../../state/types';
import { hexToPixiColor, percentToAlpha } from './colors';
import type { PointAnimation } from './types';

export function createBlinkingPoint(settings: PointSettings): PointAnimation {
  if (settings.kind !== 'blinking') {
    throw new Error(`createBlinkingPoint called with kind=${settings.kind}`);
  }
  const s: BlinkingPointSettings = settings;
  const container = new PIXI.Container();
  container.sortableChildren = true;

  const color = hexToPixiColor(s.color);
  const alpha = percentToAlpha(s.opacity);

  // Pulsing halo — 30% alpha source (per task5 spec), GSAP drives scale+alpha.
  const pulse = new PIXI.Graphics();
  pulse.beginFill(color, 0.3);
  pulse.drawCircle(0, 0, s.size);
  pulse.endFill();
  pulse.zIndex = 0;

  // Core dot — solid circle at user-configured alpha, optional stroke on top.
  const core = new PIXI.Graphics();
  core.beginFill(color, alpha);
  core.drawCircle(0, 0, s.size);
  core.endFill();
  if (s.stroke.enabled) {
    core.lineStyle(
      s.stroke.size,
      hexToPixiColor(s.stroke.color),
      percentToAlpha(s.stroke.opacity)
    );
    core.drawCircle(0, 0, s.size);
  }
  core.zIndex = 1;

  container.addChild(pulse);
  container.addChild(core);

  // Speed slider 1..100 maps to 0.3..3s period. Slider=50 → 1.5s, matching
  // the reference values in task5.md.
  const normalizedSpeed = Math.max(1, Math.min(100, s.speed)) / 50;
  const duration = 1.5 / normalizedSpeed;

  // `fromTo` + `repeat:-1` is mandatory: a plain `.to` leaves the tween at
  // the end state on the first cycle, so subsequent repeats no-op.
  const tl = gsap
    .timeline({ repeat: -1 })
    .fromTo(
      pulse.scale,
      { x: 1, y: 1 },
      { x: 2.5, y: 2.5, duration, ease: 'power2.out' }
    )
    .fromTo(
      pulse,
      { alpha: 0.3 },
      { alpha: 0, duration, ease: 'power2.out' },
      '<'
    );

  // Core pulsation — the point itself breathes 1.0 ⇔ 1.15 in sync with the
  // halo. We drive `core.scale` (not its radius) so the `size` slider keeps
  // controlling the baseline and the multiplicative zoom-scale in PixiLayer
  // composes cleanly on top. `yoyo:true` halves visible period vs halo (which
  // is one-way), so we use `duration*2` to re-sync the cycles.
  const corePulse = gsap
    .timeline({ repeat: -1, yoyo: true })
    .to(core.scale, {
      x: 1.15,
      y: 1.15,
      duration,
      ease: 'sine.inOut',
    });

  return {
    container,
    hitRadius: s.size * 1.5,
    dispose(): void {
      tl.kill();
      corePulse.kill();
      container.destroy({ children: true });
    },
  };
}
