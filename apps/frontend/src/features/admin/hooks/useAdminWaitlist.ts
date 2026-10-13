import { useQuery } from '@tanstack/react-query';
import type { AdminWaitlistData } from '@runquest/shared';
import { backendApi } from '@/shared/services/backendApi';

export const ADMIN_WAITLIST_QUERY_KEY = ['admin', 'waitlist'] as const;

// Ett snabbt omförsök, sedan felkortet — standardens tre försök med backoff håller skelettet kvar i ~7 s (som Titles).
const RETRIES = 1;

/**
 * Väntelistan (GET /admin/waitlist). Ett fel kastas så att vyn visar felkortet — en tom lista får aldrig vara ett
 * svar på att läsningen föll. Ingen staleTime: varje besök på fliken läser om listan.
 */
export function useAdminWaitlist() {
  return useQuery({
    queryKey: ADMIN_WAITLIST_QUERY_KEY,
    queryFn: async (): Promise<AdminWaitlistData> => {
      const res = await backendApi.getAdminWaitlist();
      if (!res.success || !res.data) throw new Error(res.error || 'Failed to load the waitlist');
      return res.data;
    },
    retry: RETRIES,
  });
}
