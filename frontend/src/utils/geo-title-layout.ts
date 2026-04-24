import type { GeoTitleSettings } from '../state/types';

export const GEO_TITLE_MAX_WIDTH_RATIO = 0.4;
export const GEO_TITLE_BOTTOM_RATIO = 0.25;
export const GEO_TITLE_ANIMATION_SEC = 0.8;

interface GeoTitleLayoutInput {
  frameWidth: number;
  frameHeight: number;
  geoTitle: GeoTitleSettings;
  animated?: boolean;
  timeSec?: number;
}

export interface GeoTitleLayout {
  visible: boolean;
  leftPx: number;
  bottomPx: number;
  plateWidthPx: number;
  plateHeightPx: number;
  tailWidthPx: number;
  bodyWidthPx: number;
  text: string;
  fontSizePx: number;
  textPaddingPx: number;
  translateXPx: number;
}

export function computeGeoTitleLayout(input: GeoTitleLayoutInput): GeoTitleLayout {
  const frameWidth = Math.max(1, input.frameWidth);
  const frameHeight = Math.max(1, input.frameHeight);
  const text = input.geoTitle.text.trim();
  if (!input.geoTitle.enabled || text.length === 0) {
    return hiddenLayout(frameHeight);
  }

  const plateHeightPx = clamp(frameHeight * 0.09, 42, 132);
  const tailWidthPx = plateHeightPx * 0.62;
  const maxPlateWidthPx = frameWidth * GEO_TITLE_MAX_WIDTH_RATIO;
  const bodyMaxWidthPx = Math.max(plateHeightPx * 1.5, maxPlateWidthPx - tailWidthPx);
  const textPaddingPx = Math.max(8, plateHeightPx * 0.18);

  let fontSizePx = Math.max(12, plateHeightPx * 0.6);
  const minFontPx = Math.max(12, plateHeightPx * 0.34);
  let requiredBodyWidthPx = textPaddingPx * 2 + measureTextWidth(text, input.geoTitle, fontSizePx);
  while (requiredBodyWidthPx > bodyMaxWidthPx && fontSizePx > minFontPx) {
    fontSizePx -= 1;
    requiredBodyWidthPx = textPaddingPx * 2 + measureTextWidth(text, input.geoTitle, fontSizePx);
  }
  const bodyWidthPx = Math.min(bodyMaxWidthPx, Math.max(plateHeightPx * 1.5, requiredBodyWidthPx));
  const plateWidthPx = tailWidthPx + bodyWidthPx;
  const bottomPx = frameHeight * GEO_TITLE_BOTTOM_RATIO;
  const translateXPx =
    input.animated === true
      ? -plateWidthPx * (1 - easeOutCubic(clamp((input.timeSec ?? 0) / GEO_TITLE_ANIMATION_SEC, 0, 1)))
      : 0;

  return {
    visible: true,
    leftPx: 0,
    bottomPx,
    plateWidthPx,
    plateHeightPx,
    tailWidthPx,
    bodyWidthPx,
    text,
    fontSizePx,
    textPaddingPx,
    translateXPx,
  };
}

function hiddenLayout(frameHeight: number): GeoTitleLayout {
  return {
    visible: false,
    leftPx: 0,
    bottomPx: frameHeight * GEO_TITLE_BOTTOM_RATIO,
    plateWidthPx: 0,
    plateHeightPx: 0,
    tailWidthPx: 0,
    bodyWidthPx: 0,
    text: '',
    fontSizePx: 0,
    textPaddingPx: 0,
    translateXPx: 0,
  };
}

function measureTextWidth(text: string, settings: GeoTitleSettings, fontSizePx: number): number {
  if (typeof document === 'undefined') {
    return text.length * fontSizePx * 0.58;
  }
  const canvas = getMeasureCanvas();
  const ctx = canvas.getContext('2d');
  if (!ctx) return text.length * fontSizePx * 0.58;
  ctx.font = `${settings.fontWeight} ${fontSizePx}px "${settings.fontFamily}", sans-serif`;
  return ctx.measureText(text).width;
}

let measureCanvas: HTMLCanvasElement | null = null;
function getMeasureCanvas(): HTMLCanvasElement {
  if (!measureCanvas) measureCanvas = document.createElement('canvas');
  return measureCanvas;
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
