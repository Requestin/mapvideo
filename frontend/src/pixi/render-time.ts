/** task8: Puppeteer drives animation time via `window.__RENDER_TIME_MS__`. */

declare global {
  interface Window {
    __RENDER_CAPTURE__?: boolean;
    __RENDER_TIME_MS__?: number;
  }
}

export function getAnimationTimeMs(): number {
  if (typeof window === 'undefined') return 0;
  const v = window.__RENDER_TIME_MS__;
  if (v != null && Number.isFinite(v)) {
    return v;
  }
  return performance.now();
}

export function isRenderCaptureMode(): boolean {
  return typeof window !== 'undefined' && window.__RENDER_CAPTURE__ === true;
}
