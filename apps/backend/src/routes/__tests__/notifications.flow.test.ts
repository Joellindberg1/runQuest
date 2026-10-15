/**
 * Flödestest för notiser, våg 1 (ADR 011, beslut 2-4): kedjan fakta i loggen -> räknaren -> en inställning -> en kvittering -> räknaren
 * igen, mot den riktiga appen (`createApp()` med riktig auth, gruppfilter och fail-closed) och en in-memory-databas. Enhetstesterna
 * täcker varje del var för sig (shared: isNotifiable/registret, news.test.ts, newsRead.test.ts, settings.test.ts); det som bevisas här är att
 * de hänger ihop: PUT /settings flyttar samma räknare som GET /news visar, POST /news/read och /seen flyttar den, och ingen annan användare
 * märker något av det.
 *
 * Världen: grupp g1 med tre användare (A = jag, B, C) och fyra rader, sedd från A:
 *   1 title_taken     B tar en titel från A    -> title_taken_from_me (påslaget som standard)
 *   2 challenge_won   A vinner över C          -> challenge_won_me (undantaget från egen-handling-regeln)
 *   3 level_up        B                        -> level_up_others
 *   4 level_up        A själv                  -> egen rad, aldrig en notis
 * Utan inställningar är A:s räknare alltså exakt 3. En fjärde användare, D, bor i en annan grupp (g2).
 */
import { it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { notifyKey, resolveSettings } from '@runquest/shared';
import { getSupabaseClient } from '../../config/database.js';
import { createApp } from '../../app.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(createApp()); });
afterAll(async () => { await server.close(); });
afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });

const A = 'user-a';
const B = 'user-b';
const C = 'user-c';
const D = 'user-d';
const GROUP = 'g1';
const OTHER_GROUP = 'g2';
const USER_CREATED = '2026-01-01T00:00:00.000Z';
const AFTER_USER = '2026-06-01T00:00:00.000Z';

const TITLE_FROM_ME = notifyKey('title_taken_from_me');
const LEVEL_UP_OTHERS = notifyKey('level_up_others');

const TITLE_TAKEN = 1;
const CHALLENGE_WON = 2;
const LEVEL_UP_B = 3;
const LEVEL_UP_A = 4;

function activity(id: number, type: string, actor: string | null, target: string | null, payload: Row): Row {
  return {
    id, group_id: GROUP, type, actor_user_id: actor, target_user_id: target, payload, payload_version: 1,
    dedupe_key: `k${id}`, is_backfill: false, occurred_at: AFTER_USER, created_at: AFTER_USER,
  };
}

function user(id: string, name: string, group: string): Row {
  return { id, name, profile_picture: null, group_id: group, created_at: USER_CREATED, news_last_seen_id: null };
}

interface World {
  activity_log: Row[];
  users: Row[];
  news_read: Row[];
  user_settings: Row[];
}

function world(): World {
  return {
    activity_log: [
      activity(TITLE_TAKEN, 'title_taken', B, A, { title_name: 'The Longest Run', metric_key: 'longestRun', value: 32.8 }),
      activity(CHALLENGE_WON, 'challenge_won', A, C, { challenge_id: 'c1', tier: 'major', metric: 'km', duration_days: 7 }),
      activity(LEVEL_UP_B, 'level_up', B, null, { level: 12 }),
      activity(LEVEL_UP_A, 'level_up', A, null, { level: 9 }),
    ],
    users: [user(A, 'Anna', GROUP), user(B, 'Bertil', GROUP), user(C, 'Cecilia', GROUP), user(D, 'Dagny', OTHER_GROUP)],
    news_read: [],
    user_settings: [],
  };
}

/** Samma primärnycklar som migrationerna: en upsert utan krock blir en ny rad, en med krock uppdaterar eller hoppar över. */
function use(t: World) {
  const db = createFakeDb(t as unknown as Record<string, Row[]>, {
    primaryKeys: { news_read: ['user_id', 'activity_id'], user_settings: ['user_id', 'key'] },
  });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as never);
  return db;
}

const groupOf = (userId: string) => (userId === D ? OTHER_GROUP : GROUP);
const token = (userId: string) => mintToken({ user_id: userId, group_id: groupOf(userId) });

const getNews = (userId = A) => server.request('GET', '/api/news', { token: token(userId) });
const getSettings = (userId = A) => server.request('GET', '/api/settings', { token: token(userId) });
const putSettings = (values: Record<string, boolean | null>, userId = A) =>
  server.request('PUT', '/api/settings', { token: token(userId), body: { values } });
const read = (ids: number[], userId = A) => server.request('POST', '/api/news/read', { token: token(userId), body: { ids } });
const seen = (body: Record<string, unknown> = {}, userId = A) => server.request('POST', '/api/news/seen', { token: token(userId), body });

