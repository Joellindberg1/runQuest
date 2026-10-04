import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { GroupRunHistoryResponse } from '@runquest/shared';
import { backendApi } from '@/shared/services/backendApi';
import { useAuth } from '@/providers/authContext';
import { HISTORY_PAGE_SIZE } from '../historyModel';

const STALE_MS = 60_000;
// Ett snabbt omförsök, sedan felkortet — standardens tre försök med backoff håller ovalen snurrande i ~7 s.
const RETRIES = 1;

export const LOG_QUERY_KEYS = {
  /** Roten för gruppens rundor — en ny runda invalideras härifrån (useCreateRun). */
  history: ['runs', 'group-history'] as const,
};

/**
 * Gruppens rundor i sidor (GET /runs/group-history?limit&offset). `meta.has_more` styr "Show more"; nästa sida börjar vid
 * summan av det som redan hämtats. staleTime 0: en runda som ändrats eller raderats i Profile ska aldrig stå kvar här.
 */
export function useGroupHistory(enabled = true) {
  const { user } = useAuth();
  return useInfiniteQuery({
    queryKey: LOG_QUERY_KEYS.history,
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<GroupRunHistoryResponse> => {
      const res = await backendApi.getGroupRunHistoryPage(HISTORY_PAGE_SIZE, pageParam);
      if (!res.success || !res.data) throw new Error(res.error || 'Failed to load the group history');
      return res.data;
    },
    getNextPageParam: (last) => (last.meta.has_more ? last.meta.offset + last.runs.length : undefined),
    enabled: enabled && !!user,
    retry: RETRIES,
  });
}

// Strava-banderollen läser samma queries som skalets "Right now" (useRightNow): samma nycklar och samma form (`res.data`),
// så en hämtning delas mellan dem. Ändras en definition där ska den ändras här.
export function useStravaStatus(enabled = true) {
  return useQuery({
    queryKey: ['strava', 'status'],
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

export function useStravaLastSync(enabled = true) {
  return useQuery({
    queryKey: ['strava', 'last-sync'],
    queryFn: async () => {
      const res = await backendApi.getStravaLastSync();
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
    enabled,
    staleTime: STALE_MS,
    refetchInterval: 5 * STALE_MS,
    retry: RETRIES,
  });
}
