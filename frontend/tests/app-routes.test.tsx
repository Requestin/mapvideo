import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet } from 'react-router-dom';
import type { ReactNode } from 'react';

vi.mock('../src/pages/login-page', () => ({
  LoginPage: () => <div>Login Page</div>,
}));
vi.mock('../src/pages/editor-page', () => ({
  EditorPage: () => <div>Editor Page</div>,
}));
vi.mock('../src/pages/admin-page', () => ({
  AdminPage: () => <div>Admin Page</div>,
}));
vi.mock('../src/pages/render-page', () => ({
  RenderPage: () => <div>Render Page V1</div>,
}));
vi.mock('../src/pages/render-page-v2', () => ({
  RenderPageV2: () => <div>Render Page V2</div>,
}));
vi.mock('../src/pages/geo-title-render-page', () => ({
  GeoTitleRenderPage: () => <div>Geo Title Render Page</div>,
}));
vi.mock('../src/components/error-boundary', () => ({
  ErrorBoundary: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('../src/components/protected-route', () => ({
  ProtectedRoute: () => <Outlet />,
}));
vi.mock('../src/components/admin-route', () => ({
  AdminRoute: () => <Outlet />,
}));

import { App } from '../src/App';

describe('App routes', () => {
  it('mounts /render-page-v2 route', () => {
    render(
      <MemoryRouter initialEntries={['/render-page-v2']}>
        <App />
      </MemoryRouter>
    );
    expect(screen.getByText('Render Page V2')).toBeInTheDocument();
  });
});
