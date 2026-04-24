import * as PIXI from 'pixi.js';
import {
  ROUTE_ICON_SIZE_DEFAULT,
  ROUTE_ICON_SIZE_MAX,
  ROUTE_ICON_SIZE_MIN,
  type RouteSettings,
  type RouteTransportIcon,
} from '../../state/types';
import { hexToPixiColor, percentToAlpha } from '../animations/colors';
import { sampleAlongPolyline } from './path';
import { sizeSpriteToPixels } from '../sprite-sizing';

// task6 SPEC §Анимация: solid — пульсация, dashed — движение пунктира А→Б.
// `speed` slider (1..100) мапится в period (для пульсации) и в px/s (для
// бегущего пунктира). Значения подобраны, чтобы speed=50 ≈ "средне":
//   • solid: 2 секунды цикл at speed=50
//   • dashed: 40 px/s at speed=50
const SOLID_MIN_PERIOD_S = 0.6;
const SOLID_MAX_PERIOD_S = 3.0;
const DASHED_MIN_PX_PER_S = 10;
const DASHED_MAX_PX_PER_S = 120;

// Transport icon mapping — SPEC §Ассеты. Critical: PNG files are named
// `airplane.png`, not `plane.png` (task10–14 aftermath: the old task6.md
// example used `plane` by mistake).
const TRANSPORT_ASSET: Record<Exclude<RouteTransportIcon, 'none'>, string> = {
  car: '/assets/icons/car.png',
  airplane: '/assets/icons/airplane.png',
  helicopter: '/assets/icons/helicopter.png',
  ship: '/assets/icons/ship.png',
};
const DEFAULT_VIDEO_DURATION_S = 10;

export interface RouteRender {
  container: PIXI.Container;
  /** Re-draw the route on every map render tick. Keep it O(path.length). */
  redraw(
    pixels: { x: number; y: number }[],
    timeMs: number,
    endHasArrow: boolean,
    videoDurationSec: number,
    legPixels: { x: number; y: number }[][]
  ): void;
  /** Pixel half-thickness — used to size hit-rectangles for click-to-select
   *  in a future task; for now we just expose it so the registry can keep
   *  a record. */
  hitHalfThickness: number;
  dispose(): void;
}

