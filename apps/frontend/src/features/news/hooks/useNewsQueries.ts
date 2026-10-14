import { useCallback, useEffect, useState } from 'react';
import { hashKey, useMutation, useQuery, useQueryClient, type Query, type QueryClient, type QueryKey } from '@tanstack/react-query';
import type { ActivityType, NewsQuery } from '@runquest/shared';
import { backendApi } from '@/shared/services/backendApi';
import {
  NEWS_CATCH_UP_LIMIT, NEWS_MAX_GAP_PAGES, NEWS_PAGE_SIZE, appendOlder, createReadBatcher, feedFromPage, gapCursor, markReadInFeed, markSeenInFeed, markUnreadInFeed,
  mergeNewer, replaceNewest, topIdOf, typeParamOf,
  type NewsFeed, type NewsPage,
} from '../newsModel';

/** Filtret "Involves me" (ADR 011 beslut 9): `?involves=me`. Servern tar parametern i en senare story. */
export type NewsInvolves = 'me';
type FeedQuery = NewsQuery & { involves?: NewsInvolves };

const STALE_MS = 60_000;
/** Klockans räknare och flödet hålls färska med samma takt (och vid fönsterfokus när datan är äldre än STALE_MS). */
const POLL_MS = 2 * STALE_MS;
// Ett snabbt omförsök, sedan felkortet — standardens tre försök med backoff håller skelettet kvar i ~7 s.
const RETRIES = 1;
/** Fokus-uppdateringen hoppas över om flödet hämtades så här nyligen (flikbyten i rad ska inte ge en hämtning var). */
const FOCUS_MIN_AGE_MS = 15_000;
/** Pågående fokus-uppdateringar per flöde — flera observers (klocka, popover, skärm) delar en hämtning per fokus-händelse. */
const refreshing = new Set<string>();

export const NEWS_QUERY_KEYS = {
  /** Alla flöden (alla filter) — det som kvittering optimistiskt uppdaterar och invalideras. */
  feedRoot: ['news', 'feed'] as const,
  /**
   * `typeParam` = serverns type= ("title_taken,level_up"), undefined = alla typer. `involves` ger ett eget flöde vid sidan av det vanliga
   * (nyckeln utan involves är oförändrad, så de befintliga cachearna och feedRoot-prefixet gäller som förut).
   */
  feed: (typeParam: string | undefined, involves?: NewsInvolves) =>
    (involves ? (['news', 'feed', typeParam ?? 'all', involves] as const) : (['news', 'feed', typeParam ?? 'all'] as const)),
};