const unreadCount = async (userId = A): Promise<number> => (await getNews(userId)).body.meta.unread_count;
/** id -> is_unread för sidans rader, nyast först. */
const unreadFlags = async (userId = A): Promise<Array<[number, boolean]>> =>
  (await getNews(userId)).body.data.items.map((item: { id: number; is_unread: boolean }) => [item.id, item.is_unread]);
const receiptsOf = (t: World, userId: string) => t.news_read.filter((r) => r.user_id === userId).map((r) => Number(r.activity_id)).sort((a, b) => a - b);
const floorOf = (t: World, userId: string) => t.users.find((u) => u.id === userId)!.news_last_seen_id;

it('en användare utan inställningar räknar title_taken mot sig och en vunnen utmaning men aldrig egna övriga rader', async () => {
  const t = world();
  use(t);

  const res = await getNews();

  expect(res.status).toBe(200);
  // 1 (titel tagen från mig), 2 (jag vann) och 3 (någon annans nivå) räknas; 4 är min egen nivå och räknas aldrig.
  expect(res.body.meta.unread_count).toBe(3);
  expect(await unreadFlags()).toEqual([[LEVEL_UP_A, false], [LEVEL_UP_B, true], [CHALLENGE_WON, true], [TITLE_TAKEN, true]]);
  // Inget har skrivits av att bara läsa: varken inställningar, kvitton eller golv.
  expect(t.user_settings).toEqual([]);
  expect(t.news_read).toEqual([]);
  expect(floorOf(t, A)).toBeNull();
});

it('att stänga av title_taken_from_me sänker räknaren och raden finns kvar i GET /news som läst', async () => {
  const t = world();
  use(t);
  expect(await unreadCount()).toBe(3);

  const put = await putSettings({ [TITLE_FROM_ME]: false });

  expect(put.status).toBe(200);
  expect(put.body.data.values[TITLE_FROM_ME]).toBe(false);
  expect(put.body.meta.customised).toEqual([TITLE_FROM_ME]);
  const feed = await getNews();
  expect(feed.body.meta.unread_count).toBe(2);
  // /news visar fortfarande allt: raden finns kvar, den lyser bara inte längre. Det är inställningen, inte ett kvitto, som tystade den.
  expect(feed.body.data.items.map((item: { id: number }) => item.id)).toEqual([LEVEL_UP_A, LEVEL_UP_B, CHALLENGE_WON, TITLE_TAKEN]);
  expect(await unreadFlags()).toEqual([[LEVEL_UP_A, false], [LEVEL_UP_B, true], [CHALLENGE_WON, true], [TITLE_TAKEN, false]]);
  expect(t.news_read).toEqual([]);
  expect(floorOf(t, A)).toBeNull();
  expect(t.user_settings).toEqual([expect.objectContaining({ user_id: A, key: TITLE_FROM_ME, value: false })]);
});

it('att återställa med null höjer räknaren igen', async () => {
  const t = world();
  use(t);
  await putSettings({ [TITLE_FROM_ME]: false });
  expect(await unreadCount()).toBe(2);

  const reset = await putSettings({ [TITLE_FROM_ME]: null });

  expect(reset.status).toBe(200);
  expect(reset.body.data.values[TITLE_FROM_ME]).toBe(true);
  expect(reset.body.meta.customised).toEqual([]);
  expect(await unreadCount()).toBe(3);
  expect(await unreadFlags()).toEqual([[LEVEL_UP_A, false], [LEVEL_UP_B, true], [CHALLENGE_WON, true], [TITLE_TAKEN, true]]);
  // Sparse lagring: att återställa raderar raden i stället för att spara standardvärdet.
  expect(t.user_settings).toEqual([]);
});

it('att kvittera en rad sänker räknaren med ett och är idempotent', async () => {
  const t = world();
  use(t);
  expect(await unreadCount()).toBe(3);

  const first = await read([LEVEL_UP_B]);
  const second = await read([LEVEL_UP_B]);

  expect(first.status).toBe(200);
  expect(first.body).toEqual({ success: true, data: { unread_count: 2 } });
  // Samma rad igen ändrar varken svaret, räknaren eller antalet kvitton.
  expect(second.status).toBe(200);
  expect(second.body).toEqual({ success: true, data: { unread_count: 2 } });
  expect(t.news_read).toHaveLength(1);
  expect(receiptsOf(t, A)).toEqual([LEVEL_UP_B]);
  // Svaret är exakt det GET /news visar direkt efter, och de andra raderna är orörda; golvet också.
  expect(await unreadCount()).toBe(2);
  expect(await unreadFlags()).toEqual([[LEVEL_UP_A, false], [LEVEL_UP_B, false], [CHALLENGE_WON, true], [TITLE_TAKEN, true]]);
  expect(floorOf(t, A)).toBeNull();

  // En blandad batch: den redan kvitterade raden sänker inte igen, den nya sänker med ett.
  const mixed = await read([LEVEL_UP_B, CHALLENGE_WON]);
  expect(mixed.body).toEqual({ success: true, data: { unread_count: 1 } });
  expect(receiptsOf(t, A)).toEqual([CHALLENGE_WON, LEVEL_UP_B]);
});

