import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import type { ActivityType, NewsQuery } from '@runquest/shared';
import { backendApi } from '@/shared/services/backendApi';
import {
  NEWS_CATCH_UP_LIMIT, NEWS_MAX_GAP_PAGES, NEWS_PAGE_SIZE, appendOlder, feedFromPage, gapCursor, markSeenInFeed, mergeNewer, topIdOf, typeParamOf,
  type NewsFeed, type NewsPage,
} from '../newsModel';

const STALE_MS = 60_000;
/** Klockans räknare och flödet hålls färska med samma takt (och vid fönsterfokus när datan är äldre än STALE_MS). */
const POLL_MS = 2 * STALE_MS;
// Ett snabbt omförsök, sedan felkortet — standardens tre försök med backoff håller skelettet kvar i ~7 s.
const RETRIES = 1;

export const NEWS_QUERY_KEYS = {
  /** Alla flöden (alla filter) — det som kvittering optimistiskt uppdaterar och invalideras. */
  feedRoot: ['news', 'feed'] as const,
  /** `typeParam` = serverns type= ("title_taken,level_up"), undefined = alla typer. */
  feed: (typeParam: string | undefined) => ['news', 'feed', typeParam ?? 'all'] as const,
};

async function fetchPage(query: NewsQuery): Promise<NewsPage> {
  const res = await backendApi.getNews(query);
  if (!res.success || !res.data || !res.meta) throw new Error(res.error || 'Failed to load Pack News');
  return { items: res.data.items, meta: res.meta };
}

/**
 * Första hämtningen = nyaste sidan. Därefter catch-up: `?after=<högsta kända id>` ger de nyaste raderna sedan dess, och en lucka
 * större än en sida fylls med upprepade `?before=next_before` tills klienten når sitt kända id (ADR 008 addendum 4). Ett omhämtat
 * flöde börjar alltså aldrig om — äldre sidor ("Show more") och scrollposition står kvar. Sammanslagningen sker i
 * `setQueryData`-uppdateraren så att en "Show more" som landar under tiden inte skrivs över.
 * En avbruten hämtning (react-querys `signal`, t.ex. av cancelQueries när "Mark all read" trycks) skriver ALDRIG tillbaka: en
 * poll-kedja i flykt skulle annars lägga tillbaka en inaktuell unread_count över den optimistiska nollan.
 */
async function loadFeed(queryClient: QueryClient, key: QueryKey, typeParam: string | undefined, signal: AbortSignal): Promise<NewsFeed> {
  const current = queryClient.getQueryData<NewsFeed>(key);
  const known = current ? topIdOf(current.items) : null;
  if (!current || known === null) return feedFromPage(await fetchPage({ limit: NEWS_PAGE_SIZE, type: typeParam }));
  const unchanged = () => queryClient.getQueryData<NewsFeed>(key) ?? current;

  let last = await fetchPage({ after: known, limit: NEWS_CATCH_UP_LIMIT, type: typeParam });
  if (signal.aborted) return unchanged();
  const fetched = [...last.items];
  let cursor = gapCursor(last, known);
  for (let pages = 1; cursor !== null && pages < NEWS_MAX_GAP_PAGES; pages += 1) {
    last = await fetchPage({ before: cursor, limit: NEWS_CATCH_UP_LIMIT, type: typeParam });
    if (signal.aborted) return unchanged();
    fetched.push(...last.items);
    cursor = gapCursor(last, known);
  }
  const complete = cursor === null;
  return queryClient.setQueryData<NewsFeed>(key, (latest) => mergeNewer(latest ?? current, fetched, last.meta, complete)) as NewsFeed;
}

/**
 * Pack News-flödet (GET /news). Den enda definitionen: klockans badge och popover (skalet, alla typer) och /news-skärmen delar
 * nyckel, form och hämtintervall — popovern visar de fem översta raderna ur samma flöde som skärmen, och oläst-räknaren
 * ligger i `feed.meta`. `types` = valda filter (null = alla); varje filter har sin egen cache men samma catch-up-logik.
 */
