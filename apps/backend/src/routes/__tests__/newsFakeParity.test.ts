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

const toDbRow = (row: NewsItem): Row => ({
  id: row.id, group_id: GROUP, type: row.type, actor_user_id: row.actor?.id ?? null, target_user_id: row.target?.id ?? null,
  // payload_version läses INTE ur fejkens rad: saknar fejken fältet ska den riktiga rutten ändå skicka det, så att jämförelsen faller.
  payload: row.payload, payload_version: ACTIVITY_PAYLOAD_VERSION, dedupe_key: `k${row.id}`, is_backfill: row.is_backfill,
  // KÄND BEGRÄNSNING: backend avgör "efter registreringen" på activity_log.created_at, fejken på occurred_at (NewsItem har inget created_at).
  // Här sätts de lika, så paritet gäller bara rader där de två tiderna hamnar på samma sida av användarens registrering. En rad som
  // hände före registreringen men loggades efter (t.ex. backfill-liknande) kan skilja och täcks inte av det här testet.
  occurred_at: row.occurred_at, created_at: row.occurred_at,
});

interface World {
  feed: NewsItem[];
  lastSeen?: number | null;
  readIds?: number[];
  settings?: Record<string, boolean>;
}

/** Bygger samma värld åt båda sidor: riktiga rutten mot fakeDb, och fejken. */
function useWorld({ feed, lastSeen = null, readIds = [], settings = {} }: World) {
  const refs = new Map<string, NewsUserRef>([[ME.id, ME], [KARL.id, KARL]]);
  const db = createFakeDb({
    activity_log: feed.map(toDbRow),
    users: [...refs.values()].map((u) => ({ id: u.id, name: u.name, profile_picture: u.profile_picture, group_id: GROUP, created_at: USER_CREATED, news_last_seen_id: u.id === ME.id ? lastSeen : null })),
    news_read: readIds.map((activity_id) => ({ user_id: ME.id, activity_id })),
    user_settings: Object.entries(settings).map(([key, value]) => ({ user_id: ME.id, key, value })),
  });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);

  const fake = newsServer(feed, lastSeen, ME.id);
  for (const id of readIds) fake.server.readIds.add(id);
  Object.assign(fake.server.settings, settings);
  return fake;
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
