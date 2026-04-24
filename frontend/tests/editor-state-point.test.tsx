import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { EditorStateProvider, useEditorState } from '../src/state/editor-state';
import type { ReactNode } from 'react';

const wrapper = ({ children }: { children: ReactNode }) => (
  <EditorStateProvider>{children}</EditorStateProvider>
);

describe('editor-state — points & labels', () => {
  it('addPoint inserts a MapPoint plus a paired MapLabel', () => {
    const { result } = renderHook(() => useEditorState(), { wrapper });

    let id = '';
    act(() => {
      id = result.current.addPoint({
        label: 'Moscow',
        coordinates: { lng: 37.618, lat: 55.751 },
      });
    });

    expect(result.current.elements).toHaveLength(2);
    const point = result.current.elements.find((e) => e.id === id);
    const label = result.current.elements.find((e) => e.kind === 'label');
    expect(point?.kind).toBe('point');
    expect(label?.kind).toBe('label');
    if (label?.kind === 'label') {
      expect(label.pointId).toBe(id);
    }
    if (point?.kind === 'point') {
      expect(point.coordinates).toEqual({ lng: 37.618, lat: 55.751 });
      expect(point.originCoordinates).toEqual({ lng: 37.618, lat: 55.751 });
    }
  });

  it('removing a point cascades to its label', () => {
    const { result } = renderHook(() => useEditorState(), { wrapper });
    let id = '';
    act(() => {
      id = result.current.addPoint({
        label: 'A',
        coordinates: { lng: 0, lat: 0 },
      });
    });
    expect(result.current.elements).toHaveLength(2);
    act(() => result.current.removeElement(id));
    expect(result.current.elements).toHaveLength(0);
  });

  it('moveElement updates coordinates on points and labels', () => {
    const { result } = renderHook(() => useEditorState(), { wrapper });
    let id = '';
    act(() => {
      id = result.current.addPoint({ label: 'A', coordinates: { lng: 10, lat: 20 } });
    });
    act(() => result.current.moveElement(id, { lng: 15, lat: 25 }));
    const point = result.current.elements.find((e) => e.id === id);
    expect(point?.kind === 'point' && point.coordinates).toEqual({ lng: 15, lat: 25 });
    // Origin is preserved — resetPointLocation uses it.
    expect(point?.kind === 'point' && point.originCoordinates).toEqual({
      lng: 10,
      lat: 20,
    });
  });

  it('resetPointLocation brings the point back to its birth coordinates', () => {
    const { result } = renderHook(() => useEditorState(), { wrapper });
    let id = '';
    act(() => {
      id = result.current.addPoint({ label: 'A', coordinates: { lng: 1, lat: 2 } });
    });
    act(() => result.current.moveElement(id, { lng: 50, lat: 50 }));
    act(() => result.current.resetPointLocation(id));
    const point = result.current.elements.find((e) => e.id === id);
    expect(point?.kind === 'point' && point.coordinates).toEqual({ lng: 1, lat: 2 });
  });

  it('changePointAnimation swaps settings to defaults for the new kind', () => {
    const { result } = renderHook(() => useEditorState(), { wrapper });
    let id = '';
    act(() => {
      id = result.current.addPoint({ label: 'A', coordinates: { lng: 0, lat: 0 } });
    });
    // blinking → fire
    act(() => result.current.changePointAnimation(id, 'fire'));
    const point = result.current.elements.find((e) => e.id === id);
    expect(point?.kind === 'point' && point.settings.kind).toBe('fire');
  });

  it('setHoveredElement no-ops when the id is already current', () => {
    // Sanity — we rely on this equality guard in `use-element-hover`,
    // where mousemove fires 60×/s and setState churn would re-render
    // ElementsList on every pixel otherwise.
    const { result } = renderHook(() => useEditorState(), { wrapper });
    let before: unknown;
    act(() => {
      result.current.addPoint({ label: 'A', coordinates: { lng: 0, lat: 0 } });
    });
    act(() => result.current.setHoveredElement('no-such-id'));
    before = result.current;
    act(() => result.current.setHoveredElement('no-such-id'));
    // Context value object is memoised — if setState updates with an equal
    // value React still bails out → reference equality holds.
    expect(result.current).toBe(before);
  });

  it('removing the hovered element clears hoveredElementId', () => {
    const { result } = renderHook(() => useEditorState(), { wrapper });
    let id = '';
    act(() => {
      id = result.current.addPoint({ label: 'A', coordinates: { lng: 0, lat: 0 } });
    });
    act(() => result.current.setHoveredElement(id));
    expect(result.current.hoveredElementId).toBe(id);
    act(() => result.current.removeElement(id));
    expect(result.current.hoveredElementId).toBeNull();
  });

  it('updateLabelSettings merges stroke patches atomically', () => {
    const { result } = renderHook(() => useEditorState(), { wrapper });
    act(() => {
      result.current.addPoint({ label: 'A', coordinates: { lng: 0, lat: 0 } });
    });
    const label = result.current.elements.find((e) => e.kind === 'label')!;
    act(() =>
      result.current.updateLabelSettings(label.id, {
        stroke: { enabled: false } as never,
      })
    );
    const after = result.current.elements.find((e) => e.id === label.id);
    expect(
      after?.kind === 'label' &&
        after.settings.stroke.enabled === false &&
        typeof after.settings.stroke.size === 'number'
    ).toBe(true);
  });
});
