// Maps MapLibre zoom level to a visual scale factor applied to every element
// container in PixiLayer. Chosen to keep world/continent views readable (so
// 10 labels don't pile into one blob at z=2) while letting city/street views
// stay at designer-intended pixel sizes.
//
// Curve (linear, clamped):
//   zoom  2  →  0.30
//   zoom  4  →  0.42
//   zoom  6  →  0.54
//   zoom  8  →  0.66
//   zoom 10  →  0.78
//   zoom 14  →  1.02
//   zoom 18  →  1.26  (clamp)
//
// We intentionally avoid an exponential curve (2^(zoom/N)) because the visual
// pacing of zoom levels in MapLibre is already log-scale (each level halves
// ground distance). Stacking another exponent would cause points to grow too
// aggressively between zooms 8–12 — the most common editing range.
export const MIN_ZOOM_SCALE = 0.3;
export const MAX_ZOOM_SCALE = 1.3;
const ZOOM_SCALE_BASE = 0.3;
const ZOOM_SCALE_PER_LEVEL = 0.06;
const ZOOM_REF = 2;

export function computeZoomScale(zoom: number): number {
  const raw = ZOOM_SCALE_BASE + (zoom - ZOOM_REF) * ZOOM_SCALE_PER_LEVEL;
  return Math.max(MIN_ZOOM_SCALE, Math.min(MAX_ZOOM_SCALE, raw));
}
