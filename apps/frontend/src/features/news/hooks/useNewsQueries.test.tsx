import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ME, item, levelUp, newsServer, titleTaken } from '../news.fixture';
import { NEWS_QUERY_KEYS, useMarkNewsSeen, useNewsFeed } from './useNewsQueries';
import type { NewsFeed } from '../newsModel';

const api = vi.hoisted(() => ({ getNews: vi.fn(), markNewsSeen: vi.fn() }));
vi.mock('@/shared/services/backendApi', () => ({ backendApi: api }));

const rows = (count: number, from = 1) => Array.from({ length: count }, (_, index) => levelUp(from + index, from + index));

let queryClient: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
const cached = (typeParam?: string) => queryClient.getQueryData<NewsFeed>(NEWS_QUERY_KEYS.feed(typeParam));
const ids = (feed?: NewsFeed) => feed?.items.map((row) => row.id);

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  api.getNews.mockReset();
  api.markNewsSeen.mockReset();
});

// Observern meddelar i en egen tick efter act(): vänta in den innan resultatet läses.
async function refetch(result: { current: { refetch: () => Promise<unknown> } }) {
  await act(async () => { await result.current.refetch(); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
}

function serve(server: ReturnType<typeof newsServer>) {
  api.getNews.mockImplementation(server.getNews);
  api.markNewsSeen.mockImplementation(server.markNewsSeen);
}

describe('useNewsFeed — första hämtning, Show more och catch-up (ADR 008 addendum 4)', () => {
  it('första hämtningen är nyaste sidan (limit 30), med oläst-räknaren i meta', async () => {
    const news = newsServer(rows(45), 40);
    serve(news);
    const { result } = renderHook(() => useNewsFeed(null), { wrapper });

    await waitFor(() => expect(result.current.feed).toBeDefined());
    expect(news.server.calls).toEqual([{ limit: 30, type: undefined }]);
    expect(result.current.feed?.items).toHaveLength(30);
    expect(result.current.feed?.items[0].id).toBe(45);
    expect(result.current.feed?.meta).toMatchObject({ has_more: true, next_before: 16, unread_count: 5 });
  });

  it('Show more: fortsätter från next_before, lägger till raderna och flyttar kanten; sista sidan har inget has_more', async () => {
    const news = newsServer(rows(45));
    serve(news);
    const { result } = renderHook(() => useNewsFeed(null), { wrapper });
    await waitFor(() => expect(result.current.feed).toBeDefined());

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.feed?.items).toHaveLength(45));
    expect(news.server.calls[1]).toEqual({ before: 16, limit: 30, type: undefined });
    expect(result.current.feed?.meta).toMatchObject({ has_more: false, next_before: null });
    expect(ids(result.current.feed)).toEqual(Array.from({ length: 45 }, (_, index) => 45 - index));
  });

  it('ett fel vid Show more står kvar som loadMoreError och rör inte flödet', async () => {
    const news = newsServer(rows(45));
    serve(news);
    const { result } = renderHook(() => useNewsFeed(null), { wrapper });
    await waitFor(() => expect(result.current.feed).toBeDefined());

    news.server.failNext = 'The pack is out of range';
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.loadMoreError).toBe('The pack is out of range'));
    expect(result.current.feed?.items).toHaveLength(30);
  });

  it('omhämtning = catch-up: ?after=<högsta kända id>, nya rader läggs överst och äldre sidor ("Show more") står kvar', async () => {
    const news = newsServer(rows(45));
    serve(news);
    const { result } = renderHook(() => useNewsFeed(null), { wrapper });
    await waitFor(() => expect(result.current.feed).toBeDefined());
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.feed?.items).toHaveLength(45));

    news.server.rows.unshift(levelUp(47, 47), levelUp(46, 46));
    await refetch(result);

    expect(news.server.calls.at(-1)).toEqual({ after: 45, limit: 100, type: undefined });
    expect(ids(result.current.feed)?.slice(0, 3)).toEqual([47, 46, 45]);
    expect(result.current.feed?.items).toHaveLength(47);
  });

  it('en omhämtning utan nyheter ändrar inget utom oläst-räknaren', async () => {
    const news = newsServer([titleTaken(3), titleTaken(2), titleTaken(1)], 3);
    serve(news);
    const { result } = renderHook(() => useNewsFeed(null), { wrapper });
    await waitFor(() => expect(result.current.feed).toBeDefined());
    expect(result.current.feed?.meta.unread_count).toBe(0);

    news.server.lastSeen = 0;
    await refetch(result);
    expect(result.current.feed?.items).toHaveLength(3);
    expect(result.current.feed?.meta.unread_count).toBe(3);
  });

  it('luckan större än en sida fylls med ?before=next_before tills klienten når sitt kända id, utan dubbletter', async () => {
    const news = newsServer(rows(10));
    serve(news);
    const { result } = renderHook(() => useNewsFeed(null), { wrapper });
    await waitFor(() => expect(result.current.feed).toBeDefined());

    // 250 nya rader: catch-upens `after`-sida ger bara de 100 nyaste, resten fylls med before-sidor.
    news.server.rows.unshift(...rows(250, 11).reverse());
    await refetch(result);

    const calls = news.server.calls.slice(1);
    expect(calls[0]).toEqual({ after: 10, limit: 100, type: undefined });
    expect(calls.slice(1).every((call) => call.after === undefined && call.before !== undefined)).toBe(true);
    expect(calls.slice(1).map((call) => call.before)).toEqual([161, 61]);
    expect(result.current.feed?.items).toHaveLength(260);
    expect(new Set(ids(result.current.feed)).size).toBe(260);
    expect(ids(result.current.feed)?.[0]).toBe(260);
    expect(ids(result.current.feed)?.at(-1)).toBe(1);
  });

  it('en lucka som är större än catch-upen orkar ersätter fönstret med det nyaste (inget hål i mitten), och Show more fortsätter därifrån', async () => {
    const news = newsServer(rows(10));
    serve(news);
    const { result } = renderHook(() => useNewsFeed(null), { wrapper });
    await waitFor(() => expect(result.current.feed).toBeDefined());

    news.server.rows.unshift(...rows(1000, 11).reverse());
    await refetch(result);

    const feed = result.current.feed;
    expect(feed?.items).toHaveLength(500);
    expect(ids(feed)?.[0]).toBe(1010);
    expect(ids(feed)?.at(-1)).toBe(511);
    expect(feed?.meta).toMatchObject({ has_more: true, next_before: 511 });
  });

  it('ett fel mitt i before-kedjan: refetch misslyckas utan krasch och den gamla listan står kvar orörd', async () => {
    const news = newsServer(rows(10));
    serve(news);
    const { result } = renderHook(() => useNewsFeed(null), { wrapper });
    await waitFor(() => expect(result.current.feed).toBeDefined());
    const before = result.current.feed;

    news.server.rows.unshift(...rows(250, 11).reverse());
    // Första catch-up-sidan (after) går bra, andra (before) fallerar.
    api.getNews.mockImplementation(async (query: { before?: number }) => (query.before !== undefined ? { success: false, error: 'mid-chain failure' } : news.getNews(query)));
    await refetch(result);

    expect(result.current.feed).toBe(before);
    expect(ids(result.current.feed)).toEqual(ids(before));
    expect(result.current.isError).toBe(true);
    expect(cached()).toBe(before);
  });

  it('en Show more som landar under en pågående catch-up skrivs inte över av sammanslagningen', async () => {
    const news = newsServer(rows(45));
    serve(news);
    const { result } = renderHook(() => useNewsFeed(null), { wrapper });
    await waitFor(() => expect(result.current.feed).toBeDefined());
    expect(result.current.feed?.items).toHaveLength(30);

    news.server.rows.unshift(levelUp(47, 47), levelUp(46, 46));
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    api.getNews.mockImplementation(async (query: { after?: number }) => {
      const response = await news.getNews(query as never);
      if (query.after !== undefined) await gate;
      return response;
    });

    let pending: Promise<unknown> = Promise.resolve();
    act(() => { pending = result.current.refetch(); });
    act(() => result.current.loadMore());
    await waitFor(() => expect(cached()?.items).toHaveLength(45));

    await act(async () => { release(); await pending; });
    expect(ids(cached())).toEqual(Array.from({ length: 47 }, (_, index) => 47 - index));
    expect(cached()?.meta).toMatchObject({ has_more: false, next_before: null });
  });

  it.each([[100, 1], [101, 2]])('en lucka på exakt %d rader kräver %d catch-up-hämtning(ar) och ger inga dubbletter', async (gap, calls) => {
    const news = newsServer(rows(10));
    serve(news);
    const { result } = renderHook(() => useNewsFeed(null), { wrapper });
    await waitFor(() => expect(result.current.feed).toBeDefined());

    news.server.rows.unshift(...rows(gap, 11).reverse());
    await refetch(result);

    expect(news.server.calls.slice(1)).toHaveLength(calls);
    expect(result.current.feed?.items).toHaveLength(10 + gap);
    expect(new Set(ids(result.current.feed)).size).toBe(10 + gap);
    expect(ids(result.current.feed)?.[0]).toBe(10 + gap);
  });

  it('ett filter har egen cache och skickar type= i ACTIVITY_TYPES-ordning', async () => {
    const news = newsServer([titleTaken(3), levelUp(2, 5), titleTaken(1)]);
    serve(news);
    const { result } = renderHook(() => useNewsFeed(['title_unlocked', 'title_taken', 'title_revoked']), { wrapper });
    await waitFor(() => expect(result.current.feed).toBeDefined());
    expect(news.server.calls[0].type).toBe('title_unlocked,title_taken,title_revoked');
    expect(ids(result.current.feed)).toEqual([3, 1]);
    expect(cached()).toBeUndefined();
    expect(ids(cached('title_unlocked,title_taken,title_revoked'))).toEqual([3, 1]);
  });

  it('första hämtningen som misslyckas ger isError utan flöde', async () => {
    serve(newsServer(rows(3)));
    api.getNews.mockResolvedValue({ success: false, error: 'down' });
    const { result } = renderHook(() => useNewsFeed(null), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 4000 });
    expect(result.current.feed).toBeUndefined();
    expect(result.current.error?.message).toBe('down');
  });

  it('enabled=false hämtar ingenting', async () => {
    const news = newsServer(rows(3));
    serve(news);
    renderHook(() => useNewsFeed(null, false), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(news.server.calls).toEqual([]);
  });
});

