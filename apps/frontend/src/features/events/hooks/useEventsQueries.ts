import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { EventItem, EventsHistoryResponse, EventsResponse } from '@runquest/shared';
import { backendApi } from '@/shared/services/backendApi';
import { HISTORY_PAGE_SIZE, RECORD_MAX_PAGES, RECORD_PAGE_SIZE } from '../eventsModel';

const STALE_MS = 60_000;
// Ett snabbt omförsök, sedan felkortet — standardens tre försök med backoff håller skelettet kvar i ~7 s.
const RETRIES = 1;

export const EVENTS_QUERY_KEYS = {
  /** Delas med skalets "Right now"-rad (useRightNow) — samma nyckel, samma svarsform (`{ events }`). */
  open: ['events'] as const,
  historyPage: (page: number) => ['events', 'history', 'page', page] as const,
  record: ['events', 'history', 'record'] as const,
};

/** Aktiva + schemalagda events för gruppen (GET /events): öppet nu, up next och veckan. */
export function useOpenEvents(enabled = true) {
  return useQuery({
    queryKey: EVENTS_QUERY_KEYS.open,
    queryFn: async (): Promise<EventsResponse> => {
      const res = await backendApi.getEventList();
      if (!res.success || !res.data) throw new Error(res.error || 'Failed to load events');
      return res.data;
    },
    enabled,
    staleTime: STALE_MS,
    refetchInterval: 2 * STALE_MS,
    retry: RETRIES,
  });
}

/** En historiksida (6 events, GET /events/history?limit=6&offset=…). Föregående sida står kvar medan nästa hämtas. */
export function useEventHistoryPage(page: number, enabled = true) {
  return useQuery({
    queryKey: EVENTS_QUERY_KEYS.historyPage(page),
    queryFn: async (): Promise<EventsHistoryResponse> => {
      const res = await backendApi.getEventHistoryPage(HISTORY_PAGE_SIZE, (page - 1) * HISTORY_PAGE_SIZE);
      if (!res.success || !res.data) throw new Error(res.error || 'Failed to load the event history');
      return res.data;
    },
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 5 * STALE_MS,
    retry: RETRIES,
  });
}

/**
 * Hela historiken för "Your record" — endpointen har inget aggregat, så sidorna om 50 (endpointens max) läses till
 * `has_more` är falskt, högst RECORD_MAX_PAGES. Ett fel här döljer bara facit-panelen; resten av skärmen påverkas inte.
 */
export function useEventRecordSource(enabled = true) {
  return useQuery({
    queryKey: EVENTS_QUERY_KEYS.record,
    queryFn: async (): Promise<EventItem[]> => {
      const all: EventItem[] = [];
      for (let page = 0; page < RECORD_MAX_PAGES; page += 1) {
        const res = await backendApi.getEventHistoryPage(RECORD_PAGE_SIZE, page * RECORD_PAGE_SIZE);
        if (!res.success || !res.data) throw new Error(res.error || 'Failed to load the event history');
        all.push(...res.data.events);
        if (!res.data.meta?.has_more || res.data.events.length === 0) break;
      }
      return all;
    },
    enabled,
    staleTime: 5 * STALE_MS,
    retry: RETRIES,
  });
}
