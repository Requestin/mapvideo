import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './components/protected-route';
import { AdminRoute } from './components/admin-route';
import { ErrorBoundary } from './components/error-boundary';
import { LoginPage } from './pages/login-page';
import { EditorPage } from './pages/editor-page';
import { AdminPage } from './pages/admin-page';
import { RenderPage } from './pages/render-page';
import { RenderPageV2 } from './pages/render-page-v2';
import { GeoTitleRenderPage } from './pages/geo-title-render-page';

export function App(): JSX.Element {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        {/* task8: Puppeteer + внутренний render_token — без общей оболочки логина */}
        <Route path="/render-page" element={<RenderPage />} />
        <Route path="/render-page-v2" element={<RenderPageV2 />} />
        <Route path="/geo-title-render-page" element={<GeoTitleRenderPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<EditorPage />} />
          <Route element={<AdminRoute />}>
            <Route path="/admin" element={<AdminPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}