async function fetchPage(query: FeedQuery): Promise<NewsPage> {
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
async function loadFeed(
  queryClient: QueryClient, key: QueryKey, typeParam: string | undefined, involves: NewsInvolves | undefined, signal: AbortSignal,
): Promise<NewsFeed> {
  const current = queryClient.getQueryData<NewsFeed>(key);
  const known = current ? topIdOf(current.items) : null;
  if (!current || known === null) return feedFromPage(await fetchPage({ limit: NEWS_PAGE_SIZE, type: typeParam, involves }));
  const unchanged = () => queryClient.getQueryData<NewsFeed>(key) ?? current;

  let last = await fetchPage({ after: known, limit: NEWS_CATCH_UP_LIMIT, type: typeParam, involves });
  if (signal.aborted) return unchanged();
  const fetched = [...last.items];
  let cursor = gapCursor(last, known);
  for (let pages = 1; cursor !== null && pages < NEWS_MAX_GAP_PAGES; pages += 1) {
    last = await fetchPage({ before: cursor, limit: NEWS_CATCH_UP_LIMIT, type: typeParam, involves });
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
 * `involves` ("Involves me") är ett eget flöde med egen cache och samma logik; `unread_count` är ändå oberoende av det.
 */
export function useNewsFeed(types: readonly ActivityType[] | null = null, enabled = true, involves?: NewsInvolves) {
  const queryClient = useQueryClient();
  const typeParam = typeParamOf(types);
  const key = NEWS_QUERY_KEYS.feed(typeParam, involves);

  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => loadFeed(queryClient, key, typeParam, involves, signal),
    enabled,
    staleTime: STALE_MS,
    refetchInterval: POLL_MS,
    retry: RETRIES,
    // Fokus hanteras nedan (nyaste sidan ersätts, inte bara catch-up).
    refetchOnWindowFocus: false,
  });

  // Catch-up kan bara LÄGGA TILL rader. En rad som backend tar bort (utmaning återkallad/avböjd → retract) ligger därför kvar tills
  // flödet läker: när fönstret får fokus ersätts den nyaste sidan helt, och en omladdning börjar om. Pollen läker inte (dokumenterat).
  useEffect(() => {
    if (!enabled) return undefined;
    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      const feedKey = NEWS_QUERY_KEYS.feed(typeParam, involves);
      const id = feedKey.join('/');
      const state = queryClient.getQueryState<NewsFeed>(feedKey);
      if (!state?.data || refreshing.has(id) || Date.now() - state.dataUpdatedAt < FOCUS_MIN_AGE_MS) return;
      refreshing.add(id);
      fetchPage({ limit: NEWS_PAGE_SIZE, type: typeParam, involves })
        .then((page) => queryClient.setQueryData<NewsFeed>(feedKey, (latest) => (latest ? replaceNewest(latest, page) : latest)))
        .catch(() => undefined)
        .finally(() => refreshing.delete(id));
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [enabled, queryClient, typeParam, involves]);

  const more = useMutation({
    mutationFn: async () => {
      const feed = queryClient.getQueryData<NewsFeed>(key);
      if (!feed || feed.meta.next_before === null) return;
      const page = await fetchPage({ before: feed.meta.next_before, limit: NEWS_PAGE_SIZE, type: typeParam, involves });
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
 * Vattenmärket (`last_seen_id`) i samma flöde. Det flyttas bara av "Mark all read" (`markSeenInFeed`), aldrig av en rad-gest (`markReadInFeed`),
 * så klockans live-region kan se vilken av de två som sänkte räknaren och låta kvitteringens egen bekräftelse vara den enda annonseringen.
 */
export function useNewsSeenWatermark(enabled = true): number | null {
  return useNewsFeed(null, enabled).feed?.meta.last_seen_id ?? null;
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

/**
 * Läs-tillståndet för EN hook-instans (ADR 011 beslut 4): optimistisk uppdatering, buntade anrop och exakt återställning. Det är vanlig kod
 * runt `queryClient` och inte `useMutation`: en kvittering ska aldrig vänta på nätverket, buntar flera id:n per anrop och ska överleva att
 * komponenten avmonteras (ett mutate-anrop per gest skulle varken bunta eller kunna tömmas vid avmontering).
 *
 * Känd begränsning (läker sig själv): en poll som STARTAR efter den lokala kvitteringen men innan servern tagit emot den ger tillbaka serverns gamla
 * `unread_count` (raderna förblir lästa, catch-up rör inte befintliga rader). Räknaren rättas av nästa svar på POST:en eller nästa poll. Ett misslyckat
 * anrop efter en sådan poll kan på samma sätt höja räknaren för mycket tills nästa poll.
 */
function createNewsReader(queryClient: QueryClient) {
  /** id → cachenycklar (hashade) där raden vändes lokalt, så att ett misslyckande återställer exakt de raderna. */
  const flipped = new Map<number, Set<string>>();
  /** Anrop som är på väg. Serverns räknare gäller först när inget annat väntar: ett äldre svar får inte skriva över nyare lokala kvitteringar. */
  let inFlight = 0;

  const writeCounter = (ids: number[], unreadCount: number) =>
    queryClient.setQueriesData<NewsFeed>({ queryKey: NEWS_QUERY_KEYS.feedRoot }, (feed) => (feed ? markReadInFeed(feed, ids, unreadCount) : feed));

  const restore = (ids: number[]) => {
    for (const [key, feed] of queryClient.getQueriesData<NewsFeed>({ queryKey: NEWS_QUERY_KEYS.feedRoot })) {
      if (!feed) continue;
      const hash = hashKey(key);
      const here = ids.filter((id) => flipped.get(id)?.has(hash));
      // Räknaren minskade i alla cachar när raderna kvitterades, så den höjs i alla (även där raden inte fanns).
      queryClient.setQueryData<NewsFeed>(key, markUnreadInFeed(feed, here, feed.meta.unread_count + ids.length));
    }
  };

  const send = async (ids: number[]) => {
    inFlight += 1;
    let unreadCount: number | null = null;
    try {
      const res = await backendApi.markNewsRead(ids);
      if (!res.success || !res.data) throw new Error(res.error || 'Failed to mark the rows as read');
      unreadCount = res.data.unread_count;
    } catch {
      // Tyst (ADR 011 beslut 4): raderna blir olästa igen och nästa gest försöker på nytt.
      restore(ids);
    } finally {
      inFlight -= 1;
      for (const id of ids) flipped.delete(id);
    }
    // Serverns räknare är sanningen (kan innehålla rader som kom under tiden), men bara när det är det sista svaret vi väntar på.
    if (unreadCount !== null && inFlight === 0 && !batcher.hasPending()) writeCounter(ids, unreadCount);
  };

  const batcher = createReadBatcher((ids) => void send(ids));

  const apply = (id: number) => {
    const caches = queryClient.getQueriesData<NewsFeed>({ queryKey: NEWS_QUERY_KEYS.feedRoot });
    const holders = caches.filter(([, feed]) => feed?.items.some((row) => row.id === id && row.is_unread && !row.is_backfill));
    // Inte oläst i något flöde (redan läst, egen handling, avstängt slag, okänt id): inget att göra och inget anrop.
    if (holders.length === 0) return;
    flipped.set(id, new Set(holders.map(([key]) => hashKey(key))));
    queryClient.setQueriesData<NewsFeed>(
      { queryKey: NEWS_QUERY_KEYS.feedRoot },
      (feed) => (feed ? markReadInFeed(feed, [id], Math.max(0, feed.meta.unread_count - 1)) : feed),
    );
    batcher.add(id);
  };

  const markRead = (id: number) => {
    // Utan hämtning i flykt sker uppdateringen i samma ögonblick. En poll som startade före gesten har läst innan den och får inte skriva
    // tillbaka raden eller den gamla räknaren: den avbryts (react-query återställer då till läget före hämtningen) och uppdateringen läggs efter.
    // Bara flöden som redan har data: en första laddning (ingen data än) har inget gammalt att skriva tillbaka och blir kvar i laddningsläget om den avbryts.
    const filters = { queryKey: NEWS_QUERY_KEYS.feedRoot, predicate: (query: Query) => query.state.data !== undefined };
    if (queryClient.isFetching(filters) === 0) apply(id);
    else void queryClient.cancelQueries(filters).then(() => apply(id));
  };

  return { markRead, flush: batcher.flush };
}

/**
 * Läst per rad (ADR 011 beslut 4 och addendum 2026-10-14). Hooken exponerar bara `markRead(id)`: gesterna (hover efter rörelse, tap, Enter/Space)
 * hör till vyerna. Raden och räknaren är lästa i ALLA flödescacher i samma ögonblick; nätverksanropen buntas (`READ_FLUSH_MS`, högst 50 id per
 * `POST /news/read`) och töms vid avmontering. Ett fel återställer lokalt tillstånd tyst, serverns `unread_count` skriver över den lokala.
 * Rader som inte är olästa (lästa, egna, avstängda slag, backfill, okända id) ger inget anrop.
 */
export function useMarkNewsRead() {
  const queryClient = useQueryClient();
  const [reader] = useState(() => createNewsReader(queryClient));
  useEffect(() => reader.flush, [reader]);
  return { markRead: reader.markRead };
}
