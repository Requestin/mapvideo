import * as PIXI from 'pixi.js';
import { renderLabelText, type LabelSettings } from '../state/types';
import { hexToPixiColor, percentToAlpha } from './animations/colors';

export interface LabelRender {
  container: PIXI.Container;
  /** Axis-aligned bounding box in local coordinates (centered at 0,0),
   *  used by the drag controller for hit-testing. */
  hitHalfWidth: number;
  hitHalfHeight: number;
  dispose(): void;
}

export function createLabel(rawText: string, settings: LabelSettings): LabelRender {
  const container = new PIXI.Container();

  const text = renderLabelText(rawText, settings);
  const style = new PIXI.TextStyle({
    fontFamily: settings.fontFamily || 'Montserrat',
    // PIXI понимает числовой `fontWeight` как строку `'400'`/`'700'` и т.д.;
    // значение должно совпадать с одним из `@font-face { font-weight }`,
    // иначе браузер подставит Regular-400 по умолчанию.
    fontWeight: String(settings.fontWeight ?? 400) as PIXI.TextStyleFontWeight,
    fontSize: settings.fontSize,
    fill: hexToPixiColor(settings.color),
    stroke: settings.stroke.enabled ? hexToPixiColor(settings.stroke.color) : undefined,
    strokeThickness: settings.stroke.enabled ? settings.stroke.size : 0,
    // Pixi's `fillGradientStops` can't alpha per-character; use container
    // alpha instead — matches the intent of the opacity slider.
    align: 'center',
  });
  // `PIXI.Text` always uses the document's live font registry; we call
  // `loadAppFonts()` on editor bootstrap so the family is already resolved
  // by the time we land here.
  const pixiText = new PIXI.Text(text, style);
  pixiText.anchor.set(0.5);
  container.addChild(pixiText);
  container.alpha = percentToAlpha(settings.opacity);

  // Stroke alpha deviates from fill alpha when the opacity slider is <100;
  // ideally we'd composite each channel separately but Pixi's TextStyle only
  // exposes a scalar strokeThickness, so we approximate by darkening stroke
  // alpha proportionally to the slider. Good enough for 0..100 range.
  if (settings.stroke.enabled) {
    const strokeAlpha =
      percentToAlpha(settings.opacity) * percentToAlpha(settings.stroke.opacity);
    // Pixi renders stroke via fillText with stroke, so container alpha
    // multiplies both fill and stroke. Adjust the stroke colour's alpha
    // by baking it into the stroke hex via a premultiplied renderer trick
    // is overkill — we accept that stroke opacity approximates here.
    container.alpha = strokeAlpha + (percentToAlpha(settings.opacity) - strokeAlpha) * 0.5;
  }

  const halfW = pixiText.width / 2;
  const halfH = pixiText.height / 2;

  return {
    container,
    hitHalfWidth: halfW,
    hitHalfHeight: halfH,
    dispose(): void {
      container.destroy({ children: true });
    },
  };
}
