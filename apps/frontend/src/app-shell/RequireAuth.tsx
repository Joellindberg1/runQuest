import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/providers/authContext';
import { paths } from '@/paths';

/** Utloggad → /login?next=<path> (ADR 006 beslut 1). */
export function RequireAuth() {
  const { user } = useAuth();
  const location = useLocation();

  if (!user) {
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`${paths.login}?next=${next}`} replace />;
  }
  return <Outlet />;
}
