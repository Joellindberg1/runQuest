import {
  ACTIVITY_PAYLOAD_VERSION, ACTIVITY_TYPES, NEWS_DEFAULT_LIMIT, NEWS_MAX_LIMIT, UNREAD_CAP, customisedKeys, isActivityType, isNotifiable, resolveSettings, sanitizePatch,
  type ActivityType, type NewsItem, type NewsMeta, type NewsQuery, type NewsUserRef, type NotifiableRow, type NotifyViewer, type SettingsValue,
} from '@runquest/shared';

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

export type ItemOf<T extends ActivityType> = Extract<NewsItem, { type: T }>;

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
    payload_version: ACTIVITY_PAYLOAD_VERSION,
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

/** `previous_tier: null` = första tiern i serien ("earned"); annars "evolved" från den gamla tiern. */
export const badgeEarned = (id: number, over: Partial<Omit<ItemOf<'badge_earned'>, 'type' | 'payload' | 'id'>> = {}, payload: Partial<ItemOf<'badge_earned'>['payload']> = {}) =>
  item('badge_earned', id, { series: 'streak_keeper', tier: 1, previous_tier: null, ...payload }, { actor: KARL, ...over });

export const streakBroken =(id: number, over: Partial<Omit<ItemOf<'streak_broken'>, 'type' | 'payload' | 'id'>> = {}) =>
  item('streak_broken', id, { length: 27, last_run_date: '2026-10-05' }, { actor: DAN, ...over });

export const eventOpen = (id: number, over: Partial<Omit<ItemOf<'event_open'>, 'type' | 'payload' | 'id'>> = {}, payload: Partial<ItemOf<'event_open'>['payload']> = {}) =>
  item('event_open', id, {
    event_id: 'e-5k', event_type: 'participation', template_name: '5K Friday', icon: 'calendar', reward_xp: 25, ends_at: '2026-10-08T21:59:00Z', ...payload,
  }, over);

/** Systemhändelse (RUN-161): ingen aktör, ingen target. */
export const releasePublished = (id: number, over: Partial<Omit<ItemOf<'release_published'>, 'type' | 'payload' | 'id'>> = {}, payload: Partial<ItemOf<'release_published'>['payload']> = {}) =>
  item('release_published', id, { version: '0.6.1', title: 'News about releases', ...payload }, over);

export const challengeWon = (id: number, over: Partial<Omit<ItemOf<'challenge_won'>, 'type' | 'payload' | 'id'>> = {}, payload: Partial<ItemOf<'challenge_won'>['payload']> = {}) =>
  item('challenge_won', id, {
    challenge_id: 'c1', tier: 'major', metric: 'km', duration_days: 7, winner_value: 44, loser_value: 38.2,
    winner_boost: { type: 'multiplier_days', delta: 0.2, duration: 4 }, loser_boost: { type: 'multiplier_days', delta: -0.1, duration: 4 }, ...payload,
  }, { actor: NICK, target: ME, ...over });

/** Karl går förbi mig (aktör = den som passerar, target = den som passeras); rangerna är EFTER passeringen. */
export const rankPassed = (id: number, over: Partial<Omit<ItemOf<'rank_passed'>, 'type' | 'payload' | 'id'>> = {}, payload: Partial<ItemOf<'rank_passed'>['payload']> = {}) =>
  item('rank_passed', id, { measure: 'xp', passer_rank: 2, passed_rank: 3, ...payload }, { actor: KARL, target: ME, ...over });

/** Karl (motståndaren) accepterade min utmaning; den börjar dagen efter NOW. */
export const challengeAccepted = (id: number, over: Partial<Omit<ItemOf<'challenge_accepted'>, 'type' | 'payload' | 'id'>> = {}, payload: Partial<ItemOf<'challenge_accepted'>['payload']> = {}) =>
  item('challenge_accepted', id, { challenge_id: 'c1', tier: 'major', metric: 'km', duration_days: 7, start_date: '2026-10-09', ...payload }, { actor: KARL, target: ME, ...over });

/** Registreringstiden för betraktaren i newsServer: långt före alla rader (rader före den är aldrig notiser). */
export const VIEWER_CREATED_AT = '2026-01-01T00:00:00Z';

const isPositiveInt = (value: number | undefined): boolean => value === undefined || (Number.isSafeInteger(value) && value > 0);

/** Serverns validering av GET /news (backend routes/news.ts) med samma felmeddelanden; null = giltig fråga. */
function invalidQuery(query: NewsQuery): string | null {
  if (query.limit !== undefined && (!isPositiveInt(query.limit) || query.limit > NEWS_MAX_LIMIT)) return `limit must be an integer between 1 and ${NEWS_MAX_LIMIT}`;
  if (!isPositiveInt(query.before)) return 'before must be a positive integer';
  if (!isPositiveInt(query.after)) return 'after must be a positive integer';
  if (query.before !== undefined && query.after !== undefined) return 'before and after cannot be combined';
  if (query.type !== undefined) {
    const parts = query.type.split(',').map((t) => t.trim());
    if (parts.some((t) => !isActivityType(t))) return `type must be a comma-separated list of: ${ACTIVITY_TYPES.join(', ')}`;
  }
  return null;
}

