import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { isFromLanding, paths } from '@/paths';

/**
 * Stäng inloggningsdialogen (Esc, ✕, klick på scrimmen). Öppnades den från Landingens knapp ligger Landing ett steg bakåt i
 * historiken: Back stänger dialogen och stängning gör samma sak. Annars (direktladdad `/login`, redirect från RequireAuth,
 * `?next=` på en skyddad adress) finns inget steg att gå tillbaka till — då ersätts adressen med `/`, och `next` släpps.
 */
export function useCloseLogin() {
  const navigate = useNavigate();
  const { state } = useLocation();

  return useCallback(() => {
    const historyIndex = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (isFromLanding(state) && historyIndex > 0) navigate(-1);
    else navigate(paths.landing, { replace: true });
  }, [navigate, state]);
}
