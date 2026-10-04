import { useQuery } from '@tanstack/react-query';
import { backendApi } from '@/shared/services/backendApi';
import { useAuth } from '@/providers/authContext';

const STALE_MS = 60_000;
// Ett snabbt omförsök, sedan felkortet — standardens tre försök med backoff håller ovalen snurrande i ~7 s.
const RETRIES = 1;

export const BOARD_QUERY_KEYS = {
  week: ['leaderboard', 'week'] as const,
  rankDelta: ['leaderboard', 'rank-delta'] as const,
};

/** Veckovyn: rader, dagstaplar, totaler, mover (GET /api/leaderboard/week). */
export function useWeekLeaderboard(enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: BOARD_QUERY_KEYS.week,
    queryFn: async () => {
      const res = await backendApi.getWeekLeaderboard();
      if (!res.success || !res.data) throw new Error(res.error || 'Failed to load the week');
      return res.data;
    },
    enabled: enabled && !!user,
    staleTime: STALE_MS,
    retry: RETRIES,
  });
}

/** Rank mot veckostart → ▲/▼ på Season-korten. Dekorativ: ett fel döljer pilarna, inget mer. */
export function useRankDelta(enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: BOARD_QUERY_KEYS.rankDelta,
    queryFn: async () => {
      const res = await backendApi.getRankDelta();
      if (!res.success || !res.data) throw new Error(res.error || 'Failed to load rank changes');
      return res.data;
    },
    enabled: enabled && !!user,
    staleTime: STALE_MS,
    retry: RETRIES,
  });
}
