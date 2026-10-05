import { useQuery } from '@tanstack/react-query';
import { backendApi } from '@/shared/services/backendApi';
import { useStravaLastSync, useStravaStatus } from '@/shared/hooks/useStravaQueries';

export const STRAVA_CONFIG_QUERY_KEY = ['strava', 'config'] as const;

/** Strava-appens client_id (GET /strava/config, publik) — behövs för att öppna auktoriseringsfönstret. */
export function useStravaConfig() {
  return useQuery({
    queryKey: STRAVA_CONFIG_QUERY_KEY,
    queryFn: async () => {
      const res = await backendApi.getStravaConfig();
      if (!res.success || !res.data) throw new Error(res.error || 'Failed to get Strava config');
      return res.data.client_id;
    },
    staleTime: Infinity,
    retry: 1,
  });
}

/**
 * Det Settings visar om Strava: kopplingen och senaste/nästa synk. Samma queries som skalets Right now och Logs Strava-rad
 * (`shared/hooks/useStravaQueries`) — en hämtning delas, och en koppling som görs här syns överallt direkt.
 */
export function useStravaData() {
  return { status: useStravaStatus(), sync: useStravaLastSync(), config: useStravaConfig() };
}
