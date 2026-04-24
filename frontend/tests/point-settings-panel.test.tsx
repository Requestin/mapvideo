import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { PointSettingsPanel } from '../src/components/right-sidebar/point-settings-panel';
import { EditorStateProvider, useEditorState } from '../src/state/editor-state';
import type { MapPoint } from '../src/state/types';

// Regression test for the "sliders can't be dragged" bug.
//
// Cause: inside PointSettingsPanel's body we used to declare the
// `BlinkingControls` / `ExplosionControls` / etc. sub-components. Every
// parent render produced a fresh function identity, and React's reconciler
// diffs children by `type ===` — so the entire sub-tree remounted on each
// `updatePointSettings` fired during a drag. The <input type="range">
// that the browser had captured for the drag was unmounted → the mouseup
// went nowhere, and the user perceived "clicking works, dragging doesn't".
//
// Fix: hoist all *Controls to module scope. This test locks in the fix by
// verifying the same <input> DOM node survives an onChange round-trip.

// Seeds the editor store with one blinking point and renders the panel
// against that point. The seed fires in a single `useEffect` pass — after
// that, the panel is driven by real state, so subsequent updates go
// through `updatePointSettings` and exercise the same code paths as the
// production UI.
function SeederWithPanel(): JSX.Element | null {
  const { addPoint, elements } = useEditorState();
  useEffect(() => {
    if (elements.length === 0) {
      addPoint({ label: 'Moscow', coordinates: { lng: 37.6, lat: 55.7 } });
    }
  }, [addPoint, elements.length]);
  const point = elements.find((e): e is MapPoint => e.kind === 'point') ?? null;
  if (!point) return null;
  return <PointSettingsPanel point={point} />;
}

function Host({ children }: { children: ReactNode }): JSX.Element {
  return <EditorStateProvider>{children}</EditorStateProvider>;
}

describe('PointSettingsPanel — slider stability', () => {
  it('reuses the same <input type="range"> DOM node after onChange', () => {
    const { container } = render(
      <Host>
        <SeederWithPanel />
      </Host>
    );

    const before = container.querySelector(
      'input#field-Размер[type="range"]'
    ) as HTMLInputElement | null;
    expect(before).not.toBeNull();
    const anchor = before as HTMLInputElement;

    fireEvent.change(anchor, { target: { value: '24' } });

    const after = container.querySelector(
      'input#field-Размер[type="range"]'
    ) as HTMLInputElement | null;
    expect(after).toBeTruthy();
    // The SAME DOM node must be reused — otherwise the browser's mouse
    // capture is lost mid-drag and the slider "can only be clicked".
    expect(after).toBe(anchor);
  });

  it('applies a burst of onChange events to the same node (drag simulation)', () => {
    // A real mouse drag fires many `input` events. Each must land on the
    // same DOM node — regression check against re-mounting the sub-tree
    // inside PointSettingsPanel's body.
    const { container } = render(
      <Host>
        <SeederWithPanel />
      </Host>
    );

    const slider = container.querySelector(
      'input#field-Размер[type="range"]'
    ) as HTMLInputElement | null;
    expect(slider).not.toBeNull();
    const anchor = slider as HTMLInputElement;

    for (const v of [12, 18, 22, 26, 30]) {
      fireEvent.change(anchor, { target: { value: String(v) } });
      const again = container.querySelector(
        'input#field-Размер[type="range"]'
      ) as HTMLInputElement | null;
      expect(again).toBe(anchor);
    }
  });
});
