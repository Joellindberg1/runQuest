import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ME, item, levelUp, newsServer, titleTaken } from '../news.fixture';
import { NEWS_QUERY_KEYS, useMarkNewsRead, useMarkNewsSeen, useNewsFeed } from './useNewsQueries';
import { READ_FLUSH_MS, type NewsFeed } from '../newsModel';

const api = vi.hoisted(() => ({ getNews: vi.fn(), markNewsSeen: vi.fn(), markNewsRead: vi.fn() }));
vi.mock('@/shared/services/backendApi', () => ({ backendApi: api }));

const rows = (count: number, from = 1) => Array.from({ length: count }, (_, index) => levelUp(from + index, from + index));

let queryClient: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
const cached = (typeParam?: string) => queryClient.getQueryData<NewsFeed>(NEWS_QUERY_KEYS.feed(typeParam));
const ids = (feed?: NewsFeed) => feed?.items.map((row) => row.id);

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: Infinity } } });
  api.getNews.mockReset();
  api.markNewsSeen.mockReset();
  api.markNewsRead.mockReset();
});

// Observern meddelar i en egen tick efter act(): vänta in den innan resultatet läses.
async function refetch(result: { current: { refetch: () => Promise<unknown> } }) {
  await act(async () => { await result.current.refetch(); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
}

function serve(server: ReturnType<typeof newsServer>) {
  api.getNews.mockImplementation(server.getNews);
  api.markNewsSeen.mockImplementation(server.markNewsSeen);
  api.markNewsRead.mockImplementation(server.markNewsRead);
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

  describe('fokus ersätter den nyaste sidan (retractade rader läker vid fokus, inte vid poll)', () => {
    const OLD = 60_000;
    const agePast = (typeParam?: string) => {
      const data = cached(typeParam);
      queryClient.setQueryData(NEWS_QUERY_KEYS.feed(typeParam), data, { updatedAt: Date.now() - OLD });
    };
    const focus = async () => {
      await act(async () => { window.dispatchEvent(new Event('focus')); });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    };

    it('en rad som backend tagit bort (retract) försvinner vid fokus men ligger kvar efter en vanlig poll', async () => {
      const news = newsServer(rows(10));
      serve(news);
      const { result } = renderHook(() => useNewsFeed(null), { wrapper });
      await waitFor(() => expect(result.current.feed).toBeDefined());

      news.server.rows = news.server.rows.filter((row) => row.id !== 7);
      await refetch(result); // poll = catch-up: tar aldrig bort
      expect(ids(result.current.feed)).toContain(7);

      agePast();
      await focus();
      expect(ids(result.current.feed)).not.toContain(7);
      expect(result.current.feed?.items).toHaveLength(9);
    });

    it('rader äldre än första sidan behålls, och räknaren följer sidan', async () => {
      const news = newsServer(rows(45));
      serve(news);
      const { result } = renderHook(() => useNewsFeed(null), { wrapper });
      await waitFor(() => expect(result.current.feed).toBeDefined());
      act(() => result.current.loadMore());
      await waitFor(() => expect(result.current.feed?.items).toHaveLength(45));

      news.server.rows = news.server.rows.filter((row) => row.id !== 40);
      news.server.lastSeen = 30;
      agePast();
      await focus();
      expect(result.current.feed?.items).toHaveLength(44);
      expect(ids(result.current.feed)).not.toContain(40);
      expect(ids(result.current.feed)).toContain(1);
      expect(result.current.feed?.meta.unread_count).toBe(14);
    });

    it('nyligen hämtat flöde: ingen ny hämtning vid fokus; flera observers delar EN hämtning', async () => {
      const news = newsServer(rows(10));
      serve(news);
      const a = renderHook(() => useNewsFeed(null), { wrapper });
      const b = renderHook(() => useNewsFeed(null), { wrapper });
      await waitFor(() => expect(a.result.current.feed).toBeDefined());
      await waitFor(() => expect(b.result.current.feed).toBeDefined());
      const callsBefore = news.server.calls.length;

      await focus();
      expect(news.server.calls).toHaveLength(callsBefore);

      agePast();
      await focus();
      expect(news.server.calls).toHaveLength(callsBefore + 1);
    });
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

describe('useNewsFeed — involves', () => {
  it('involves=me skickas på varje hämtning och flödet får en egen cache vid sidan av det vanliga', async () => {
    const news = newsServer(rows(3));
    serve(news);
    const { result } = renderHook(() => useNewsFeed(null, true, 'me'), { wrapper });
    await waitFor(() => expect(result.current.feed).toBeDefined());

    expect(news.server.calls).toEqual([{ limit: 30, type: undefined, involves: 'me' }]);
    expect(NEWS_QUERY_KEYS.feed(undefined, 'me')).not.toEqual(NEWS_QUERY_KEYS.feed(undefined));
    expect(queryClient.getQueryData(NEWS_QUERY_KEYS.feed(undefined, 'me'))).toBeDefined();
    expect(cached()).toBeUndefined();

    // Catch-up bär samma filter.
    news.server.rows.unshift(levelUp(4, 4));
    await refetch(result);
    expect(news.server.calls.at(-1)).toEqual({ after: 3, limit: 100, type: undefined, involves: 'me' });
  });

  it('utan involves ser frågorna ut som förut', async () => {
    const news = newsServer(rows(3));
    serve(news);
    const { result } = renderHook(() => useNewsFeed(null), { wrapper });
    await waitFor(() => expect(result.current.feed).toBeDefined());
    expect(news.server.calls).toEqual([{ limit: 30, type: undefined }]);
    expect(NEWS_QUERY_KEYS.feed(undefined)).toEqual(['news', 'feed', 'all']);
  });
});

describe('useMarkNewsRead — läst per rad', () => {
  const FILTER = ['level_up', 'run_milestone'] as const;
  const LEVELS_KEY = 'level_up,run_milestone';
  const wait = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
  const unreadIds = (feed?: NewsFeed) => feed?.items.filter((row) => row.is_unread).map((row) => row.id);

  // 5, 4, 3 är olästa level_up från Karl, 2 en oläst titelrad, 1 är egen (aldrig oläst).
  const unreadFeed = () => [levelUp(5, 5), levelUp(4, 4), levelUp(3, 3), titleTaken(2), item('level_up', 1, { level: 9 }, { actor: ME })];

  async function setup() {
    const news = newsServer(unreadFeed(), 0);
    serve(news);
    const all = renderHook(() => useNewsFeed(null), { wrapper });
    const levels = renderHook(() => useNewsFeed(FILTER), { wrapper });
    const titles = renderHook(() => useNewsFeed(['title_taken']), { wrapper });
    await waitFor(() => expect(all.result.current.feed && levels.result.current.feed && titles.result.current.feed).toBeTruthy());
    const read = renderHook(() => useMarkNewsRead(), { wrapper });
    return { news, all, levels, titles, read };
  }

  it('flera gester inom 300 ms ger ett enda POST /news/read', async () => {
    const { news, all, levels, titles, read } = await setup();
    expect(all.result.current.feed?.meta.unread_count).toBe(4);

    act(() => read.result.current.markRead(5));
    act(() => read.result.current.markRead(4));
    act(() => read.result.current.markRead(5));

    // Direkt (i cachen, innan observatörerna hunnit rendera): raderna är lästa och räknaren lägre i ALLA cachar, även den filtrerade som
    // inte innehåller raderna. Inget anrop har gått än.
    expect(unreadIds(cached())).toEqual([3, 2]);
    expect(unreadIds(cached(LEVELS_KEY))).toEqual([3]);
    expect(unreadIds(cached('title_taken'))).toEqual([2]);
    for (const typeParam of [undefined, LEVELS_KEY, 'title_taken']) expect(cached(typeParam)?.meta.unread_count).toBe(2);
    expect(api.markNewsRead).not.toHaveBeenCalled();
    await waitFor(() => expect(levels.result.current.feed?.meta.unread_count).toBe(2));
    expect(unreadIds(titles.result.current.feed)).toEqual([2]);

    // Ett enda anrop efter READ_FLUSH_MS med båda id:n (dubbletten är bortslagen).
    await waitFor(() => expect(news.server.readCalls).toEqual([[5, 4]]), { timeout: READ_FLUSH_MS * 4 });
    await wait(10);
    expect(cached()?.meta.unread_count).toBe(2);
  });

  it('serverns unread_count skriver över den lokala räknaren i alla cachar', async () => {
    const { news, read } = await setup();
    act(() => read.result.current.markRead(5));
    expect(cached()?.meta.unread_count).toBe(3);

    // En ny rad hann komma innan anropet nådde servern: 4, 3, 2 och 6 är olästa.
    news.server.rows.unshift(levelUp(6, 6));
    await waitFor(() => expect(cached()?.meta.unread_count).toBe(4), { timeout: READ_FLUSH_MS * 4 });
    expect(cached(LEVELS_KEY)?.meta.unread_count).toBe(4);
    // Raden den kvitterade är fortsatt läst.
    expect(unreadIds(cached())).toEqual([4, 3, 2]);
  });

  it('avmontering tömmer bunten', async () => {
    const { news, read } = await setup();
    act(() => read.result.current.markRead(5));
    act(() => read.result.current.markRead(3));
    expect(api.markNewsRead).not.toHaveBeenCalled();

    read.unmount();
    // Direkt, utan att vänta ut READ_FLUSH_MS.
    expect(news.server.readCalls).toEqual([[5, 3]]);
    await waitFor(() => expect(news.server.readIds).toEqual(new Set([5, 3])));
    expect(unreadIds(cached())).toEqual([4, 2]);
  });

  it('räknaren minskar direkt och ett fel återställer tyst', async () => {
    const { news, read } = await setup();
    news.server.failNext = 'Failed to update news state';
    act(() => read.result.current.markRead(5));
    act(() => read.result.current.markRead(4));
    // Direkt, innan anropet gått: raderna är lästa och räknaren lägre i alla cachar.
    expect(unreadIds(cached())).toEqual([3, 2]);
    for (const typeParam of [undefined, LEVELS_KEY, 'title_taken']) expect(cached(typeParam)?.meta.unread_count).toBe(2);
    expect(api.markNewsRead).not.toHaveBeenCalled();

    // Cachen är sanningen; hookarnas resultat hinner efter en tick.
    await waitFor(() => expect(unreadIds(cached())).toEqual([5, 4, 3, 2]), { timeout: READ_FLUSH_MS * 4 });
    expect(cached()?.meta.unread_count).toBe(4);
    expect(unreadIds(cached(LEVELS_KEY))).toEqual([5, 4, 3]);
    expect(cached(LEVELS_KEY)?.meta.unread_count).toBe(4);
    expect(cached('title_taken')?.meta.unread_count).toBe(4);
    // Tyst: hooken har inget fel att visa.
    expect(Object.keys(read.result.current)).toEqual(['markRead']);

    act(() => read.result.current.markRead(5));
    await waitFor(() => expect(news.server.readCalls).toEqual([[5, 4], [5]]), { timeout: READ_FLUSH_MS * 4 });
    expect(unreadIds(cached())).toEqual([4, 3, 2]);
  });

  it('rader som inte är olästa ger inget anrop (egna, okända id:n och redan lästa)', async () => {
    const { news, all, read } = await setup();
    act(() => read.result.current.markRead(1)); // egen handling: aldrig oläst
    act(() => read.result.current.markRead(999)); // finns inte i något flöde
    await wait(READ_FLUSH_MS + 50);
    expect(api.markNewsRead).not.toHaveBeenCalled();
    expect(all.result.current.feed?.meta.unread_count).toBe(4);

    act(() => read.result.current.markRead(5));
    await waitFor(() => expect(news.server.readCalls).toEqual([[5]]), { timeout: READ_FLUSH_MS * 4 });
    // Nu är raden läst: en ny gest på den gör inget.
    act(() => read.result.current.markRead(5));
    await wait(READ_FLUSH_MS + 50);
    expect(news.server.readCalls).toEqual([[5]]);
  });

  it('mer än 50 olästa i ett svep går i flera anrop med högst 50 id vardera', async () => {
    const news = newsServer(rows(120), 0);
    serve(news);
    const all = renderHook(() => useNewsFeed(null), { wrapper });
    await waitFor(() => expect(all.result.current.feed).toBeDefined());
    act(() => all.result.current.loadMore());
    await waitFor(() => expect(all.result.current.feed?.items.length).toBe(60));
    const read = renderHook(() => useMarkNewsRead(), { wrapper });

    const loaded = all.result.current.feed?.items.map((row) => row.id) ?? [];
    act(() => loaded.forEach((id) => read.result.current.markRead(id)));
    read.unmount();
    expect(news.server.readCalls.map((ids) => ids.length)).toEqual([50, 10]);
  });

  it('en poll i flykt när en rad kvitteras skriver inte tillbaka den gamla räknaren', async () => {
    const { news, all, read } = await setup();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    // Svaret är räknat INNAN kvitteringen (4 olästa) men levereras efter den.
    api.getNews.mockImplementationOnce(async (query: never) => {
      const stale = await news.getNews(query);
      await gate;
      return stale;
    });

    let poll: Promise<unknown> = Promise.resolve();
    act(() => { poll = all.result.current.refetch(); });
    act(() => read.result.current.markRead(5));
    await act(async () => { release(); await poll.catch(() => {}); });
    await wait(30);
    expect(unreadIds(cached())).toEqual([4, 3, 2]);
    expect(cached()?.meta.unread_count).toBe(3);
  });
});

describe('useNewsFeed — involves i Show more och fokusuppdatering', () => {
  it('Show more bär involves', async () => {
    const news = newsServer(rows(80), 0);
    serve(news);
    const { result } = renderHook(() => useNewsFeed(null, true, 'me'), { wrapper });
    await waitFor(() => expect(result.current.feed).toBeDefined());

    act(() => result.current.loadMore());
    await waitFor(() => expect(news.server.calls).toHaveLength(2));
    expect(news.server.calls.at(-1)).toMatchObject({ before: 51, involves: 'me' });
  });

  it('fokusuppdateringen bär involves', async () => {
    const news = newsServer(rows(2), 0);
    serve(news);
    const { result } = renderHook(() => useNewsFeed(null, true, 'me'), { wrapper });
    await waitFor(() => expect(result.current.feed).toBeDefined());
    const key = NEWS_QUERY_KEYS.feed(undefined, 'me');
    queryClient.setQueryData(key, queryClient.getQueryData(key), { updatedAt: Date.now() - 60_000 });

    act(() => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(news.server.calls).toHaveLength(2));
    expect(news.server.calls.at(-1)).toMatchObject({ involves: 'me' });
  });
});

describe('useMarkNewsRead — kantfall', () => {
  const wait = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
  const unreadIds = (feed?: NewsFeed) => feed?.items.filter((row) => row.is_unread).map((row) => row.id);
  const base = () => [levelUp(5, 5), levelUp(4, 4), levelUp(3, 3), titleTaken(2), item('level_up', 1, { level: 9 }, { actor: ME })];

  async function setup(initial = base()) {
    const news = newsServer(initial, 0);
    serve(news);
    const all = renderHook(() => useNewsFeed(null), { wrapper });
    const involves = renderHook(() => useNewsFeed(null, true, 'me'), { wrapper });
    await waitFor(() => expect(all.result.current.feed && involves.result.current.feed).toBeTruthy());
    const read = renderHook(() => useMarkNewsRead(), { wrapper });
    return { news, all, involves, read };
  }

  /** Varje POST blir ett väntande svar som testet släpper själv. */
  function holdReads() {
    const held: Array<{ ids: number[]; resolve: (response: unknown) => void }> = [];
    api.markNewsRead.mockImplementation((ids: number[]) => new Promise((resolve) => { held.push({ ids, resolve }); }));
    return held;
  }

  it('flödet för "Involves me" uppdateras som de andra', async () => {
    const { read } = await setup();
    act(() => read.result.current.markRead(5));
    expect(unreadIds(cached(undefined))).toEqual([4, 3, 2]);
    expect(unreadIds(queryClient.getQueryData<NewsFeed>(NEWS_QUERY_KEYS.feed(undefined, 'me')))).toEqual([4, 3, 2]);
    expect(queryClient.getQueryData<NewsFeed>(NEWS_QUERY_KEYS.feed(undefined, 'me'))?.meta.unread_count).toBe(3);
  });

  it('räknaren går aldrig under noll, inte ens när cachen har ett inaktuellt 0', async () => {
    const { read } = await setup();
    queryClient.setQueryData<NewsFeed>(NEWS_QUERY_KEYS.feed(undefined), (feed) => (feed ? { ...feed, meta: { ...feed.meta, unread_count: 0 } } : feed));
    act(() => read.result.current.markRead(5));
    expect(cached()?.meta.unread_count).toBe(0);
    expect(unreadIds(cached())).toEqual([4, 3, 2]);
  });

  it('en backfill-rad som cachen flaggar som oläst ger inget anrop och ingen ändring', async () => {
    const { read } = await setup();
    queryClient.setQueryData<NewsFeed>(NEWS_QUERY_KEYS.feed(undefined), (feed) => (
      feed ? { ...feed, items: [{ ...levelUp(9, 9), is_backfill: true, is_unread: true }, ...feed.items] } : feed
    ));
    act(() => read.result.current.markRead(9));
    await wait(READ_FLUSH_MS + 50);
    expect(api.markNewsRead).not.toHaveBeenCalled();
    expect(cached()?.items[0].is_unread).toBe(true);
    expect(cached()?.meta.unread_count).toBe(4);
  });

  it('ett avstängt notisslag ger inget anrop (raden är inte oläst)', async () => {
    const news = newsServer(base(), 0);
    news.server.settings = { 'notify.level_up_others': false };
    serve(news);
    const all = renderHook(() => useNewsFeed(null), { wrapper });
    await waitFor(() => expect(all.result.current.feed).toBeDefined());
    expect(unreadIds(cached())).toEqual([2]);

    const read = renderHook(() => useMarkNewsRead(), { wrapper });
    act(() => read.result.current.markRead(5));
    await wait(READ_FLUSH_MS + 50);
    expect(api.markNewsRead).not.toHaveBeenCalled();
  });

  it('serverns räknare gäller inte medan nästa id väntar i bunten', async () => {
    const { news, read } = await setup();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    api.markNewsRead.mockImplementation(async (ids: number[]) => {
      const response = await news.markNewsRead(ids);
      await gate;
      return response;
    });
    act(() => read.result.current.markRead(5));
    await wait(READ_FLUSH_MS + 30); // första anropet är i flykt
    act(() => read.result.current.markRead(4)); // väntar i bunten
    expect(cached()?.meta.unread_count).toBe(2);

    release(); // första svaret: servern har bara 5 kvitterad och räknar 3
    await wait(20);
    expect(cached()?.meta.unread_count).toBe(2);
  });

  it('serverns räknare gäller inte medan ett annat anrop är på väg, men det sista svaret avgör', async () => {
    const { news, read } = await setup();
    const held = holdReads();
    act(() => read.result.current.markRead(5));
    await wait(READ_FLUSH_MS + 30);
    act(() => read.result.current.markRead(4));
    await wait(READ_FLUSH_MS + 30);
    expect(held.map((call) => call.ids)).toEqual([[5], [4]]);

    // Första svaret: servern räknar 3 (bara 5 är kvitterad) men anrop 2 är på väg, så den lokala 2:an står kvar.
    const first = await news.markNewsRead([5]);
    await act(async () => held[0].resolve(first));
    await wait(10);
    expect(cached()?.meta.unread_count).toBe(2);

    const second = await news.markNewsRead([4]);
    await act(async () => held[1].resolve(second));
    await wait(10);
    expect(cached()?.meta.unread_count).toBe(2);
    expect(unreadIds(cached())).toEqual([3, 2]);
  });

  it.each(['fail-first', 'success-first'])('anrop 1 misslyckas medan anrop 2 är på väg (%s): räknaren och raderna stämmer med servern', async (order) => {
    const { news, read } = await setup();
    const held = holdReads();
    act(() => read.result.current.markRead(5));
    await wait(READ_FLUSH_MS + 30);
    act(() => read.result.current.markRead(4));
    await wait(READ_FLUSH_MS + 30);
    expect(cached()?.meta.unread_count).toBe(2);

    const succeed = async () => {
      const response = await news.markNewsRead(held[1].ids);
      await act(async () => held[1].resolve(response));
    };
    const fail = async () => { await act(async () => held[0].resolve({ success: false, error: 'x' })); };
    if (order === 'fail-first') {
      await fail();
      await wait(10);
      await succeed();
    } else {
      await succeed();
      await wait(10);
      await fail();
    }
    await wait(20);
    // 5 är olästa igen, 4 är kvitterad: tre olästa (5, 3, 2).
    expect({ count: cached()?.meta.unread_count, unread: unreadIds(cached()) }).toEqual({ count: 3, unread: [5, 3, 2] });
  });

  it('en första laddning av ett annat flöde avbryts inte av en kvittering och blir klar', async () => {
    const { news, read } = await setup();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    api.getNews.mockImplementation(async (query: never) => {
      await gate;
      return news.getNews(query);
    });
    const levels = renderHook(() => useNewsFeed(['level_up']), { wrapper });
    await wait(10);
    expect(levels.result.current.isLoading).toBe(true);

    act(() => read.result.current.markRead(5));
    await wait(10);
    release();
    await wait(100);
    expect({ loading: levels.result.current.isLoading, hasFeed: !!levels.result.current.feed, fetching: levels.result.current.isFetching })
      .toEqual({ loading: false, hasFeed: true, fetching: false });
  });
});
