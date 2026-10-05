import type { ActivityType, NewsItem, NewsMeta, NewsQuery, NewsUserRef } from '@runquest/shared';

// Testdata för Pack News: rader i API-formen (NewsItem ur @runquest/shared), med fasta klockslag.
// NOW = torsdag 2026-10-08 12:00 i Stockholm (CEST): idag = torsdag, igår = onsdag, "Earlier this week" = mån–tis.

export const NOW_ISO = '2026-10-08T10:00:00Z';
export const NOW = new Date(NOW_ISO);

export const ref = (id: string, name: string): NewsUserRef => ({ id, name, profile_picture: null });
export const ME = ref('u-me', 'Joel Lindberg');
export const KARL = ref('u-karl', 'Karl Persson');
export const ADAM = ref('u-adam', 'Adam Einstein');
export const NICK = ref('u-nick', 'Nicklas von Elling');
export const DAN = ref('u-dan', 'Daniel Lindblad Lüthje');

type ItemOf<T extends ActivityType> = Extract<NewsItem, { type: T }>;

/** `hoursAgo` räknas från NOW; id sätts av anroparen (flödet är sorterat på id). */
export const at = (hoursAgo: number): string => new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString();

export function item<T extends ActivityType>(
  type: T,
  id: number,
  payload: ItemOf<T>['payload'],
  over: Partial<Omit<ItemOf<T>, 'type' | 'payload' | 'id'>> = {},
): ItemOf<T> {
  return {
    id,
    type,
    occurred_at: at(1),
    payload_version: 1,
    actor: null,
    target: null,
    payload,
    is_backfill: false,
    is_unread: false,
    ...over,
  } as ItemOf<T>;
}

export const meta = (over: Partial<NewsMeta> = {}): NewsMeta => ({ unread_count: 0, last_seen_id: null, has_more: false, next_before: null, ...over });

export const titleTaken = (id: number, over: Partial<Omit<ItemOf<'title_taken'>, 'type' | 'payload' | 'id'>> = {}, payload: Partial<ItemOf<'title_taken'>['payload']> = {}) =>
  item('title_taken', id, {
    title_id: 't-longest', title_name: 'The Longest Run', metric_key: 'longestRun', value: 32.8, previous_value: 30, reason: 'overtaken', ...payload,
  }, { actor: KARL, target: ME, ...over });

export const levelUp = (id: number, level: number, over: Partial<Omit<ItemOf<'level_up'>, 'type' | 'payload' | 'id'>> = {}) =>
  item('level_up', id, { level }, { actor: KARL, ...over });

export const streakBroken = (id: number, over: Partial<Omit<ItemOf<'streak_broken'>, 'type' | 'payload' | 'id'>> = {}) =>
  item('streak_broken', id, { length: 27, last_run_date: '2026-10-05' }, { actor: DAN, ...over });

export const eventOpen = (id: number, over: Partial<Omit<ItemOf<'event_open'>, 'type' | 'payload' | 'id'>> = {}, payload: Partial<ItemOf<'event_open'>['payload']> = {}) =>
  item('event_open', id, {
    event_id: 'e-5k', event_type: 'participation', template_name: '5K Friday', icon: 'calendar', reward_xp: 25, ends_at: '2026-10-08T21:59:00Z', ...payload,
  }, over);

export const challengeWon = (id: number, over: Partial<Omit<ItemOf<'challenge_won'>, 'type' | 'payload' | 'id'>> = {}, payload: Partial<ItemOf<'challenge_won'>['payload']> = {}) =>
  item('challenge_won', id, {
    challenge_id: 'c1', tier: 'major', metric: 'km', duration_days: 7, winner_value: 44, loser_value: 38.2,
    winner_boost: { type: 'multiplier_days', delta: 0.2, duration: 4 }, loser_boost: { type: 'multiplier_days', delta: -0.1, duration: 4 }, ...payload,
  }, { actor: NICK, target: ME, ...over });

/**
 * En liten fake av GET /news + POST /news/seen med serverns semantik (ADR 008): id fallande, keyset `before`/`after` (båda → fel),
 * `type`-filter, has_more/next_before och oläst = id över vattenmärket, ej backfill, ej egen handling.
 * `calls` loggar frågorna så att tester kan se vilken sida klienten bad om.
 */
export function newsServer(initial: NewsItem[], lastSeen: number | null = null) {
  const server = {
    rows: [...initial].sort((a, b) => b.id - a.id),
    lastSeen,
    calls: [] as NewsQuery[],
    seenCalls: [] as Array<number | undefined>,
    failNext: null as string | null,
  };
  const isUnread = (row: NewsItem) => row.id > (server.lastSeen ?? 0) && !row.is_backfill && row.actor?.id !== ME.id;
  const unreadCount = () => server.rows.filter(isUnread).length;

  const getNews = async (query: NewsQuery = {}) => {
    server.calls.push(query);
    if (server.failNext) {
      const error = server.failNext;
      server.failNext = null;
      return { success: false as const, error };
    }
    if (query.before !== undefined && query.after !== undefined) return { success: false as const, error: 'before and after cannot be combined' };
    const types = query.type ? query.type.split(',') : null;
    const matching = server.rows.filter(
      (row) => (!types || types.includes(row.type)) && (query.before === undefined || row.id < query.before) && (query.after === undefined || row.id > query.after),
    );
    const limit = query.limit ?? 30;
    const page = matching.slice(0, limit);
    const hasMore = matching.length > limit;
    return {
      success: true as const,
      data: { items: page.map((row) => ({ ...row, is_unread: isUnread(row) })) },
      meta: { unread_count: unreadCount(), last_seen_id: server.lastSeen, has_more: hasMore, next_before: hasMore ? page[page.length - 1].id : null },
    };
  };

  const markNewsSeen = async (upToId?: number) => {
    server.seenCalls.push(upToId);
    if (server.failNext) {
      const error = server.failNext;
      server.failNext = null;
      return { success: false as const, error };
    }
    server.lastSeen = Math.max(server.lastSeen ?? 0, upToId ?? server.rows[0]?.id ?? 0);
    return { success: true as const, data: { last_seen_id: server.lastSeen, unread_count: unreadCount() } };
  };

  return { server, getNews, markNewsSeen };
}
