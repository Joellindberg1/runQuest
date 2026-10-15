import { useQuery } from '@tanstack/react-query';
import { backendApi } from '@/shared/services/backendApi';

// EN definition av Strava-queries: skalets "Right now" (useRightNow) och Log-skärmens Strava-rad delar nycklar, form och
// inställningar genom de här hookarna, så de kan inte glida isär.

export const STRAVA_QUERY_KEYS = {
  status: ['strava', 'status'] as const,
};

const STALE_MS = 60_000;
// Ett snabbt omförsök, sedan felet — standardens tre försök med backoff håller väntan kvar i ~7 s.
const RETRIES = 1;

/** Kopplad/utgången (GET /strava/status). */
export function useStravaStatus(enabled = true) {
  return useQuery({
    queryKey: STRAVA_QUERY_KEYS.status,
    queryFn: async () => {
      const res = await backendApi.getStravaStatus();
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
    enabled,
    staleTime: 5 * STALE_MS,
    retry: RETRIES,
  });
}
