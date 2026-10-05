import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { backendApi } from '@/shared/services/backendApi';
import { STRAVA_QUERY_KEYS } from '@/shared/hooks/useStravaQueries';

interface UseStravaActionsInput {
  /** Strava-appens client_id; null medan konfigurationen laddas eller saknas. */
  clientId: string | null | undefined;
  /** Kopplingen finns men har gått ut: gamla tokens rensas innan en ny koppling startas. */
  expired: boolean;
}

const POPUP_FEATURES = 'width=500,height=700';

/**
 * Strava-kortets åtgärder: koppla (OAuth i ett fönster som svarar med postMessage), koppla om och synka nu.
 * Bekräftelse och fel är tillstånd (visas i kortets permanenta live-regioner), inte toasts.
 */
export function useStravaActions({ clientId, expired }: UseStravaActionsInput) {
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
        if (!backendApi.isAuthenticated()) { setError('Authentication required'); return; }
        try {
          const result = await backendApi.connectStrava(code);
          if (result.success) {
            setError(null);
            setStatus('Strava connected. Your runs will start syncing.');
            void refreshStrava();
          } else {
            setStatus(null);
            setError('Could not connect Strava');
          }
        } catch {
          setStatus(null);
          setError('Something went wrong while connecting to Strava');
        }
      }
      if (event.data?.error) { setStatus(null); setError('Strava authorisation failed'); }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [refreshStrava]);

  const connect = async () => {
    setError(null);
    setStatus(null);
    if (!clientId) { setError('Strava is not configured on the server'); return; }

    if (expired) {
      try {
        await backendApi.disconnectStrava();
        queryClient.setQueryData(STRAVA_QUERY_KEYS.status, { connected: false, expired: false });
      } catch {
        // Fortsätt ändå: en ny koppling skriver över de gamla tokens.
      }
    }

    const redirectUri = encodeURIComponent(`${window.location.origin}/strava-popup.html`);
    const authUrl = `https://www.strava.com/oauth/authorize?client_id=${clientId}&response_type=code&redirect_uri=${redirectUri}&approval_prompt=force&scope=activity:read`;
    const popup = window.open(authUrl, '_blank', POPUP_FEATURES);
    if (!popup) setError('Allow pop-ups to connect Strava');
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
