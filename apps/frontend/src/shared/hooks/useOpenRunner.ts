import { useCallback } from 'react';
import { useLocation, useNavigate, type Location } from 'react-router-dom';
import { paths } from '@/paths';

/** Router-state för "background location"-mönstret (ADR 006 beslut 6). */
export interface BackgroundState {
  background?: Location;
}

export function readBackground(location: Location): Location | undefined {
  return (location.state as BackgroundState | null)?.background;
}

/**
 * Öppna Runner card (`/runner/:id`). Från inne i appen skickas aktuell plats med som
 * `background` så att desktop kan visa kortet som overlay över sidan; direktladdning
 * saknar `background` och renderas som vanlig sida.
 */
export function useOpenRunner() {
  const navigate = useNavigate();
  const location = useLocation();

  return useCallback(
    (userId: string) => {
      const insideRunner = location.pathname.startsWith('/runner/');
      const background = insideRunner ? readBackground(location) : location;
      navigate(paths.runner(userId), { state: background ? ({ background } satisfies BackgroundState) : undefined });
    },
    [navigate, location],
  );
}

/** Esc/✕/back: ett steg tillbaka, eller /board om historiken saknas (direktladdad länk). */
export function useCloseRunner() {
  const navigate = useNavigate();

  return useCallback(() => {
    const historyIndex = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (historyIndex > 0) navigate(-1);
    else navigate(paths.board, { replace: true });
  }, [navigate]);
}
