/**
 * Paritet mellan frontendens fejkade news-server (`newsServer` i apps/frontend/src/features/news/news.fixture.ts) och den riktiga
 * GET /api/news. Frontendens tester kör mot fejken; ändras serverns svar (nytt fält, ny aktivitetstyp, ändrad filtrering) utan att
 * fejken följer med är de gröna fast appen går sönder. Det här testet skickar SAMMA rader genom den riktiga rutten (mot fakeDb) och
 * genom fejken och kräver identiska svar, så att en avvikelse fäller CI här.
 *
 * Testet bor i backend eftersom rutten bara går att köra här; det importerar enbart fixturen (som bara beror på @runquest/shared).
 * Ena sidan av jämförelsen får aldrig ha en egen kopia av regeln: typlistan är ACTIVITY_TYPES, oläst-predikatet är isNotifiable
 * (båda ur shared) och exemplen (`newsSamples`) är en uttömmande karta över ACTIVITY_TYPES.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { ACTIVITY_PAYLOAD_VERSION, ACTIVITY_TYPES, NEWS_ITEM_FIELDS, NEWS_META_FIELDS, UNREAD_CAP, notifyKey, type ActivityType, type NewsItem, type NewsQuery, type NewsUserRef } from '@runquest/shared';
import { getSupabaseClient } from '../../config/database.js';
import app from '../../app.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';
import { item, newsServer, titleTaken } from '../../../../frontend/src/features/news/news.fixture';
import { newsSamples } from '../../../../frontend/src/features/news/news.samples.fixture';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });
afterEach(() => { vi.clearAllMocks(); });

// Backendens involves-filter interpolerar användar-id:t i ett PostgREST-filter och kräver riktiga UUID:n.
const ME: NewsUserRef = { id: '11111111-1111-4111-8111-111111111111', name: 'Joel Lindberg', profile_picture: null };
const KARL: NewsUserRef = { id: '22222222-2222-4222-8222-222222222222', name: 'Karl Persson', profile_picture: 'karl.png' };
const USER_CREATED = '2026-01-01T00:00:00.000Z';
const GROUP = 'g1';

/** Tre varianter per typ (ingen/annan aktör, jag som target, jag som aktör) så att filter och klassificering får något att skilja på. */
const variants: Array<Pick<NewsItem, 'actor' | 'target'>> = [
  { actor: KARL, target: null },
  { actor: KARL, target: ME },
  { actor: ME, target: KARL },
];

const titleTakenRunnerUp = (id: number, runnerUp: string): NewsItem => titleTaken(id, { actor: KARL, target: null }, { runner_up_user_id: runnerUp });

function buildFeed(): NewsItem[] {
  let id = 0;
  const rows: NewsItem[] = [];
  for (const type of ACTIVITY_TYPES) {
    for (const over of variants) rows.push((newsSamples[type] as (id: number, over: unknown) => NewsItem)(++id, over));
  }
  const closed = (entrants: string[]) =>
    item('event_closed', ++id, { event_id: 'e', event_type: 'participation', template_name: '10K', participants: entrants.length, members: 5, entrant_ids: entrants }, { actor: null });
  rows.push(closed([ME.id, KARL.id]), closed([KARL.id]));
  // Låg tvåa: jag (respektive Karl) är bara runner_up_user_id, varken aktör eller target.
  rows.push(...[ME.id, KARL.id].map((runnerUp) => titleTakenRunnerUp(++id, runnerUp)));
  rows.push(newsSamples.level_up(++id, { actor: KARL, is_backfill: true }));
  rows.push(newsSamples.level_up(++id, { actor: KARL, occurred_at: '2025-12-01T10:00:00.000Z' }));
  return rows;
}

