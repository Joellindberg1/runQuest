import { useCallback } from 'react';
import { useLocation, useNavigate, type Location } from 'react-router-dom';
import { paths } from '@/paths';
import { isInternalPath } from '@/shared/utils/internalPath';

/** Router-state för "background location"-mönstret (ADR 006 beslut 6). */
export interface BackgroundState {
  background?: Location;
}

/**
 * Varifrån send-flödet öppnades när det skedde från en löpares profil-popup (ADR 006 addendum 2026-10-26, punkt 5): sidan under popupen (`returnTo`, pathname och search)
 * och löparen (`runnerId`). Challenge i popupen skickar det som `state: { sendOrigin }`; vad /duels gör med det vid ett avbrutet flöde är en egen sak.
 */
export interface SendOriginState {
  returnTo: string;
  runnerId: string;
}

export interface SendOriginRouteState {
  sendOrigin: SendOriginState;
}

/** Router-state som ber skalet fokusera löparens rad när sidan har ritats: ett avbrutet send-flöde skickar det till sidan under popupen (`ShellOutlet`). */
export interface FocusRunnerState {
  focusRunnerId: string;
}

export function readBackground(location: Location): Location | undefined {
  return (location.state as BackgroundState | null)?.background;
}

const asRecord = (state: unknown): Record<string, unknown> | null => (typeof state === 'object' && state !== null ? (state as Record<string, unknown>) : null);

/** `sendOrigin` ur router-state, bara om `returnTo` är en intern adress och löparen är angiven. Annars null: flödet behandlas då som om det saknade ursprung. */
export function readSendOrigin(state: unknown): SendOriginState | null {
  const origin = asRecord(asRecord(state)?.sendOrigin);
  if (!origin || !isInternalPath(origin.returnTo) || typeof origin.runnerId !== 'string' || origin.runnerId === '') return null;
  return { returnTo: origin.returnTo, runnerId: origin.runnerId };
}

/** Router-state utan `sendOrigin`; övrigt (t.ex. `background`) följer med. Ursprunget gäller bara flödet det skickades för och får inte ligga kvar på /duels efter ett skick. */
export function withoutSendOrigin(state: unknown): Record<string, unknown> | undefined {
  const record = asRecord(state);
  if (!record) return undefined;
  const { sendOrigin: _dropped, ...rest } = record;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

export function readFocusRunnerId(state: unknown): string | null {
  const id = asRecord(state)?.focusRunnerId;
  return typeof id === 'string' && id !== '' ? id : null;
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
