import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/providers/authContext';
import { resolveLegacyRedirect } from '@/app-shell/legacyRedirects';
import { resolveNextPath } from '@/app-shell/safeNext';
import { LoginDialog } from '@/features/auth/components/LoginDialog';
import LandingPage from './LandingPage';

interface IndexProps {
  /** `/login`: samma sida som `/`, med inloggningsdialogen öppen. */
  loginOpen?: boolean;
}

/**
 * `/` och `/login` (ADR 006 beslut 1 + 7, addendum 2026-10-11). Inloggad: gamla `?tab=`-adresser skickas vidare (replace) till sina nya
 * routes, annars /board; `/login` går till `?next=` (bara interna adresser, annars /board). Utloggad: Landing (publik), och på `/login` med
 * inloggningsdialogen ovanpå. Båda routerna renderar samma element på samma plats i trädet, så Landing behålls (ingen ommontering,
 * inga omstartade animationer) när dialogen öppnas och stängs. Dialogen monteras här, inte i Landing-featuren: den gör inloggningsanropet.
 */
const Index: React.FC<IndexProps> = ({ loginOpen = false }) => {
  const { user } = useAuth();
  const { search } = useLocation();

  if (user) return <Navigate to={loginOpen ? resolveNextPath(search) : resolveLegacyRedirect(search)} replace />;
  return (
    <>
      <LandingPage />
      {loginOpen && <LoginDialog />}
    </>
  );
};

export default Index;