const toDbRow = (row: NewsItem, createdAt?: string): Row => ({
  id: row.id, group_id: GROUP, type: row.type, actor_user_id: row.actor?.id ?? null, target_user_id: row.target?.id ?? null,
  // payload_version läses INTE ur fejkens rad: saknar fejken fältet ska den riktiga rutten ändå skicka det, så att jämförelsen faller.
  payload: row.payload, payload_version: ACTIVITY_PAYLOAD_VERSION, dedupe_key: `k${row.id}`, is_backfill: row.is_backfill,
  // Backend avgör "efter registreringen" på activity_log.created_at. NewsItem har inget created_at, så det är occurred_at om raden inte
  // anges i World.createdAt (en rad som hände före registreringen men loggades efter); samma värde går då till fejken.
  occurred_at: row.occurred_at, created_at: createdAt ?? row.occurred_at,
});

interface World {
  feed: NewsItem[];
  lastSeen?: number | null;
  readIds?: number[];
  settings?: Record<string, boolean>;
  /** activity_log.created_at per rad-id, för rader som loggades senare än de hände. */
  createdAt?: Record<number, string>;
}

/** Bygger samma värld åt båda sidor: riktiga rutten mot fakeDb, och fejken. `tables` är databasens läge, som rutterna skriver i. */
function useWorld({ feed, lastSeen = null, readIds = [], settings = {}, createdAt = {} }: World) {
  const refs = new Map<string, NewsUserRef>([[ME.id, ME], [KARL.id, KARL]]);
  const tables: Record<'activity_log' | 'users' | 'news_read' | 'user_settings', Row[]> = {
    activity_log: feed.map((row) => toDbRow(row, createdAt[row.id])),
    users: [...refs.values()].map((u) => ({ id: u.id, name: u.name, profile_picture: u.profile_picture, group_id: GROUP, created_at: USER_CREATED, news_last_seen_id: u.id === ME.id ? lastSeen : null })),
    news_read: readIds.map((activity_id) => ({ user_id: ME.id, activity_id })),
    user_settings: Object.entries(settings).map(([key, value]) => ({ user_id: ME.id, key, value })),
  };
  // Samma primärnycklar som migrationerna: en upsert utan krock ger en ny rad, annars ingen.
  const db = createFakeDb(tables, { primaryKeys: { news_read: ['user_id', 'activity_id'], user_settings: ['user_id', 'key'] } });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);

  const fake = newsServer(feed, lastSeen, ME.id);
  for (const id of readIds) fake.server.readIds.add(id);
  for (const [id, at] of Object.entries(createdAt)) fake.server.createdAt.set(Number(id), at);
  Object.assign(fake.server.settings, settings);
  return { ...fake, tables };
}

const queryString = (query: NewsQuery): string =>
  new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)])).toString();

const realGet = (query: NewsQuery) =>
  server.request('GET', `/api/news?${queryString(query)}`, { token: mintToken({ user_id: ME.id, group_id: GROUP }) });
/** Fejkens svar som över tråden: JSON, utan undefined. */
const wire = (value: unknown) => JSON.parse(JSON.stringify(value));

const QUERIES: Array<[string, NewsQuery]> = [
  ['the newest page', {}],
  ['the whole feed in one page', { limit: 100 }],
  ['a small page', { limit: 4 }],
  ['rows older than a cursor', { before: 20, limit: 5 }],
  ['rows newer than a cursor', { after: 40, limit: 100 }],
  ['a multi-type filter', { type: 'title_taken,rank_passed,event_closed', limit: 100 }],
  ['rows that involve the viewer', { involves: 'me', limit: 100 }],
  ['rows that involve the viewer, paged', { involves: 'me', limit: 3 }],
  ['involves combined with a type filter', { involves: 'me', type: 'event_closed,level_up', limit: 100 }],
];

