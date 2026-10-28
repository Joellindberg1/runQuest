import { useQuery } from '@tanstack/react-query';
import { POSITION_WEEKS_DEFAULT } from '@runquest/shared';
import { backendApi } from '@/shared/services/backendApi';
import { useAuth } from '@/providers/authContext';

const STALE_MS = 60_000;
// Som syskonhookarna: ett snabbt omförsök, sedan felkortet.
const RETRIES = 1;

/** Ligger under `['leaderboard']`, så kedjan efter en loggad runda (features/runs/runEffects) invaliderar den utan egen rad. */
export const POSITION_QUERY_KEY = (weeks: number) => ['leaderboard', 'positions', weeks] as const;

/**
 * Placeringshistoriken (GET /api/leaderboard/positions). Leaderboard och profilen delar hook och cache; profilen plockar sin rad med `runners.find`.
 * Hämtar bara när `enabled` är sant (Position-fliken är öppen). Svaret kan ha färre veckor än `weeks` (förledande veckor utan närvarande
 * beskärs, en ny grupp ger en vecka): läs alltid `data.weeks.length`, anta aldrig `weeks`.
 */
export function usePositionHistory(weeks: number = POSITION_WEEKS_DEFAULT, enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: POSITION_QUERY_KEY(weeks),
    queryFn: async () => {
      const res = await backendApi.getPositionHistory(weeks);
      if (!res.success || !res.data) throw new Error(res.error || 'Failed to load position history');
      return res.data;
    },
    enabled: enabled && !!user,
    staleTime: STALE_MS,
    retry: RETRIES,
  });
}
