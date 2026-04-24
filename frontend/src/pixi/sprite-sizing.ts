import type * as PIXI from 'pixi.js';

// Works around a sharp edge in Pixi 7's `Sprite` and `AnimatedSprite`: the
// `.width` / `.height` setters compute `scale = value / texture.orig.width`
// *synchronously* against whatever texture the sprite currently holds.
//
// `PIXI.Sprite.from(url)` and `PIXI.Texture.from(url)` return a sprite/texture
// whose baseTexture is still EMPTY (1×1) until the HTTP request completes.
// If you call `sprite.width = 48` at that moment, `scale.x` ends up at 48.
// When the real 512×512 PNG arrives, the scale is preserved, so the rendered
// size balloons to `48 × 512 = 24 576 px`. That's the "icons look empty"
// symptom — they actually dominate the entire canvas.
//
// This helper defers the `.width = size` write until `baseTexture.valid` is
// true. Returns a cancel function so dispose() can detach the listener.
export function sizeSpriteToPixels(sprite: PIXI.Sprite, pxSize: number): () => void {
  let cancelled = false;
  let rafId = 0;
  let stagedHidden = false;

  const isTextureReady = (): boolean => {
    const tex = sprite.texture;
    const bt = tex.baseTexture;
    // Some Pixi placeholders report `valid=true` with 1x1 dimensions before
    // the real image arrives. Applying width/height in that state explodes the
    // final rendered size once the true 512x512 texture replaces it.
    return (
      bt.valid &&
      bt.width > 1 &&
      bt.height > 1 &&
      tex.orig.width > 1 &&
      tex.orig.height > 1
    );
  };

  const apply = (): void => {
    if (cancelled) return;
    // sprite may have been destroyed between schedule and fire. A destroyed
    // sprite's `.texture` is gone → guard via a flag on our side.
    sprite.width = pxSize;
    sprite.height = pxSize;
    if (stagedHidden) {
      sprite.renderable = true;
      stagedHidden = false;
    }
  };

  if (isTextureReady()) {
    apply();
    return () => {
      cancelled = true;
    };
  }

  // Prevent one-frame "giant icon" flash: until we can safely size by pixels,
  // keep the sprite non-renderable.
  sprite.renderable = false;
  stagedHidden = true;

  const waitUntilReady = (): void => {
    if (cancelled) return;
    if (isTextureReady()) {
      apply();
      return;
    }
    rafId = window.requestAnimationFrame(waitUntilReady);
  };
  rafId = window.requestAnimationFrame(waitUntilReady);

  return () => {
    cancelled = true;
    if (rafId) window.cancelAnimationFrame(rafId);
    if (stagedHidden) {
      // Best effort restore for non-destroy paths; dispose() usually destroys
      // sprite anyway, but this keeps helper behaviour predictable.
      sprite.renderable = true;
      stagedHidden = false;
    }
  };
}
