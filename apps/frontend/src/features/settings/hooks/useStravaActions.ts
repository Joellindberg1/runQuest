import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { backendApi } from '@/shared/services/backendApi';
import { rememberStravaConsent, takeStravaConsent } from '../stravaConsent';

interface UseStravaActionsInput {
  /** Strava-appens client_id; null medan konfigurationen laddas eller saknas. */
  clientId: string | null | undefined;
}

const POPUP_FEATURES = 'width=500,height=700';

/** Serverns svar när samtycket saknas eller är för gammalt (en gammal flik): en omladdad sida har den aktuella texten och rutan. */
const CONSENT_REQUIRED_ERROR = 'Consent required';
const CONSENT_RELOAD_HINT = 'The privacy text has been updated. Reload the page and approve it again to connect Strava.';

/**
 * Strava-kortets åtgärder: koppla (OAuth i ett fönster som svarar med postMessage), koppla om och synka nu.
 * Bekräftelse och fel är tillstånd (visas i kortets permanenta live-regioner), inte toasts.
 */
export function useStravaActions({ clientId }: UseStravaActionsInput) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

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

  /** Anropas bara när användaren kryssat i samtyckesrutan (StravaCard låser knappen annars): versionen bärs över OAuth-omdirigeringen i sessionStorage. */
  const connect = async () => {
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

  return { status, error, syncing, connect, sync };
}
