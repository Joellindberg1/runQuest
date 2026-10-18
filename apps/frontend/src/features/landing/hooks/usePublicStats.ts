import { useQuery } from '@tanstack/react-query';
import { PUBLIC_STATS_MAX_AGE_MS, type PublicStatsData } from '@runquest/shared';
import { backendApi } from '@/shared/services/backendApi';

export const PUBLIC_STATS_QUERY_KEY = ['public', 'stats'] as const;

// Ett omförsök vid nätverksfel och 5xx; ett 4xx (felaktig adress, avvisad förfrågan) blir inte bättre av att upprepas.
const RETRIES = 1;
const CLIENT_ERROR = /^HTTP 4\d\d$/;

/**
 * Landningens tre tal (GET /public/stats, ADR 006-addendum 2026-10-13): landningens enda anrop, en gång per sidvisning.
 * Ingen inloggning. Ett fel kastas så att sifferraden gömmer sig (aria-hidden + visibility: hidden, raden behåller sin höjd); en tom rad får aldrig bli svaret på att läsningen föll.
 * Inga fönsterfokus- eller återanslutningshämtningar: sidan hämtar en gång, även om fliken ligger kvar längre än cachen.
 */
export function usePublicStats() {
  return useQuery({
    queryKey: PUBLIC_STATS_QUERY_KEY,
    queryFn: async (): Promise<PublicStatsData> => {
      const res = await backendApi.getPublicStats();
      if (!res.success || !res.data) throw new Error(res.error || 'Failed to load the public stats');
      return res.data;
    },
    staleTime: PUBLIC_STATS_MAX_AGE_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: (failureCount, error) => failureCount < RETRIES && !CLIENT_ERROR.test(error.message),
  });
}