it('Mark all read höjer golvet och prunar news_read', async () => {
  const t = world();
  use(t);
  expect((await read([TITLE_TAKEN, LEVEL_UP_B])).body.data.unread_count).toBe(1);
  expect(receiptsOf(t, A)).toEqual([TITLE_TAKEN, LEVEL_UP_B]);

  // Ett golv på rad 1: kvittot på raden 1 är inert nu och rensas, kvittot ovanför golvet står kvar.
  const partial = await seen({ up_to_id: TITLE_TAKEN });
  expect(partial.body).toEqual({ success: true, data: { last_seen_id: TITLE_TAKEN, unread_count: 1 } });
  expect(floorOf(t, A)).toBe(TITLE_TAKEN);
  expect(receiptsOf(t, A)).toEqual([LEVEL_UP_B]);

  // Mark all read utan id: golvet går till senaste raden i gruppen (även min egen rad 4), alla kvitton under det rensas.
  const all = await seen();
  expect(all.status).toBe(200);
  expect(all.body).toEqual({ success: true, data: { last_seen_id: LEVEL_UP_A, unread_count: 0 } });
  expect(floorOf(t, A)).toBe(LEVEL_UP_A);
  expect(receiptsOf(t, A)).toEqual([]);
  expect(t.news_read).toEqual([]);
  const feed = await getNews();
  expect(feed.body.meta).toMatchObject({ unread_count: 0, last_seen_id: LEVEL_UP_A });
  expect(await unreadFlags()).toEqual([[LEVEL_UP_A, false], [LEVEL_UP_B, false], [CHALLENGE_WON, false], [TITLE_TAKEN, false]]);
});

it('en annan användare ser aldrig A:s inställningar eller läst-status', async () => {
  const t = world();
  use(t);
  // Före: B räknar rad 2 (andras utmaning) och 4 (A:s nivå); sina egna rader 1 och 3 räknar B aldrig. C räknar 1, 2, 3 och 4.
  expect(await unreadCount(B)).toBe(2);
  expect(await unreadCount(C)).toBe(4);

  // A stänger av "Someone levels up", kvitterar utmaningen och höjer inget golv.
  expect((await putSettings({ [LEVEL_UP_OTHERS]: false })).status).toBe(200);
  expect((await read([CHALLENGE_WON])).status).toBe(200);
  // A: 1 räknas, 2 är kvitterad, 3 är avstängd, 4 är egen.
  expect(await unreadCount()).toBe(1);
  expect(receiptsOf(t, A)).toEqual([CHALLENGE_WON]);

  // Ingen av A:s val syns hos B eller C: samma räknare, samma rader lyser, standardinställningar.
  expect(await unreadCount(B)).toBe(2);
  expect(await unreadFlags(B)).toEqual([[LEVEL_UP_A, true], [LEVEL_UP_B, false], [CHALLENGE_WON, true], [TITLE_TAKEN, false]]);
  expect(await unreadCount(C)).toBe(4);
  const bSettings = await getSettings(B);
  expect(bSettings.body.data.values).toEqual(resolveSettings({}, 'user'));
  expect(bSettings.body.meta.customised).toEqual([]);
  expect((await getSettings(A)).body.meta.customised).toEqual([LEVEL_UP_OTHERS]);
  // Och det omvända: B:s kvittering rör inte A. B läser rad 4, A:s räknare står kvar.
  expect((await read([LEVEL_UP_A], B)).body.data.unread_count).toBe(1);
  expect(receiptsOf(t, B)).toEqual([LEVEL_UP_A]);
  expect(receiptsOf(t, A)).toEqual([CHALLENGE_WON]);
  expect(await unreadCount()).toBe(1);

  // Gruppfiltret: D i en annan grupp ser inga rader, och kan inte kvittera eller läsa av någon annans.
  const outsiderFeed = await getNews(D);
  expect(outsiderFeed.status).toBe(200);
  expect(outsiderFeed.body.data.items).toEqual([]);
  expect(outsiderFeed.body.meta.unread_count).toBe(0);
  const outsiderRead = await read([TITLE_TAKEN, CHALLENGE_WON, LEVEL_UP_B, LEVEL_UP_A], D);
  expect(outsiderRead.status).toBe(200);
  expect(outsiderRead.body).toEqual({ success: true, data: { unread_count: 0 } });
  expect(receiptsOf(t, D)).toEqual([]);
  const outsiderSettings = await getSettings(D);
  expect(outsiderSettings.body.meta.customised).toEqual([]);
  expect(outsiderSettings.body.data.values).toEqual(resolveSettings({}, 'user'));
  // Allt som A, B och C skrev ligger kvar orört.
  expect(t.news_read.map((r) => [r.user_id, Number(r.activity_id)])).toEqual([[A, CHALLENGE_WON], [B, LEVEL_UP_A]]);
});
