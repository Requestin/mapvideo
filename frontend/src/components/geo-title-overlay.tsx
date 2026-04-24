import { useMemo } from 'react';
import type { GeoTitleSettings } from '../state/types';
import { computeGeoTitleLayout } from '../utils/geo-title-layout';
import './geo-title-overlay.css';

export interface GeoTitleOverlayProps {
  geoTitle: GeoTitleSettings;
  frameWidth: number;
  frameHeight: number;
  animated?: boolean;
  timeSec?: number;
}

export function GeoTitleOverlay({
  geoTitle,
  frameWidth,
  frameHeight,
  animated = false,
  timeSec = 0,
}: GeoTitleOverlayProps): JSX.Element | null {
  const layout = useMemo(
    () =>
      computeGeoTitleLayout({
        frameWidth,
        frameHeight,
        geoTitle,
        animated,
        timeSec,
      }),
    [animated, frameHeight, frameWidth, geoTitle, timeSec]
  );

  if (!layout.visible) return null;

  return (
    <div
      className="geo-title-overlay"
      style={{
        left: `${layout.leftPx}px`,
        bottom: `${layout.bottomPx}px`,
        width: `${layout.plateWidthPx}px`,
        height: `${layout.plateHeightPx}px`,
        transform: `translateX(${layout.translateXPx}px)`,
      }}
      aria-hidden
    >
      <div
        className="geo-title-overlay__tail"
        style={{ width: `${layout.tailWidthPx}px` }}
      />
      <div
        className="geo-title-overlay__body"
        style={{
          width: `${layout.bodyWidthPx}px`,
          paddingLeft: `${layout.textPaddingPx}px`,
          paddingRight: `${layout.textPaddingPx}px`,
        }}
      >
        <span
          className="geo-title-overlay__text"
          style={{
            fontFamily: `"${geoTitle.fontFamily}", sans-serif`,
            fontWeight: geoTitle.fontWeight,
            fontSize: `${layout.fontSizePx}px`,
          }}
          title={layout.text}
        >
          {layout.text}
        </span>
      </div>
    </div>
  );
}
