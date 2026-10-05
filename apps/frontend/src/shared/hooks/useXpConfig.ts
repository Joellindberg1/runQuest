import { useQuery } from '@tanstack/react-query';
import { backendApi } from '@/shared/services/backendApi';
import { useAuth } from '@/providers/authContext';

export const XP_CONFIG_QUERY_KEY = ['config', 'xp'] as const;
const STALE_MS = 10 * 60_000;
// Ett snabbt omförsök, sedan felkortet (standardens tre försök med backoff ger ~7 s av väntan).
const RETRIES = 1;

/** Effektiva XP-inställningar + multiplikatortrappan (GET /api/config/xp). Enda källan för trappan i UI:t. */
export function useXpConfig() {
  const { user } = useAuth();
  return useQuery({
    queryKey: XP_CONFIG_QUERY_KEY,
    queryFn: async () => {
      const res = await backendApi.getXpConfig();
      if (!res.success || !res.data) throw new Error(res.error || 'Failed to load XP config');
      return res.data;
    },
    enabled: !!user,
    staleTime: STALE_MS,
    retry: RETRIES,
  });
}
