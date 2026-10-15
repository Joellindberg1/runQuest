import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateAfterRunChange } from '@/features/runs/runEffects';
import { backendApi } from '@/shared/services/backendApi';
import { rememberStravaConsent, takeStravaConsent } from '../stravaConsent';
import { DISCONNECTED_STATUS, DISCONNECT_FAILED, PAUSED_STATUS, PAUSE_FAILED, RESUMED_STATUS, RESUME_FAILED } from '../stravaConnectionCopy';

interface UseStravaActionsInput {
  /** Strava-appens client_id; null medan konfigurationen laddas eller saknas. */
  clientId: string | null | undefined;
}

const POPUP_FEATURES = 'width=500,height=700';

/** Servern hämtar luckan efter en paus i bakgrunden när synken slås på igen (svaret kommer först): rundorna läses om en gång till när den hunnit en bit. */
export const RESUME_FOLLOW_UP_MS = 8_000;

/** Vilken av de tre åtgärderna som pågår. `disconnect` och `pause` körs i dialogen, `resume` på kortet. */
export type ConnectionAction = 'pause' | 'resume' | 'disconnect';

/** Serverns svar när samtycket saknas eller är för gammalt (en gammal flik): en omladdad sida har den aktuella texten och rutan. */
const CONSENT_REQUIRED_ERROR = 'Consent required';
const CONSENT_RELOAD_HINT = 'The privacy text has been updated. Reload the page and approve it again to connect Strava.';

/**
 * Strava-kortets åtgärder: koppla (OAuth i ett fönster som svarar med postMessage), koppla om, synka nu samt pausa, slå på igen och koppla bort.
 * Bekräftelse och fel är tillstånd (visas i kortets permanenta live-regioner), inte toasts. Pausa och koppla bort körs i en dialog och rapporterar
 * fel i dialogen (`connectionError`); varje sådan åtgärd svarar med om den lyckades.
 */
