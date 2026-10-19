import { Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/providers/authContext';
import { paths } from '@/paths';
import { PendingNavigate } from './PendingNavigate';

/**
 * Utloggad → /login?next=<path> (ADR 006 beslut 1). /login är Landing med inloggningsdialogen öppen (RUN-145): efter inloggning går man vidare
 * till `next`. Gäller både en direktlänk till en skyddad sida och ett 401 mitt i sessionen. Medveten utloggning (AvatarMenu) hamnar inte här: den
 * går till / utan dialog och utan `next`.
 */
export function RequireAuth() {
  const { user } = useAuth();
  const location = useLocation();

  if (!user) {
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return <PendingNavigate to={`${paths.login}?next=${next}`} />;
  }
  return <Outlet />;
}