export function createRouteRender(settings: RouteSettings): RouteRender {
  const container = new PIXI.Container();
  container.sortableChildren = true;

  // Under-layer: stroke (окантовка) — drawn first so the main line paints
  // over the top. Separate graphics per layer simplifies redraw (clear
  // them in lockstep rather than replaying one alternating path).
  const strokeG = new PIXI.Graphics();
  strokeG.zIndex = 0;
  const lineG = new PIXI.Graphics();
  lineG.zIndex = 1;
  const arrowG = new PIXI.Graphics();
  arrowG.zIndex = 2;
  container.addChild(strokeG);
  container.addChild(lineG);
  container.addChild(arrowG);

  // Transport icon — loaded lazily (sprite is null for icon==='none').
  let icon: PIXI.Sprite | null = null;
  const iconSizePx = resolveTransportIconSize(settings.iconSize);
  if (settings.icon !== 'none' && !settings.useRoadRoute) {
    const sprite = PIXI.Sprite.from(TRANSPORT_ASSET[settings.icon]);
    sprite.anchor.set(0.5);
    sprite.zIndex = 3;
    // task10: sprite is 1×1 until the texture decodes — size it when ready.
    sizeSpriteToPixels(sprite, iconSizePx);
    container.addChild(sprite);
    icon = sprite;
  }

  const color = hexToPixiColor(settings.color);
  const baseAlpha = percentToAlpha(settings.opacity);
  const strokeColor = hexToPixiColor(settings.stroke.color);
  const strokeAlpha = percentToAlpha(settings.stroke.opacity);

  // Speed mapping. Clamp to avoid a user slamming the slider to 0 and
  // getting a frozen pulse / infinite dash period.
  const sp = Math.max(1, Math.min(100, settings.speed));
  const solidPeriodS =
    SOLID_MAX_PERIOD_S - ((SOLID_MAX_PERIOD_S - SOLID_MIN_PERIOD_S) * (sp - 1)) / 99;
  const dashedPxPerS =
    DASHED_MIN_PX_PER_S + ((DASHED_MAX_PX_PER_S - DASHED_MIN_PX_PER_S) * (sp - 1)) / 99;

  function redraw(
    pixels: { x: number; y: number }[],
    timeMs: number,
    endHasArrow: boolean,
    videoDurationSec: number,
    legPixels: { x: number; y: number }[][]
  ): void {
    strokeG.clear();
    lineG.clear();
    arrowG.clear();
    if (icon) icon.visible = false;
    if (pixels.length < 2) return;

    const timeS = timeMs / 1000;
    // Solid: pulse alpha with sine → 40%..100% of the user alpha. Gives a
    // breathing feel without becoming invisible at the trough.
    let drawAlpha = baseAlpha;
    if (settings.lineType === 'solid') {
      const phase = (timeS % solidPeriodS) / solidPeriodS;
      const k = 0.5 + 0.5 * Math.sin(2 * Math.PI * phase);
      drawAlpha = baseAlpha * (0.4 + 0.6 * k);
    }

    // --- stroke ---
    if (settings.stroke.enabled && settings.stroke.size > 0) {
      const sTh = settings.thickness + settings.stroke.size * 2;
      strokeG.lineStyle({ width: sTh, color: strokeColor, alpha: strokeAlpha, cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND });
      if (settings.lineType === 'solid') {
        drawPolyline(strokeG, pixels);
      } else {
        const dashOn = Math.max(8, settings.thickness * 2.8);
        const dashOff = Math.max(6, settings.thickness * 1.9 + (settings.stroke.enabled ? settings.stroke.size * 1.5 : 0));
        // Negative offset keeps dash flow in the same direction as the polyline:
        // A -> B for single routes and leg-by-leg for waypoint chains.
        const offsetPx = (-timeS * dashedPxPerS) % (dashOn + dashOff);
        drawDashedPolyline(strokeG, pixels, dashOn, dashOff, offsetPx);
      }
    }

    // --- main line ---
    lineG.lineStyle({ width: settings.thickness, color, alpha: drawAlpha, cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND });
    if (settings.lineType === 'solid') {
      drawPolyline(lineG, pixels);
    } else {
      const dashOn = Math.max(8, settings.thickness * 2.8);
      const dashOff = Math.max(6, settings.thickness * 1.9 + (settings.stroke.enabled ? settings.stroke.size * 1.5 : 0));
      const offsetPx = (-timeS * dashedPxPerS) % (dashOn + dashOff);
      drawDashedPolyline(lineG, pixels, dashOn, dashOff, offsetPx);
    }

    // --- arrow head (only if the route ends in free space) ---
    if (endHasArrow) {
      drawArrowHead(
        arrowG,
        pixels,
        settings.thickness,
        settings.stroke.enabled ? settings.stroke.size : 0,
        color,
        baseAlpha
      );
    }

    // --- transport icon ---
    if (icon && settings.icon !== 'none' && !settings.useRoadRoute) {
      const duration = Math.max(3, Math.min(30, videoDurationSec || DEFAULT_VIDEO_DURATION_S));
      const sample = sampleAlongLegs(legPixels, timeS, duration);
      if (sample) {
        icon.visible = true;
        const lineHalf = settings.thickness * 0.5 + (settings.stroke.enabled ? settings.stroke.size : 0);
        const iconFloat = iconSizePx * 0.28 + Math.max(1, iconSizePx * 0.03);
        const liftPx = lineHalf + iconFloat;
        // For each segment, pick the side that's visually "higher" on screen
        // so the icon doesn't sink under the line on opposite headings.
        const normal = resolveIconLiftNormal(sample.angle);
        icon.position.set(sample.x + normal.x * liftPx, sample.y + normal.y * liftPx);
        // Все PNG нарисованы носом вправо (SPEC §Ассеты), поэтому
        // rotation = angle без поправок.
        icon.rotation = sample.angle;
        // When moving into the left hemisphere (90..270 degrees), keep icon
        // upright by mirroring vertically while preserving the pixel size set
        // by sizeSpriteToPixels().
        const absScaleY = Math.abs(icon.scale.y || 1);
        icon.scale.y = Math.cos(sample.angle) < 0 ? -absScaleY : absScaleY;
        icon.alpha = sample.alpha;
      }
    }
  }

  return {
    container,
    redraw,
    hitHalfThickness:
      (settings.thickness + (settings.stroke.enabled ? settings.stroke.size * 2 : 0)) / 2,
    dispose(): void {
      container.destroy({ children: true });
    },
  };
}

