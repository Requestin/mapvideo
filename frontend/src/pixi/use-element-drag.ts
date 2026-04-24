import { useEffect } from 'react';
import { useEditorMap } from '../hooks/use-editor-map';
import { useEditorState } from '../state/editor-state';
import type { HitRegistry, HitTarget } from './pixi-layer';

// Runs side-by-side with <PixiLayer>. Listens for `mousedown` on the MapLibre
// canvas; if the pointer lands on a point/label hitbox, we:
//   • prevent MapLibre's default drag-pan;
//   • track `mousemove` on the map until `mouseup`;
//   • project pointer pixels back to lng/lat and push through moveElement.
// If the pointer lands on empty space we leave the event alone so panning
// still works. Double-click selection is handled inline at the top of the
// handler because `click` fires for both drag-ends and real clicks.
export function useElementDrag(hitRegistry: HitRegistry): void {
  const { mapRef, pixelsToCoordinates } = useEditorMap();
  const { moveElement, selectElement, invalidateRouteOsrmForPoint } = useEditorState();

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // A separate `mousedown` subscription tracks the start of each drag.
    // MapLibre gives us the map-relative pixel in `e.point`, so no manual
    // rect math is needed here.
    const onDown = (e: import('maplibre-gl').MapMouseEvent) => {
      const hit = pickTarget(hitRegistry.targets, e.point.x, e.point.y);
      if (!hit) return;
      // Suppress MapLibre's drag-pan for the duration of this gesture.
      e.preventDefault();
      map.dragPan.disable();
      let moved = false;

      let raf = 0;
      const onMove = (mv: import('maplibre-gl').MapMouseEvent) => {
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          const c = pixelsToCoordinates(mv.point.x, mv.point.y);
          if (!c) return;
          moveElement(hit.id, c);
          moved = true;
        });
      };
      const onUp = () => {
        map.dragPan.enable();
        map.off('mousemove', onMove);
        map.off('mouseup', onUp);
        if (raf) cancelAnimationFrame(raf);
        if (moved) invalidateRouteOsrmForPoint(hit.id);
        selectElement(hit.id);
      };
      map.on('mousemove', onMove);
      map.on('mouseup', onUp);
    };

    map.on('mousedown', onDown);

    // Double-click on an element opens the right panel (already driven by
    // `selectElement`). Guard against maplibre's default "zoom to point" on
    // dblclick over a hit.
    const onDblClick = (e: import('maplibre-gl').MapMouseEvent) => {
      const hit = pickTarget(hitRegistry.targets, e.point.x, e.point.y);
      if (!hit) return;
      e.preventDefault();
      selectElement(hit.id);
    };
    map.on('dblclick', onDblClick);

    return () => {
      map.off('mousedown', onDown);
      map.off('dblclick', onDblClick);
    };
  }, [mapRef, pixelsToCoordinates, moveElement, selectElement, invalidateRouteOsrmForPoint, hitRegistry]);
}

function pickTarget(targets: HitTarget[], x: number, y: number): HitTarget | null {
  // Walk in reverse so topmost (last-added) element wins — matches Pixi's
  // render order and user expectations.
  for (let i = targets.length - 1; i >= 0; i--) {
    const t = targets[i];
    if (t.hit.shape === 'circle') {
      const dx = x - t.x;
      const dy = y - t.y;
      if (dx * dx + dy * dy <= t.hit.radius * t.hit.radius) return t;
    } else if (t.hit.shape === 'rect') {
      if (
        x >= t.x - t.hit.halfW &&
        x <= t.x + t.hit.halfW &&
        y >= t.y - t.hit.halfH &&
        y <= t.y + t.hit.halfH
      )
        return t;
    }
    // polyline (routes): drag on a line isn't in v1 SPEC.
  }
  return null;
}

export { pickTarget as __pickTargetForTests };
