import { useEffect } from 'react';
import { useEditorMap } from '../hooks/use-editor-map';
import { useEditorState } from '../state/editor-state';
import type { HitRegistry, HitTarget } from './pixi-layer';

// Mirror of `use-element-drag` but for `mousemove`. Sets the hovered
// element id in editor state when the pointer is over a hitbox; clears
// it when the pointer leaves the canvas or hovers empty space.
//
// We deliberately do NOT use `map.on('mouseenter', layer)` — that API
// is layer-scoped (vector tile layers), but our elements live on the
// Pixi overlay, not in a MapLibre layer. A plain `mousemove` subscription
// on the map handles both "enter" and "leave" cases via the hit-registry.
export function useElementHover(hitRegistry: HitRegistry): void {
  const { mapRef } = useEditorMap();
  const { setHoveredElement } = useEditorState();

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const canvas = map.getCanvasContainer();

    const onMove = (e: import('maplibre-gl').MapMouseEvent) => {
      const hit = pickTarget(hitRegistry.targets, e.point.x, e.point.y);
      setHoveredElement(hit ? hit.id : null);
      // Pointer-cursor feedback is handy but cheap — only touch the DOM
      // style if the state actually changed.
      const wantGrab = hit !== null;
      if (wantGrab && canvas.style.cursor !== 'pointer') canvas.style.cursor = 'pointer';
      else if (!wantGrab && canvas.style.cursor === 'pointer') canvas.style.cursor = '';
    };

    const onLeave = () => {
      setHoveredElement(null);
      if (canvas.style.cursor === 'pointer') canvas.style.cursor = '';
    };

    map.on('mousemove', onMove);
    map.on('mouseout', onLeave);
    return () => {
      map.off('mousemove', onMove);
      map.off('mouseout', onLeave);
    };
  }, [mapRef, hitRegistry, setHoveredElement]);
}

// Same routine as in `use-element-drag`; kept inline to avoid tight coupling
// between the two hooks (tests cover each separately).
function pickTarget(targets: HitTarget[], x: number, y: number): HitTarget | null {
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
    // polyline (routes): hover-to-highlight on the canvas isn't specced in v1.
  }
  return null;
}