describe('newsServer parity with GET /api/news', () => {
  it('has a sample for every activity type the backend can send', () => {
    expect(Object.keys(newsSamples).sort()).toEqual([...ACTIVITY_TYPES].sort());
    const typesInFeed = new Set(buildFeed().map((row) => row.type));
    expect([...typesInFeed].sort()).toEqual([...ACTIVITY_TYPES].sort());
  });

  it.each(ACTIVITY_TYPES.map((type): [ActivityType] => [type]))('answers a %s filter with the same rows and fields as the route', async (type) => {
    const fake = useWorld({ feed: buildFeed() });
    const real = await realGet({ type, limit: 100 });
    const mine = await fake.getNews({ type, limit: 100 });

    expect(real.status).toBe(200);
    expect(real.body.data.items.length).toBeGreaterThan(0);
    expect(wire(mine)).toEqual(real.body);
  });

  it.each(QUERIES)('answers %s with the same body as the route', async (_name, query) => {
    const fake = useWorld({ feed: buildFeed() });
    const real = await realGet(query);
    const mine = await fake.getNews(query);

    expect(real.status).toBe(200);
    expect(real.body.data.items.length).toBeGreaterThan(0);
    expect(wire(mine)).toEqual(real.body);
  });

  it('includes an event the viewer took part in under involves=me even when they are neither actor nor target', async () => {
    const feed = buildFeed();
    const entrantRow = feed.find((row) => row.type === 'event_closed' && row.payload.entrant_ids?.includes(ME.id));
    const fake = useWorld({ feed });
    const real = await realGet({ involves: 'me', type: 'event_closed', limit: 100 });
    const mine = wire(await fake.getNews({ involves: 'me', type: 'event_closed', limit: 100 }));

    expect(entrantRow).toBeDefined();
    expect(real.body.data.items.map((row: NewsItem) => row.id)).toContain(entrantRow!.id);
    expect(mine.data.items.map((row: NewsItem) => row.id)).toEqual(real.body.data.items.map((row: NewsItem) => row.id));
  });

  it('includes a title taken from someone else under involves=me when the viewer was runner-up, and not when someone else was', async () => {
    const feed = buildFeed();
    const mineRow = feed.find((row) => row.type === 'title_taken' && row.target === null && row.payload.runner_up_user_id === ME.id);
    const othersRow = feed.find((row) => row.type === 'title_taken' && row.payload.runner_up_user_id === KARL.id);
    const fake = useWorld({ feed });
    const real = await realGet({ involves: 'me', type: 'title_taken', limit: 100 });
    const mine = wire(await fake.getNews({ involves: 'me', type: 'title_taken', limit: 100 }));
    const realIds = real.body.data.items.map((row: NewsItem) => row.id);

    expect(mineRow).toBeDefined();
    expect(othersRow).toBeDefined();
    expect(realIds).toContain(mineRow!.id);
    expect(realIds).not.toContain(othersRow!.id);
    expect(mine.data.items.map((row: NewsItem) => row.id)).toEqual(realIds);
  });

  it('reports the same unread state when the floor, read receipts and switched-off kinds apply', async () => {
    const fake = useWorld({
      feed: buildFeed(),
      lastSeen: 6,
      readIds: [7, 9, 12],
      settings: { [notifyKey('level_up_others')]: false, [notifyKey('title_taken_from_me')]: false },
    });
    const real = await realGet({ limit: 100 });
    const mine = await fake.getNews({ limit: 100 });

    expect(real.body.data.items.some((row: NewsItem) => row.is_unread)).toBe(true);
    expect(real.body.data.items.some((row: NewsItem) => !row.is_unread)).toBe(true);
    expect(wire(mine)).toEqual(real.body);
  });

  it('caps unread_count at the shared ceiling when more rows than that are unread', async () => {
    const feed = Array.from({ length: UNREAD_CAP + 20 }, (_, i) => newsSamples.level_up(i + 1, { actor: KARL }));
    const fake = useWorld({ feed });
    const real = await realGet({ limit: 1 });
    const mine = await fake.getNews({ limit: 1 });

    expect(real.body.meta.unread_count).toBe(UNREAD_CAP);
    expect(wire(mine)).toEqual(real.body);
  });

  it.each<[string, NewsQuery]>([
    ['an unknown activity type', { type: 'title_taken,not_a_type' }],
    ['a limit above the maximum', { limit: 101 }],
    ['a limit of zero', { limit: 0 }],
    ['a cursor that is not positive', { before: 0 }],
    ['before and after together', { before: 10, after: 5 }],
  ])('rejects %s with the same message as the route', async (_name, query) => {
    const fake = useWorld({ feed: buildFeed() });
    const real = await realGet(query);
    const mine = await fake.getNews(query);

    expect(real.status).toBe(400);
    expect(mine).toEqual({ success: false, error: real.body.error });
  });

  it('sends exactly the field names the shared contract declares', async () => {
    const fake = useWorld({ feed: buildFeed() });
    const real = await realGet({ limit: 100 });
    const mine = wire(await fake.getNews({ limit: 100 }));

    for (const body of [real.body, mine]) {
      expect(Object.keys(body.meta).sort()).toEqual([...NEWS_META_FIELDS].sort());
      for (const row of body.data.items) expect(Object.keys(row).sort()).toEqual([...NEWS_ITEM_FIELDS].sort());
    }
  });
});

