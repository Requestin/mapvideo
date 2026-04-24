import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/use-auth';
import { FullScreenSpinner } from './full-screen-spinner';

export function ProtectedRoute(): JSX.Element {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <FullScreenSpinner />;
  if (!user) {
    // Preserve intended destination so /login can redirect back after auth.
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}
