import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/providers/authContext';
import { resolveLegacyRedirect } from '@/app-shell/legacyRedirects';
import LoginPage from './LoginPage';

/**
 * `/` (ADR 006 beslut 7). Inloggad: gamla `?tab=`-adresser skickas vidare (replace) till sina nya
 * routes. Utloggad: login (Landing tar över i inkrement 10).
 */
const Index: React.FC = () => {
  const { user } = useAuth();
  const { search } = useLocation();

  if (!user) return <LoginPage />;
  return <Navigate to={resolveLegacyRedirect(search)} replace />;
};

export default Index;