describe('newsServer parity with the unread time of the route', () => {
  it('treats a row that happened before the registration but was logged after it as unread, like the route', async () => {
    const early = newsSamples.level_up(1, { actor: KARL, occurred_at: '2025-12-01T10:00:00.000Z' });
    const late = newsSamples.level_up(2, { actor: KARL, occurred_at: '2025-12-01T10:00:00.000Z' });
    const fake = useWorld({ feed: [early, late], createdAt: { 1: '2026-02-01T10:00:00.000Z' } }); // row 2 was logged when it happened: before the registration
    const real = await realGet({ limit: 100 });
    const mine = await fake.getNews({ limit: 100 });

    expect(real.body.data.items.map((row: NewsItem) => [row.id, row.is_unread])).toEqual([[2, false], [1, true]]);
    expect(wire(mine)).toEqual(real.body);
  });
});

const sorted = (values: Iterable<number>): number[] => [...values].sort((a, b) => a - b);

describe('newsServer parity with the write endpoints', () => {
  const token = () => mintToken({ user_id: ME.id, group_id: GROUP });
  const realSeen = (body: unknown) => server.request('POST', '/api/news/seen', { token: token(), body });
  const realRead = (body: unknown) => server.request('POST', '/api/news/read', { token: token(), body });
  const realSettings = () => server.request('GET', '/api/settings', { token: token() });
  const realPutSettings = (values: unknown) => server.request('PUT', '/api/settings', { token: token(), body: { values } });

  /** Same answer from both sides: the body of a 200, or the message of an error (the fake says `{ success: false, error }`, the route `{ error }`). */
  function expectSameAnswer(real: { status: number; body: any }, mine: unknown, expectedStatus: number): void {
    expect(real.status).toBe(expectedStatus);
    if (expectedStatus === 200) expect(wire(mine)).toEqual(real.body);
    else expect(mine).toEqual({ success: false, error: real.body.error });
  }

  const floorOf = (world: ReturnType<typeof useWorld>) => {
    const me = world.tables.users.find((user) => user.id === ME.id);
    return me?.news_last_seen_id == null ? null : Number(me.news_last_seen_id);
  };
  const receiptsOf = (world: ReturnType<typeof useWorld>) => sorted(world.tables.news_read.filter((r) => r.user_id === ME.id).map((r) => Number(r.activity_id)));

  const NEWEST = buildFeed().length;

  it.each<[string, unknown, number | null]>([
    ['no id (mark all read)', {}, null],
    ['an id in the middle', { up_to_id: 10 }, null],
    ['an id past the newest row', { up_to_id: 100_000 }, null],
    ['an id below the current floor, which never lowers it', { up_to_id: 5 }, 20],
    ['no id when everything is already seen', {}, NEWEST],
  ])('POST /news/seen with %s leaves the same floor and unread count as the route', async (_name, body, floor) => {
    const world = useWorld({ feed: buildFeed(), lastSeen: floor, readIds: floor === null ? [3, 25] : [] });
    const real = await realSeen(body);
    const mine = await world.markNewsSeen((body as { up_to_id?: number }).up_to_id);

    expectSameAnswer(real, mine, 200);
    expect(world.server.lastSeen).toBe(floorOf(world));
    expect(sorted(world.server.readIds)).toEqual(receiptsOf(world)); // the route prunes the receipts the new floor makes inert
  });

  it.each<[string, number]>([['zero', 0], ['negative', -3], ['fractional', 1.5]])('POST /news/seen rejects an id that is %s with the same message as the route', async (_name, id) => {
    const world = useWorld({ feed: buildFeed() });
    const real = await realSeen({ up_to_id: id });
    const mine = await world.markNewsSeen(id);

    expectSameAnswer(real, mine, 400);
    expect(world.server.lastSeen).toBe(floorOf(world));
  });

  it.each<[string, number[], number | null]>([
    ['ids above the floor', [4, 9, 30], 2],
    ['ids at and below the floor, which are ignored', [1, 2, 3], 2],
    ['ids of rows that do not exist, which are ignored', [999_999], null],
    ['a single id and no floor', [7], null],
  ])('POST /news/read with %s answers and records receipts like the route', async (_name, ids, floor) => {
    const world = useWorld({ feed: buildFeed(), lastSeen: floor });
    const real = await realRead({ ids });
    const mine = await world.markNewsRead(ids);

    expectSameAnswer(real, mine, 200);
    expect(sorted(world.server.readIds)).toEqual(receiptsOf(world));
  });

  it.each<[string, number[]]>([
    ['no ids', []],
    ['more than 50 ids', Array.from({ length: 51 }, (_, i) => i + 1)],
    ['a repeated id', [4, 4]],
    ['a zero id', [0]],
    ['a fractional id', [1.5]],
  ])('POST /news/read rejects %s with the same message as the route', async (_name, ids) => {
    const world = useWorld({ feed: buildFeed() });
    const real = await realRead({ ids });
    const mine = await world.markNewsRead(ids);

    expectSameAnswer(real, mine, 400);
    expect(world.server.readIds.size).toBe(0);
    expect(receiptsOf(world)).toEqual([]);
  });

  it('GET /settings answers with the same values and customised keys as the route', async () => {
    const world = useWorld({ feed: [], settings: { [notifyKey('level_up_others')]: false } });
    const real = await realSettings();
    const mine = await world.getSettings();

    expectSameAnswer(real, mine, 200);
    expect(real.body.meta.customised).toContain(notifyKey('level_up_others'));
  });

  it.each<[string, Record<string, boolean | null>]>([
    ['a switch turned off', { [notifyKey('level_up_others')]: false }],
    ['a switch reset to its default', { [notifyKey('title_taken_from_me')]: null }],
    ['a switch turned off and another reset', { [notifyKey('level_up_others')]: false, [notifyKey('title_taken_from_me')]: null }],
  ])('PUT /settings with %s answers and stores like the route', async (_name, values) => {
    const world = useWorld({ feed: [], settings: { [notifyKey('title_taken_from_me')]: false } });
    const real = await realPutSettings(values);
    const mine = await world.putSettings(values);

    expectSameAnswer(real, mine, 200);
    const stored = Object.fromEntries(world.tables.user_settings.filter((r) => r.user_id === ME.id).map((r) => [r.key, r.value]));
    expect(world.server.settings).toEqual(stored);
  });

  it.each<[string, Record<string, unknown>]>([
    ['an unknown key', { 'notify.not_a_kind': true }],
    ['a value of the wrong type', { [notifyKey('level_up_others')]: 'yes' }],
  ])('PUT /settings rejects %s with the same message as the route and stores nothing', async (_name, values) => {
    const world = useWorld({ feed: [] });
    const real = await realPutSettings(values);
    const mine = await world.putSettings(values as never);

    expectSameAnswer(real, mine, 400);
    expect(world.tables.user_settings).toEqual([]);
    expect(world.server.settings).toEqual({});
  });
});
