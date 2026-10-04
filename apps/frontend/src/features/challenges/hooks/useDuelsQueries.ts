import { useInfiniteQuery, useQueries, useQuery } from '@tanstack/react-query';
import type { HeadToHeadRecord } from '@runquest/shared';
import { HEAD_TO_HEAD_LIMIT, RUNNER_QUERY_KEYS } from '@/features/runner/hooks/useRunnerQueries';
import { backendApi } from '@/shared/services/backendApi';
import type { GroupStat, MyChallenges, ProgressByChallenge } from '../duelsModel';

const REFRESH_MS = 60_000;
// Ett snabbt omförsök, sedan felkortet — standardens tre försök med backoff håller skelettet kvar i ~7 s.
const RETRIES = 1;
/** Historiken hämtas i sidor om 20 (endpointens default); "Show more" hämtar nästa. */
export const HISTORY_PAGE_SIZE = 20;

export const DUELS_QUERY_KEYS = {
  /** Delas med skalets "Right now"-rad (useRightNow) — samma nyckel, samma form. */
  mine: ['challenges', 'my'] as const,
  groupStats: ['challenges', 'group-stats'] as const,
  progress: (challengeId: string) => ['challenges', 'progress', challengeId] as const,
  history: ['challenges', 'group-history'] as const,
};

/** Mina tokens, skickad/inkommande utmaning, boosts, egen historik och gruppens live-duellers (GET /challenges/my). */
export function useMyChallenges(enabled = true) {
  return useQuery({
    queryKey: DUELS_QUERY_KEYS.mine,
    queryFn: async (): Promise<MyChallenges> => {
      const res = await backendApi.getMyChallenges();
      if (!res.success || !res.data) throw new Error(res.error || 'Failed to load challenges');
      return res.data;
    },
    enabled,
    staleTime: 0,
    refetchInterval: REFRESH_MS,
    retry: RETRIES,
  });
}

/** W/D/L per gruppmedlem + vem som är upptagen (GET /challenges/group-stats). */
export function useGroupStats(enabled = true) {
  return useQuery({
    queryKey: DUELS_QUERY_KEYS.groupStats,
    queryFn: async (): Promise<GroupStat[]> => {
      const res = await backendApi.getChallengeGroupStats();
      if (!res.success || !res.data) throw new Error(res.error || 'Failed to load standings');
      return res.data;
    },
    enabled,
    staleTime: 0,
    refetchInterval: REFRESH_MS,
    retry: RETRIES,
  });
}

/**
 * Framdrift för varje live-duell (GET /challenges/:id/progress, en per duell — ingen batch-endpoint finns). Ett fel på en
 * duell lämnar bara det kortet utan värden ("—"); resten ritas.
 */
export function useLiveProgress(challengeIds: readonly string[]): ProgressByChallenge {
  return useQueries({
    queries: challengeIds.map((id) => ({
      queryKey: DUELS_QUERY_KEYS.progress(id),
      queryFn: async () => {
        const res = await backendApi.getChallengeProgress(id);
        if (!res.success || !res.data) throw new Error(res.error || 'Failed to load progress');
        return { id, progress: res.data.progress };
      },
      staleTime: 0,
      refetchInterval: REFRESH_MS,
      retry: RETRIES,
    })),
    combine: (results) => Object.fromEntries(results.flatMap((result) => (result.data ? [[result.data.id, result.data.progress]] : []))),
  });
}

/** Gruppens avslutade utmaningar, nyast först, sida för sida (GET /challenges/group-history). Bara när historiken visas. */
export function useGroupHistory(enabled: boolean) {
  return useInfiniteQuery({
    queryKey: DUELS_QUERY_KEYS.history,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const res = await backendApi.getChallengeGroupHistory(HISTORY_PAGE_SIZE, pageParam);
      if (!res.success || !res.data) throw new Error(res.error || 'Failed to load match history');
      return { items: res.data.items, hasMore: res.meta?.has_more ?? false };
    },
    getNextPageParam: (last, pages) => (last.hasMore ? pages.reduce((sum, page) => sum + page.items.length, 0) : undefined),
    enabled,
    staleTime: REFRESH_MS,
    retry: RETRIES,
  });
}

/**
 * Mitt head-to-head mot varje möjlig motståndare, för tipsen i send-sheeten. Delar Runner cards query FULLT ut: samma nyckel,
 * sidstorlek OCH dataform (hela HeadToHeadResponse). Två queryFn:er med olika form under samma nyckel skriver över varandras
 * cache och kraschar den andra konsumenten; `record` härleds därför i `combine`. Fel lämnar bara den raden utan tips.
 */
export function useOpponentRecords(opponentIds: readonly string[], enabled: boolean): Record<string, HeadToHeadRecord | undefined> {
  return useQueries({
    queries: opponentIds.map((id) => ({
      queryKey: RUNNER_QUERY_KEYS.headToHead(id),
      queryFn: async () => {
        const res = await backendApi.getHeadToHead(id, HEAD_TO_HEAD_LIMIT);
        if (!res.success || !res.data) throw new Error(res.error || 'Failed to load head to head');
        return res.data;
      },
      enabled,
      staleTime: REFRESH_MS,
      retry: false,
    })),
    combine: (results) => Object.fromEntries(opponentIds.map((id, index) => [id, results[index]?.data?.record])),
  });
}