export function useNewsFeed(types: readonly ActivityType[] | null = null, enabled = true) {
  const queryClient = useQueryClient();
  const typeParam = typeParamOf(types);
  const key = NEWS_QUERY_KEYS.feed(typeParam);

  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => loadFeed(queryClient, key, typeParam, signal),
    enabled,
    staleTime: STALE_MS,
    refetchInterval: POLL_MS,
    retry: RETRIES,
  });

  const more = useMutation({
    mutationFn: async () => {
      const feed = queryClient.getQueryData<NewsFeed>(key);
      if (!feed || feed.meta.next_before === null) return;
      const page = await fetchPage({ before: feed.meta.next_before, limit: NEWS_PAGE_SIZE, type: typeParam });
      queryClient.setQueryData<NewsFeed>(key, (latest) => (latest ? appendOlder(latest, page) : latest));
    },
  });

  return {
    feed: query.data,
    isLoading: query.isPending,
    isError: query.isError,
    error: query.error,
    isFetching: query.isFetching,
    refetch: query.refetch,
    loadMore: more.mutate,
    loadingMore: more.isPending,
    loadMoreError: more.isError ? (more.error instanceof Error ? more.error.message : 'Failed to load older news') : null,
  };
}

/** Räknaren på klockan: ur samma flöde som popovern (alla typer). */
export function useNewsUnreadCount(enabled = true): number {
  return useNewsFeed(null, enabled).feed?.meta.unread_count ?? 0;
}

/**
 * "Mark all read": kvitterar upp till nyaste kända raden (i flödet med alla typer — oavsett vilket filter som visas). Räknaren
 * nollas optimistiskt i alla flöden; serverns svar (kan vara > 0 om nya rader hann komma) skriver över, ett fel återställer,
 * och flödena invalideras (catch-up hämtar bara det nya).
 */
export function useMarkNewsSeen() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (upToId: number) => {
      const res = await backendApi.markNewsSeen(upToId);
      if (!res.success || !res.data) throw new Error(res.error || 'Failed to mark the news as read');
      return res.data;
    },
    onMutate: async (upToId) => {
      await queryClient.cancelQueries({ queryKey: NEWS_QUERY_KEYS.feedRoot });
      const snapshots = queryClient.getQueriesData<NewsFeed>({ queryKey: NEWS_QUERY_KEYS.feedRoot });
      queryClient.setQueriesData<NewsFeed>({ queryKey: NEWS_QUERY_KEYS.feedRoot }, (feed) => (feed ? markSeenInFeed(feed, upToId, 0) : feed));
      return { snapshots };
    },
    onError: (_error, _upToId, context) => {
      for (const [key, data] of context?.snapshots ?? []) queryClient.setQueryData(key, data);
    },
    onSuccess: (data, upToId) => {
      queryClient.setQueriesData<NewsFeed>({ queryKey: NEWS_QUERY_KEYS.feedRoot }, (feed) => (feed ? markSeenInFeed(feed, upToId, data.unread_count) : feed));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: NEWS_QUERY_KEYS.feedRoot }),
  });

  const { mutate } = mutation;
  const markAllRead = useCallback(
    (onDone?: (markedUnread: number) => void) => {
      const all = queryClient.getQueryData<NewsFeed>(NEWS_QUERY_KEYS.feed(undefined));
      const upTo = all ? topIdOf(all.items) : null;
      if (upTo === null) return;
      const unread = all?.meta.unread_count ?? 0;
      mutate(upTo, { onSuccess: () => onDone?.(unread) });
    },
    [mutate, queryClient],
  );

  return {
    markAllRead,
    isPending: mutation.isPending,
    error: mutation.isError ? (mutation.error instanceof Error ? mutation.error.message : 'Failed to mark the news as read') : null,
    reset: mutation.reset,
  };
}
