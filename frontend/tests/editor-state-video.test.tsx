import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { EditorStateProvider, useEditorState } from '../src/state/editor-state';
import { DEFAULT_VIDEO_SETTINGS, LOCKED_VIDEO_RESOLUTION } from '../src/state/types';
import type { ReactNode } from 'react';

const wrapper = ({ children }: { children: ReactNode }) => (
  <EditorStateProvider>{children}</EditorStateProvider>
);

describe('editor-state — video settings (task7)', () => {
  it('setTheme syncs videoSettings.theme', () => {
    const { result } = renderHook(() => useEditorState(), { wrapper });
    act(() => result.current.setTheme('light'));
    expect(result.current.theme).toBe('light');
    expect(result.current.videoSettings.theme).toBe('light');
    act(() => result.current.setTheme('dark'));
    expect(result.current.videoSettings.theme).toBe('dark');
  });

  it('applyMapThemePreview changes map theme without committing videoSettings', () => {
    const { result } = renderHook(() => useEditorState(), { wrapper });
    act(() => result.current.setTheme('light'));
    act(() => result.current.applyMapThemePreview('dark'));
    expect(result.current.theme).toBe('dark');
    expect(result.current.videoSettings.theme).toBe('light');
  });

  it('commitVideoSettings replaces the payload and the live theme', () => {
    const { result } = renderHook(() => useEditorState(), { wrapper });
    const next = {
      ...DEFAULT_VIDEO_SETTINGS,
      resolution: '3840x2160' as const,
      fps: 50 as const,
      duration: 20,
      theme: 'light' as const,
    };
    act(() => result.current.commitVideoSettings(next));
    expect(result.current.videoSettings).toEqual({
      ...next,
      resolution: LOCKED_VIDEO_RESOLUTION,
    });
    expect(result.current.theme).toBe('light');
  });
});