export function useStravaActions({ clientId }: UseStravaActionsInput) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  // Pausa/koppla bort körs i en dialog, och dialogens fel ska stå i dialogen (inte i kortet bakom): egen sträng och egen "upptagen"-flagga.
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [connectionBusy, setConnectionBusy] = useState<ConnectionAction | null>(null);
  const followUp = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(followUp.current), []);

  const refreshStrava = useCallback(() => queryClient.invalidateQueries({ queryKey: ['strava'] }), [queryClient]);

  // OAuth-fönstret (public/strava-popup.html) skickar koden tillbaka hit.
  useEffect(() => {
    const onMessage = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;

      const code: string | null = event.data?.stravaCode || event.data?.code || null;
      if (code) {
        // Samtycket togs bort här även om anropet inte görs: ett godkännande gäller en koppling.
        const consentVersion = takeStravaConsent();
        if (!backendApi.isAuthenticated()) { setError('Authentication required'); return; }
        try {
          const result = await backendApi.connectStrava(code, consentVersion);
          if (result.success) {
            setError(null);
            setStatus('Strava connected. Your runs will start syncing.');
            void refreshStrava();
          } else {
            setStatus(null);
            setError(result.error === CONSENT_REQUIRED_ERROR ? CONSENT_RELOAD_HINT : 'Could not connect Strava');
          }
        } catch {
          setStatus(null);
          setError('Something went wrong while connecting to Strava');
        }
      }
      if (event.data?.error) { takeStravaConsent(); setStatus(null); setError('Strava authorisation failed'); }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [refreshStrava]);

  /**
   * `agreed` är samtyckesrutans läge. Utan bock görs ingenting: inget fönster öppnas och inget sparas, så kopplingen är aldrig beroende av bara
   * att knappen är låst. Versionen bärs över OAuth-omdirigeringen i sessionStorage och sparas först när fönstret faktiskt kan öppnas.
   */
  const connect = async (agreed: boolean) => {
    if (!agreed) return;
    setError(null);
    setStatus(null);
    if (!clientId) { setError('Strava is not configured on the server'); return; }

    // Även vid utgången koppling bara öppnas fönstret: callbacken skriver över de gamla tokens, och
    // disconnect raderar användarens Stravarundor. Statusen förblir "utgången" tills den nya kopplingen lyckats.
    const redirectUri = encodeURIComponent(`${window.location.origin}/strava-popup.html`);
    const authUrl = `https://www.strava.com/oauth/authorize?client_id=${clientId}&response_type=code&redirect_uri=${redirectUri}&approval_prompt=force&scope=activity:read`;
    rememberStravaConsent();
    const popup = window.open(authUrl, '_blank', POPUP_FEATURES);
    if (!popup) { takeStravaConsent(); setError('Allow pop-ups to connect Strava'); }
  };

  const sync = async () => {
    setError(null);
    setStatus(null);
    if (!backendApi.isAuthenticated()) { setError('Authentication required'); return; }
    setSyncing(true);
    try {
      const result = await backendApi.syncStrava();
      if (result.success && result.data) {
        const added = result.data.newRuns;
        setStatus(`Synced ${added} new ${added === 1 ? 'run' : 'runs'} from Strava.`);
        // Nya rundor ändrar XP, nivåer och ranking överallt — allt aktivt hämtas om (tidigare en hård omladdning).
        void queryClient.invalidateQueries();
      } else {
        setError(result.error || 'Could not sync Strava activities');
      }
    } catch {
      setError('Could not sync Strava activities');
    } finally {
      setSyncing(false);
    }
  };

  /** Rundorna, XP, nivåerna och rankingen läses om efter allt som ändrar vilka Stravarundor som finns (samma kedja som efter en ny, ändrad eller raderad runda). */
  const refreshRuns = () => invalidateAfterRunChange(queryClient);

  /**
   * Kör en åtgärd mot servern och säger om den lyckades. Dialogens åtgärder (pause, disconnect) rapporterar fel i dialogen, som står kvar öppen;
   * "Turn sync back on" har ingen dialog och rapporterar i kortets felregion. Bekräftelsen (kortets statusregion) sätts först när allt är omläst,
   * så att den inte annonseras bakom en dialog som ännu är öppen.
   */
  const runConnectionAction = async (
    action: ConnectionAction,
    request: () => Promise<{ success: boolean }>,
    failure: string,
    onSuccess: () => Promise<void>,
  ): Promise<boolean> => {
    const inDialog = action !== 'resume';
    const fail = (text: string) => (inDialog ? setConnectionError(text) : setError(text));
    setConnectionError(null);
    if (!inDialog) setError(null);
    if (!backendApi.isAuthenticated()) { fail('Authentication required'); return false; }
    setConnectionBusy(action);
    try {
      let accepted: boolean;
      try {
        accepted = (await request()).success;
      } catch {
        accepted = false;
      }
      if (!accepted) { fail(failure); return false; }
      await onSuccess();
      return true;
    } finally {
      setConnectionBusy(null);
    }
  };

  const pause = () =>
    runConnectionAction('pause', () => backendApi.setStravaSyncPaused(true), PAUSE_FAILED, async () => {
      await refreshStrava();
      setError(null);
      setStatus(PAUSED_STATUS);
    });

  const resume = () =>
    runConnectionAction('resume', () => backendApi.setStravaSyncPaused(false), RESUME_FAILED, async () => {
      await Promise.all([refreshStrava(), refreshRuns()]);
      setStatus(RESUMED_STATUS);
      clearTimeout(followUp.current);
      followUp.current = setTimeout(() => { void refreshStrava(); void refreshRuns(); }, RESUME_FOLLOW_UP_MS);
    });

  const disconnect = () =>
    runConnectionAction('disconnect', () => backendApi.disconnectStrava(), DISCONNECT_FAILED, async () => {
      // Klienten antar inte att rundorna är borta: allt som räknas ur dem läses om innan bekräftelsen visas.
      await Promise.all([refreshStrava(), refreshRuns()]);
      setError(null);
      setStatus(DISCONNECTED_STATUS);
    });

  const clearConnectionError = () => setConnectionError(null);

  return { status, error, syncing, connect, sync, pause, resume, disconnect, connectionError, connectionBusy, clearConnectionError };
}
