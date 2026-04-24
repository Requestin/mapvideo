import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../hooks/use-auth';

export function AdminRoute(): JSX.Element {
  const { user } = useAuth();
  // ProtectedRoute already ran → user is present. Non-admins bounce to /.
  if (!user || user.role !== 'admin') return <Navigate to="/" replace />;
  return <Outlet />;
}
