import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

// MapLibre and PixiJS both need a real WebGL context; jsdom has none, so
// we mock them out with minimal shims that record invocations. The
// EditorPage smoke-test only cares about chrome rendering + theme toggle
// behaviour, not about pixel output.
vi.mock('maplibre-gl', async () => {
  const mapInstance = {
    flyTo: vi.fn(),
    fitBounds: vi.fn(),
    setStyle: vi.fn(),
    isStyleLoaded: () => true,
    once: vi.fn(),
    resize: vi.fn(),
    remove: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    setZoom: vi.fn(),
    project: () => ({ x: 0, y: 0 }),
    unproject: () => ({ lng: 0, lat: 0 }),
    getCenter: () => ({ lng: 37.5, lat: 55.7 }),
    getBearing: () => 0,
    getPitch: () => 0,
    easeTo: vi.fn(),
    // task10: zoom-dependent scale + isElementInView + getCanvasContainer
    // (used by use-element-hover). Minimal stubs — tests assert only chrome.
    getZoom: () => 4,
    getBounds: () => ({ contains: () => true }),
    getCanvasContainer: () => {
      const el = document.createElement('div');
      return el;
    },
    dragPan: { enable: vi.fn(), disable: vi.fn() },
  };
  return {
    default: {
      Map: vi.fn().mockImplementation(() => mapInstance),
    },
    Map: vi.fn(),
  };
});

vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}));

// Minimal PixiJS stand-ins: Containers expose the methods PixiLayer calls
// (addChild, removeChild, destroy, position.set, scale.set, sortableChildren).
// We never actually render — just reconciliation is exercised.
vi.mock('pixi.js', () => {
  class FakeContainer {
    children: unknown[] = [];
    position = { set: vi.fn() };
    scale = { set: vi.fn() };
    zIndex = 0;
    alpha = 1;
    sortableChildren = false;
    anchor = { set: vi.fn() };
    width = 40;
    height = 16;
    addChild(c: unknown): void {
      this.children.push(c);
    }
    removeChild(c: unknown): void {
      this.children = this.children.filter((x) => x !== c);
    }
    destroy(): void {}
    stop(): void {}
    play(): void {}
    lineStyle(): FakeContainer {
      return this;
    }
    beginFill(): FakeContainer {
      return this;
    }
    drawCircle(): FakeContainer {
      return this;
    }
    endFill(): FakeContainer {
      return this;
    }
  }
  const view = document.createElement('canvas');
  const stage = new FakeContainer();
  return {
    Application: vi.fn().mockImplementation(() => ({
      view,
      renderer: { resize: vi.fn() },
      destroy: vi.fn(),
      stage,
    })),
    Container: FakeContainer,
    Graphics: FakeContainer,
    Sprite: { from: () => new FakeContainer() },
    AnimatedSprite: FakeContainer,
    Text: FakeContainer,
    TextStyle: FakeContainer,
    Texture: { from: () => ({}) },
  };
});

// gsap returns a minimal chainable timeline so animation creators can link
// fromTo()/kill() without breaking. Tests never assert on animation state.
vi.mock('gsap', () => {
  const tw = { kill: vi.fn() };
  const tl = {
    fromTo: vi.fn().mockReturnThis(),
    kill: vi.fn(),
  };
  return {
    default: {
      timeline: vi.fn(() => tl),
      to: vi.fn(() => tw),
    },
    timeline: vi.fn(() => tl),
    to: vi.fn(() => tw),
  };
});

// Skip the fonts + geocode network calls; they are tested independently.
vi.mock('../src/services/fonts', () => ({
  loadAppFonts: vi.fn().mockResolvedValue([]),
}));
vi.mock('../src/api/fonts', () => ({
  fetchFonts: vi.fn().mockResolvedValue([]),
}));
vi.mock('../src/api/geocode', () => ({
  geocodeSearch: vi.fn().mockResolvedValue([]),
}));
// task14: UserColorsProvider триггерит GET на старте редактора — в jsdom
// без backend'а это шумит ECONNREFUSED. Моком возвращаем пустой список,
// чтобы логи оставались чистыми.
vi.mock('../src/api/user-colors', () => ({
  getMyColors: vi.fn().mockResolvedValue([]),
  saveMyColors: vi.fn().mockResolvedValue([]),
}));
vi.mock('../src/api/render', () => ({
  getActiveRender: vi.fn().mockResolvedValue({ active: null }),
  getRenderStatus: vi.fn(),
  postRender: vi.fn(),
}));

// jsdom lacks ResizeObserver; stub it globally for EditorMap.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub;

import { EditorPage } from '../src/pages/editor-page';
import { AuthProvider } from '../src/hooks/use-auth';
import { ToastProvider } from '../src/components/toast-provider';
import * as authApi from '../src/api/auth';

function renderPage(): void {
  vi.spyOn(authApi, 'ensureCsrfCookie').mockResolvedValue();
  vi.spyOn(authApi, 'fetchMe').mockResolvedValue({ id: 'u1', username: 'admin', role: 'admin' });
  render(
    <MemoryRouter>
      <AuthProvider>
        <ToastProvider>
          <EditorPage />
        </ToastProvider>
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('EditorPage', () => {
  it('renders header, toolbar and empty elements list', () => {
    renderPage();
    expect(screen.getByRole('link', { name: 'Mapvideo' })).toBeInTheDocument();
    expect(screen.getByLabelText('Элементы на карте')).toBeInTheDocument();
    expect(screen.getByLabelText('Сбросить положение карты')).toBeInTheDocument();
    // "+ Точка" is now live (opens the modal). Route button stays off
    // until there are 2+ points.
    expect(screen.getByRole('button', { name: /точка/i })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /маршрут/i })).toBeDisabled();
  });

  it('opens and closes the Add Point modal', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /точка/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Добавить точку')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /отмена/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('theme toggle switches label between Тёмная and Светлая', async () => {
    renderPage();
    const user = userEvent.setup();
    const toggle = screen.getByRole('button', { name: /тёмная/i });
    await user.click(toggle);
    expect(screen.getByRole('button', { name: /светлая/i })).toBeInTheDocument();
  });

  it('opens video settings modal from toolbar (task7)', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /видео/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Настройки видео')).toBeInTheDocument();
    expect(screen.getByText(/контейнер/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/3840×2160/i)).toBeDisabled();
    expect(screen.getByLabelText(/30p/i)).toBeDisabled();
    expect(screen.getByLabelText(/60p/i)).toBeDisabled();
    expect(screen.getByLabelText(/mxf/i)).toBeDisabled();
  });
});
