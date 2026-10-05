import { useQuery } from '@tanstack/react-query';
import type { UserTitle } from '@runquest/types';
import { useAuth } from '@/providers/authContext';
import { backendApi } from '@/shared/services/backendApi';
import { titleQueryKeys } from '@/shared/hooks/useTitleQueries';

const STALE_MS = 60_000;
// Ett snabbt omförsök, sedan felkortet — standardens tre försök med backoff håller laddaren snurrande i ~7 s.
const RETRIES = 1;
/** Antal senaste möten i head-to-head-listan ("kompakt"; endpointens default är 5, max 20). */
export const HEAD_TO_HEAD_LIMIT = 5;

export const HEAD_TO_HEAD_ROOT = ['runner', 'head-to-head'] as const;

export const RUNNER_QUERY_KEYS = {
  headToHead: (userId: string) => [...HEAD_TO_HEAD_ROOT, userId] as const,
  // Under 'titles'-roten så att titleQueryKeys.all-invalideringar (efter en runda) når den också.
  titles: (userId: string) => [...titleQueryKeys.all, 'runner', userId] as const,
};

/** Anroparens uppgörelser mot den här löparen (GET /api/challenges/head-to-head/:userId). */
export function useHeadToHead(userId: string, enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: RUNNER_QUERY_KEYS.headToHead(userId),
    queryFn: async () => {
      const res = await backendApi.getHeadToHead(userId, HEAD_TO_HEAD_LIMIT);
      if (!res.success || !res.data) throw new Error(res.error || 'Failed to load head to head');
      return res.data;
    },
    enabled: enabled && !!user,
    staleTime: STALE_MS,
    retry: RETRIES,
  });
}

/**
 * Löparens titlar. Egen hook i stället för `useUserTitles`: den hooken sväljer fel och svarar tomt, och
 * "No titles held yet" vore då en lögn vid nätverksfel — Runner card ska visa felkortet (regel 9).
 */
export function useRunnerTitles(userId: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: RUNNER_QUERY_KEYS.titles(userId),
    queryFn: async () => {
      const res = await backendApi.getUserTitles(userId);
      if (!res.success) throw new Error(res.error || 'Failed to load titles');
      return (res.data ?? []) as UserTitle[];
    },
    enabled: !!user,
    staleTime: STALE_MS,
    retry: RETRIES,
  });
}
