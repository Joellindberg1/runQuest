import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/providers/authContext';
import { resolveLegacyRedirect } from '@/app-shell/legacyRedirects';
import LandingPage from './LandingPage';

/**
 * `/` (ADR 006 beslut 1 + 7). Inloggad: gamla `?tab=`-adresser skickas vidare (replace) till sina nya routes, annars
 * /board. Utloggad: Landing (publik). Login nås via Landingens knapp och /login direkt.
 */
const Index: React.FC = () => {
  const { user } = useAuth();
  const { search } = useLocation();

  if (!user) return <LandingPage />;
  return <Navigate to={resolveLegacyRedirect(search)} replace />;
};

export default Index;