/**
 * En liten fake av GET /news, POST /news/seen, POST /news/read och GET/PUT /settings med serverns semantik (ADR 008 och ADR 011): id fallande,
 * keyset `before`/`after` (båda → fel), `type`-filter, has_more/next_before. Oläst avgörs av samma `isNotifiable` som servern (golv, kvitterade
 * rader, backfill, egna handlingar, påslaget slag), mättat vid 500. Inställningarna lagras glest (`server.settings`) och löses upp med shared.
 * `calls` loggar frågorna så att tester kan se vilken sida klienten bad om; `readCalls` och `settingsCalls` loggar skrivningarna.
 * `involves=me` filtreras som servern (RUN-188): aktör, target eller deltagare i ett event (payload.entrant_ids); unread_count gäller hela flödet och rör sig inte med filtret.
 * Frågeparametrarna valideras som servern (limit 1–100, before/after positiva heltal, type ur ACTIVITY_TYPES): en fråga servern avvisar avvisas även här.
 * Paritetstestet i backend (`newsFakeParity.test.ts`) kör samma rader genom den riktiga rutten och den här fejken och kräver identiska svar.
 * `viewerId` är den som tittar (default ME); backendens involves=me kräver ett riktigt UUID, så paritetstestet skickar ett.
 */
export function newsServer(initial: NewsItem[], lastSeen: number | null = null, viewerId: string = ME.id) {
  const server = {
    rows: [...initial].sort((a, b) => b.id - a.id),
    lastSeen,
    calls: [] as Array<NewsQuery>,
    seenCalls: [] as Array<number | undefined>,
    readCalls: [] as number[][],
    /** news_read(U) ovanför golvet. */
    readIds: new Set<number>(),
    /** Lagrade (glesa) inställningar. */
    settings: {} as Record<string, SettingsValue>,
    settingsGets: 0,
    settingsCalls: [] as Array<Record<string, SettingsValue | null>>,
    failNext: null as string | null,
    /** Nästa PUT /settings skriver men svarar ändå 500 (återläsningen föll). */
    failPutAfterWrite: false,
  };
  const viewer = (): NotifyViewer => ({
    id: viewerId,
    createdAt: VIEWER_CREATED_AT,
    floor: server.lastSeen,
    readIds: server.readIds,
    settings: server.settings,
  });
  const asNotifiable = (row: NewsItem): NotifiableRow => ({
    id: row.id,
    type: row.type,
    actorId: row.actor?.id ?? null,
    targetId: row.target?.id ?? null,
    payload: row.payload,
    isBackfill: row.is_backfill,
    createdAt: row.occurred_at,
  });
  const isUnread = (row: NewsItem) => isNotifiable(asNotifiable(row), viewer());
  const unreadCount = () => Math.min(UNREAD_CAP, server.rows.filter(isUnread).length);
  const takeFailure = () => {
    const error = server.failNext;
    server.failNext = null;
    return error;
  };

  const getNews = async (query: NewsQuery = {}) => {
    server.calls.push(query);
    if (server.failNext) {
      const error = server.failNext;
      server.failNext = null;
      return { success: false as const, error };
    }
    const invalid = invalidQuery(query);
    if (invalid) return { success: false as const, error: invalid };
    const types = query.type !== undefined ? query.type.split(',').map((t) => t.trim()) : null;
    const involvesViewer = (row: NewsItem) => {
      const payload = row.payload as { entrant_ids?: unknown; runner_up_user_id?: unknown };
      return row.actor?.id === viewerId || row.target?.id === viewerId
        || (row.type === 'event_closed' && Array.isArray(payload.entrant_ids) && payload.entrant_ids.includes(viewerId))
        || (row.type === 'title_taken' && payload.runner_up_user_id === viewerId);
    };
    const matching = server.rows.filter(
      (row) =>
        (!types || types.includes(row.type)) &&
        (query.involves !== 'me' || involvesViewer(row)) &&
        (query.before === undefined || row.id < query.before) &&
        (query.after === undefined || row.id > query.after),
    );
    const limit = query.limit ?? NEWS_DEFAULT_LIMIT;
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

  /** Id:n som inte finns eller ligger på/under golvet ignoreras tyst (som servern); svaret är olästa efter kvitteringen. */
  const markNewsRead = async (ids: number[]) => {
    server.readCalls.push(ids);
    const error = takeFailure();
    if (error) return { success: false as const, error };
    // Som backendens parseReadIds: 1-50 unika positiva heltal, annars 400 (ett för stort eller dubblerat anrop får inte slinka igenom i testerna).
    const valid = ids.length >= 1 && ids.length <= 50 && ids.every((id) => Number.isSafeInteger(id) && id > 0) && new Set(ids).size === ids.length;
    if (!valid) return { success: false as const, error: 'ids must be 1 to 50 unique positive integers' };
    for (const id of ids) {
      if (id > (server.lastSeen ?? 0) && server.rows.some((row) => row.id === id)) server.readIds.add(id);
    }
    return { success: true as const, data: { unread_count: unreadCount() } };
  };

  const settingsState = () => ({
    success: true as const,
    data: { values: resolveSettings(server.settings, 'user') },
    meta: { customised: customisedKeys(server.settings, 'user') },
  });

  const getSettings = async () => {
    server.settingsGets += 1;
    const error = takeFailure();
    if (error) return { success: false as const, error };
    return settingsState();
  };

  const putSettings = async (values: Record<string, SettingsValue | null>) => {
    server.settingsCalls.push(values);
    const error = takeFailure();
    if (error) return { success: false as const, error };
    const patch = sanitizePatch({ values }, 'user');
    if (!patch.ok) return { success: false as const, error: patch.error };
    Object.assign(server.settings, patch.set);
    for (const key of patch.reset) delete server.settings[key];
    if (server.failPutAfterWrite) {
      server.failPutAfterWrite = false;
      return { success: false as const, error: 'Failed to save settings' };
    }
    return settingsState();
  };

  return { server, getNews, markNewsSeen, markNewsRead, getSettings, putSettings };
}