describe('useMarkNewsSeen — Mark all read', () => {
  const unreadFeed = () => [
    titleTaken(5), titleTaken(4), levelUp(3, 3),
    item('level_up', 2, { level: 9 }, { actor: ME }),
    titleTaken(1, {}, {}),
  ];

  async function setup(lastSeen: number | null = 0) {
    const news = newsServer(unreadFeed(), lastSeen);
    serve(news);
    const feed = renderHook(() => useNewsFeed(null), { wrapper });
    await waitFor(() => expect(feed.result.current.feed).toBeDefined());
    const seen = renderHook(() => useMarkNewsSeen(), { wrapper });
    return { news, feed, seen };
  }

  it('egna handlingar räknas inte som olästa (backend avgör — klienten litar på meta)', async () => {
    const { feed } = await setup();
    expect(feed.result.current.feed?.meta.unread_count).toBe(4);
  });

  it('POSTar högsta kända id, nollar räknaren optimistiskt och invaliderar (catch-up hämtar bara det nya)', async () => {
    const { news, feed, seen } = await setup();
    let resolveSeen: (value: unknown) => void = () => {};
    api.markNewsSeen.mockImplementationOnce((upTo?: number) => new Promise((resolve) => { resolveSeen = () => resolve(news.markNewsSeen(upTo)); }));

    act(() => seen.result.current.markAllRead());
    // Optimistiskt: svaret är inte här än men räknaren och raderna är redan lästa.
    await waitFor(() => expect(feed.result.current.feed?.meta.unread_count).toBe(0));
    expect(feed.result.current.feed?.items.every((row) => !row.is_unread)).toBe(true);
    expect(seen.result.current.isPending).toBe(true);

    await act(async () => { resolveSeen(undefined); });
    await waitFor(() => expect(seen.result.current.isPending).toBe(false));
    expect(news.server.seenCalls).toEqual([5]);
    await waitFor(() => expect(news.server.calls.at(-1)).toEqual({ after: 5, limit: 100, type: undefined }));
    expect(feed.result.current.feed?.meta.unread_count).toBe(0);
  });

  it('nya rader som hann komma före svaret förblir olästa (serverns räknare skriver över nollan)', async () => {
    const { news, feed, seen } = await setup();
    news.server.rows.unshift(levelUp(6, 6));
    act(() => seen.result.current.markAllRead());
    await waitFor(() => expect(seen.result.current.isPending).toBe(false));
    await waitFor(() => expect(feed.result.current.feed?.meta.unread_count).toBe(1));
    expect(ids(feed.result.current.feed)?.[0]).toBe(6);
    expect(feed.result.current.feed?.items[0].is_unread).toBe(true);
  });

  it('en poll i flykt när Mark all read trycks skriver aldrig tillbaka den gamla räknaren (avbruten hämtning skriver inte)', async () => {
    const { news, feed, seen } = await setup();
    const observed: number[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    // Svaret är räknat INNAN kvitteringen (4 olästa) men levereras efter den.
    api.getNews.mockImplementationOnce(async (query: never) => {
      const stale = await news.getNews(query);
      await gate;
      return stale;
    });

    let poll: Promise<unknown> = Promise.resolve();
    act(() => { poll = feed.result.current.refetch(); });
    act(() => seen.result.current.markAllRead());
    await waitFor(() => expect(seen.result.current.isPending).toBe(false));
    const unsubscribe = queryClient.getQueryCache().subscribe(() => observed.push(cached()?.meta.unread_count ?? -1));
    await act(async () => { release(); await poll.catch(() => {}); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    unsubscribe();

    expect(observed).not.toContain(4);
    expect(cached()?.meta.unread_count).toBe(0);
    expect(cached()?.items.some((row) => row.is_unread)).toBe(false);
  });

  it('fel: räknaren och raderna återställs och felet står kvar i error', async () => {
    const { news, feed, seen } = await setup();
    news.server.failNext = 'Failed to update news state';
    act(() => seen.result.current.markAllRead());
    await waitFor(() => expect(seen.result.current.error).toBe('Failed to update news state'));
    await waitFor(() => expect(feed.result.current.feed?.meta.unread_count).toBe(4));
    expect(feed.result.current.feed?.items.filter((row) => row.is_unread)).toHaveLength(4);
  });

  it('kvitterar flödet med alla typer även när ett filter är det som visas, och rör alla filtrerade cachar', async () => {
    const { news, feed, seen } = await setup();
    const filtered = renderHook(() => useNewsFeed(['level_up', 'run_milestone']), { wrapper });
    await waitFor(() => expect(filtered.result.current.feed).toBeDefined());
    expect(filtered.result.current.feed?.items.some((row) => row.is_unread)).toBe(true);

    act(() => seen.result.current.markAllRead());
    await waitFor(() => expect(filtered.result.current.feed?.items.every((row) => !row.is_unread)).toBe(true));
    expect(news.server.seenCalls).toEqual([5]);
    expect(feed.result.current.feed?.meta.unread_count).toBe(0);
  });

  it('inget flöde att kvittera → inget anrop', async () => {
    serve(newsServer([]));
    const seen = renderHook(() => useMarkNewsSeen(), { wrapper });
    act(() => seen.result.current.markAllRead());
    expect(api.markNewsSeen).not.toHaveBeenCalled();
  });
});
