import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { backendApi, type GroupEligibilityEntry, type TitleLeaderboard } from '@/shared/services/backendApi';
import { titleQueryKeys } from '@/shared/hooks/useTitleQueries';
import { USERS_WITH_RUNS_QUERY_KEY } from '@/shared/hooks/useUsersWithRuns';

const STALE_MS = 60_000;
// Ett snabbt omförsök, sedan felkortet — standardens tre försök med backoff håller skelettet kvar i ~7 s.
const RETRIES = 1;

export const TITLES_QUERY_KEYS = {
  // Under 'titles'-roten så att titleQueryKeys.all-invalideringar (efter en runda) når dem också.
  board: [...titleQueryKeys.all, 'board'] as const,
  eligibility: [...titleQueryKeys.all, 'group-eligibility'] as const,
};

/**
 * Titelraderna (GET /titles/leaderboard). Egen hook i stället för `useTitleLeaderboard`: den hooken sväljer fel och
 * svarar tomt, och "No titles yet" vore då en lögn vid nätverksfel — Titles ska visa felkortet (regel 9).
 */
export function useTitleBoard(enabled = true) {
  return useQuery({
    queryKey: TITLES_QUERY_KEYS.board,
    queryFn: async (): Promise<TitleLeaderboard[]> => {
      const res = await backendApi.getTitleLeaderboard();
      if (!res.success || !res.data) throw new Error(res.error || 'Failed to load titles');
      return res.data;
    },
    enabled,
    staleTime: STALE_MS,
    retry: RETRIES,
  });
}

/** Gruppens värden per måttnyckel (GET /titles/group-eligibility) — ger "Best so far" på olåsta titlar. */
export function useGroupEligibility(enabled = true) {
  return useQuery({
    queryKey: TITLES_QUERY_KEYS.eligibility,
    queryFn: async (): Promise<GroupEligibilityEntry[]> => {
      const res = await backendApi.getTitleGroupEligibility();
      if (!res.success) throw new Error(res.error || 'Failed to load title progress');
      return res.data ?? [];
    },
    enabled,
    staleTime: STALE_MS,
    retry: RETRIES,
  });
}

/** Spara vilka (högst tre) titlar som visas på leaderboarden; uppdaterar gruppens användare så Board följer med. */
export function useSaveDisplayedTitles() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (titleIds: string[]) => {
      const res = await backendApi.updateDisplayedTitles(titleIds);
      if (!res.success) throw new Error(res.error || 'Failed to save');
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: USERS_WITH_RUNS_QUERY_KEY }),
  });
}
