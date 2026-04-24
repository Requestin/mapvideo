import type * as PIXI from 'pixi.js';
import type { PointSettings } from '../../state/types';

// Every animation-creator returns a live container ready to be added to the
// Pixi stage plus a disposer that tears down GSAP timelines / AnimatedSprite
// tickers. The creator is called again whenever settings change (live
// preview), so disposers must be synchronous and idempotent.
export interface PointAnimation {
  container: PIXI.Container;
  /** Hit-test radius in pixels — used by the drag controller and by click
   *  selection. Changes with `settings.size`; the controller reads it on
   *  every rebuild. */
  hitRadius: number;
  dispose(): void;
}

export type PointAnimationFactory = (settings: PointSettings) => PointAnimation;
