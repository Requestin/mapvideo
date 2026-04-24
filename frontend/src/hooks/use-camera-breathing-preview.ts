import { useEffect } from 'react';
import type { MutableRefObject } from 'react';
import type { Map } from 'maplibre-gl';
import { computeBreathingZoom } from '../utils/camera-breathing';

export function useCameraBreathingPreview(
  mapRef: MutableRefObject<Map | null>,
  strength: number,
  referenceZoom: number | null
): void {
  useEffect(() => {
    if (strength <= 0 || referenceZoom == null) return;
    let raf = 0;
    const tick = (): void => {
      const map = mapRef.current;
      if (!map) return;
      try {
        const nextZoom = computeBreathingZoom(referenceZoom, strength, performance.now() / 1000);
        map.setZoom(nextZoom);
      } catch {
        // Map may be disposed between frames.
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [mapRef, referenceZoom, strength]);
}
