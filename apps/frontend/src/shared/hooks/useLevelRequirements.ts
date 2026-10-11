import { useQuery } from '@tanstack/react-query';
import { frontendLevelService } from '@/shared/services/levelService';
import { useAuth } from '@/providers/authContext';

export const LEVELS_QUERY_KEY = ['config', 'levels'] as const;
// Ett snabbt omförsök; under tiden räknar levelService mot fallback-tabellen (identisk med prod).
const RETRIES = 1;

/**
 * Nivåtabellen via backenden (GET /api/config/levels). Tabellen är statisk, så den hämtas en gång per session
 * (staleTime/gcTime Infinity) och först när någon är inloggad — utloggad visas fallback-tabellen utan nätverksanrop.
 */
export function useLevelRequirements() {
  const { user } = useAuth();
  return useQuery({
    queryKey: LEVELS_QUERY_KEY,
    queryFn: () => frontendLevelService.refresh(),
    enabled: !!user,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: RETRIES,
  });
}
