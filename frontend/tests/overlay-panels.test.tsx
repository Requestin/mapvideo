import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useEffect, useState, type ReactNode } from 'react';
import { EditorStateProvider, useEditorState } from '../src/state/editor-state';
import { ElementsList } from '../src/components/elements-list';
import { RightSidebar } from '../src/components/right-sidebar';
import type { EditorMapHandle } from '../src/hooks/use-editor-map';

// === task12 regression: side panels are overlays, not fixed columns ===
//
// These tests don't need a real MapLibre/Pixi/GSAP setup — they only
// assert on React-tree decisions (render vs null, attribute toggling).
// We still need to mock the map handle that ElementsList reads from
// `useEditorMap`, because the list's click behaviour calls
// isElementInView / resetView.

vi.mock('../src/hooks/use-editor-map', () => ({
  useEditorMap: (): Partial<EditorMapHandle> => ({
    mapRef: { current: null } as EditorMapHandle['mapRef'],
    pixiRef: { current: null } as EditorMapHandle['pixiRef'],
    attachMap: vi.fn(),
    attachPixi: vi.fn(),
    resetView: vi.fn(),
    coordinatesToPixels: () => null,
    pixelsToCoordinates: () => null,
    isElementInView: () => true,
    requestFlash: vi.fn(),
    onFlash: () => () => undefined,
  }),
}));

function Host({ children }: { children: ReactNode }): JSX.Element {
  return <EditorStateProvider>{children}</EditorStateProvider>;
}

// Helper: seed a point, then render children so they can read the state.
function Seeder(): null {
  const { addPoint, elements } = useEditorState();
  useEffect(() => {
    if (elements.length === 0) {
      addPoint({ label: 'Moscow', coordinates: { lng: 37.6, lat: 55.7 } });
    }
  }, [addPoint, elements.length]);
  return null;
}

describe('RightSidebar — overlay behaviour (task12)', () => {
  it('renders nothing when no element is selected', () => {
    render(
      <Host>
        <Seeder />
        <RightSidebar />
      </Host>
    );
    expect(screen.queryByLabelText('Настройки элемента')).toBeNull();
  });

  it('renders the panel only after selectElement(id) lands', () => {
    function Controller(): JSX.Element {
      const { elements, selectElement, selectedElementId } = useEditorState();
      const point = elements.find((e) => e.kind === 'point');
      return (
        <div>
          <button
            type="button"
            onClick={() => point && selectElement(point.id)}
            data-testid="select"
          >
            select
          </button>
          <div data-testid="sel">{selectedElementId ?? 'none'}</div>
        </div>
      );
    }
    render(
      <Host>
        <Seeder />
        <Controller />
        <RightSidebar />
      </Host>
    );
    expect(screen.queryByLabelText('Настройки элемента')).toBeNull();
    fireEvent.click(screen.getByTestId('select'));
    expect(screen.getByLabelText('Настройки элемента')).toBeInTheDocument();
  });
});

describe('ElementsList — dropdown behaviour (task12)', () => {
  function WithOpenState(): JSX.Element {
    const [open, setOpen] = useState(false);
    return <ElementsList open={open} onToggle={() => setOpen((v) => !v)} />;
  }

  it('keeps the trigger visible at all times, body hidden when closed', () => {
    render(
      <Host>
        <Seeder />
        <WithOpenState />
      </Host>
    );
    // Trigger is always present.
    const trigger = screen.getByRole('button', { name: /элементы/i });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    // Items list is not rendered while collapsed.
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('expands and collapses on trigger click', () => {
    render(
      <Host>
        <Seeder />
        <WithOpenState />
      </Host>
    );
    const trigger = screen.getByRole('button', { name: /элементы/i });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('list')).toBeInTheDocument();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('shows the count badge once at least one element exists', () => {
    render(
      <Host>
        <Seeder />
        <WithOpenState />
      </Host>
    );
    // Seeder adds 1 point + 1 paired label = 2 elements total. The badge
    // reflects the full elements[] length, matching what the user sees
    // in the dropdown body.
    const trigger = screen.getByRole('button', { name: /элементы/i });
    expect(trigger).toHaveTextContent('2');
  });
});
