// CSS hex ("#rrggbb") → 24-bit integer for PIXI.Graphics.beginFill.
// Accepts 3- or 6-digit hex, with or without leading '#'. Falls back to
// 0xffffff for bogus input so the editor never renders a black-void marker.
export function hexToPixiColor(hex: string): number {
  if (typeof hex !== 'string') return 0xffffff;
  let v = hex.trim().replace(/^#/, '');
  if (v.length === 3) {
    v = v.split('').map((c) => c + c).join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(v)) return 0xffffff;
  return parseInt(v, 16);
}

/** Clamp 0..100 slider → 0..1 alpha. */
export function percentToAlpha(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.max(0, Math.min(100, v)) / 100;
}