function sampleAlongLegs(
  legs: { x: number; y: number }[][],
  timeSec: number,
  durationSec: number
): { x: number; y: number; angle: number; alpha: number } | null {
  const usable = legs.filter((leg) => leg.length >= 2);
  if (usable.length === 0) return null;
  const total = Math.max(0.001, durationSec);
  const tMod = ((timeSec % total) + total) % total;
  const legDuration = total / usable.length;
  const legIndex = Math.min(usable.length - 1, Math.floor(tMod / legDuration));
  const localT = (tMod - legDuration * legIndex) / legDuration;
  const sample = sampleAlongPolyline(usable[legIndex], localT);
  if (!sample) return null;
  const fadeSeconds = Math.min(0.5, legDuration * 0.25);
  const fadeT = fadeSeconds / legDuration;
  const fadeIn = Math.min(1, localT / Math.max(fadeT, 0.0001));
  const fadeOut = Math.min(1, (1 - localT) / Math.max(fadeT, 0.0001));
  return { ...sample, alpha: Math.max(0.15, Math.min(fadeIn, fadeOut)) };
}

function drawPolyline(g: PIXI.Graphics, path: { x: number; y: number }[]): void {
  g.moveTo(path[0].x, path[0].y);
  for (let i = 1; i < path.length; i++) g.lineTo(path[i].x, path[i].y);
}

/** Draw `path` as alternating on/off dashes with a current offset so
 *  successive calls with larger offsets visually march the dashes along
 *  the polyline. We walk the path segment by segment, tracking a phase
 *  inside [0..period). */
function drawDashedPolyline(
  g: PIXI.Graphics,
  path: { x: number; y: number }[],
  dashOn: number,
  dashOff: number,
  offset: number
): void {
  const period = dashOn + dashOff;
  let phase = ((offset % period) + period) % period;
  let isOn = phase < dashOn;
  let remaining = isOn ? dashOn - phase : period - phase; // time until next flip
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (segLen === 0) continue;
    const ux = (b.x - a.x) / segLen;
    const uy = (b.y - a.y) / segLen;
    let cursor = 0;
    let px = a.x;
    let py = a.y;
    while (cursor < segLen) {
      const take = Math.min(remaining, segLen - cursor);
      const nx = px + ux * take;
      const ny = py + uy * take;
      if (isOn) {
        g.moveTo(px, py);
        g.lineTo(nx, ny);
      }
      px = nx;
      py = ny;
      cursor += take;
      remaining -= take;
      if (remaining <= 0) {
        isOn = !isOn;
        remaining = isOn ? dashOn : dashOff;
      }
    }
  }
}

function drawArrowHead(
  g: PIXI.Graphics,
  path: { x: number; y: number }[],
  thickness: number,
  strokeSize: number,
  color: number,
  alpha: number
): void {
  if (path.length < 2) return;
  const last = path[path.length - 1];
  const prev = path[path.length - 2];
  const angle = Math.atan2(last.y - prev.y, last.x - prev.x);
  const arrowSize = Math.max(thickness * 3, 10);
  // Ensure the *rear* edge of the arrow starts after the visible line cap.
  const visibleLineHalf = thickness * 0.5 + strokeSize;
  const rearOffset = visibleLineHalf + Math.max(1, thickness * 0.15);
  const tipOffset = rearOffset + arrowSize * Math.cos(0.4);
  const tipX = last.x + Math.cos(angle) * tipOffset;
  const tipY = last.y + Math.sin(angle) * tipOffset;
  g.beginFill(color, alpha);
  g.lineStyle(0);
  g.drawPolygon([
    tipX,
    tipY,
    tipX - arrowSize * Math.cos(angle - 0.4),
    tipY - arrowSize * Math.sin(angle - 0.4),
    tipX - arrowSize * Math.cos(angle + 0.4),
    tipY - arrowSize * Math.sin(angle + 0.4),
  ]);
  g.endFill();
}

function resolveTransportIconSize(size: number | undefined): number {
  if (!Number.isFinite(size)) return ROUTE_ICON_SIZE_DEFAULT;
  const rounded = Math.round(size as number);
  return Math.max(ROUTE_ICON_SIZE_MIN, Math.min(ROUTE_ICON_SIZE_MAX, rounded));
}

function resolveIconLiftNormal(angle: number): { x: number; y: number } {
  const n1 = { x: Math.sin(angle), y: -Math.cos(angle) };
  const n2 = { x: -n1.x, y: -n1.y };
  const dy = Math.abs(n1.y - n2.y);
  if (dy < 0.001) {
    // Vertical-ish segment: keep deterministic side to avoid jitter.
    return Math.sin(angle) >= 0 ? n1 : n2;
  }
  return n1.y < n2.y ? n1 : n2;
}
