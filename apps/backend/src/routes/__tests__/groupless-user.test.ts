/**
 * En användare utan grupp får samma svar i varje rutt som läser gruppens data (ADR 007 A6, ADR 012 beslut 5, fail-closed): 200 med tom data för
 * läsningar, och ingenting från någon grupp, hur världen runt omkring än ser ut. Ett id i en annan grupp ger samma 404 som ett id som inte finns.
 * Hur en rutt hittar gruppen (groupIdOrRespondEmpty / tokenGroupId i utils/groupScope.ts) är en implementationsdetalj; svaret är kontraktet.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('../../config/database.js', () => ({ default: {}, supabase: { client: {} }, getSupabaseClient: vi.fn() }));
vi.mock('../../utils/calculateUserTotals.js', () => ({ calculateUserTotals: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../services/weatherService.js', () => ({
  WeatherService: { fetchAndSaveWeatherForRuns: vi.fn().mockResolvedValue(undefined), backfillMissingWeather: vi.fn() },
}));

import { getSupabaseClient } from '../../config/database.js';
import app from '../../app.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-01T10:00:00Z')); // torsdag; veckostart 2026-09-28
  server = await startServer(app);
});
afterAll(async () => { await server.close(); vi.useRealTimers(); });
afterEach(() => { vi.clearAllMocks(); });

const GA = 'group-a';
const GB = 'group-b';
const NO_GROUP = '00000000-0000-4000-8000-0000000000f0';
const A1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01';
const B1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01';
const GHOST = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const user = (id: string, name: string, group_id: string | null): Row => ({
  id, name, group_id, is_admin: false, total_xp: 100, current_level: 3, profile_picture: null, challenge_active: false, created_at: '2026-01-01T08:00:00Z',
  news_last_seen_id: null, displayed_badge_series: [], wins: 1, draws: 0, losses: 0,
});
const template = { name: 'Morning Run', icon: 'sun', description: 'Run', min_km: 3, reward_xp: 20, reward_xp_1st: 50, reward_xp_2nd: 30, reward_xp_3rd: 10, requires_weather: null };

/** Två grupper med data i varje tabell en rutt kan läsa, och en användare utan grupp. Det som ska synas i svaret är: ingenting av det. */
function world(): Record<string, Row[]> {
  const event = (id: string, group_id: string, status: string): Row => ({
    id, group_id, type: 'participation', metric: 'km', status, starts_at: '2026-09-30T00:00:00Z', ends_at: '2026-10-03T23:59:59Z', event_templates: template,
  });
  const runIn = (id: string, user_id: string, group_id: string): Row => ({
    id, user_id, date: '2026-09-29', distance: 5, xp_gained: 30, multiplier: 1, streak_day: 1, base_xp: 15, km_xp: 10, distance_bonus: 5, streak_bonus: 0,
    source: 'manual', created_at: '2026-09-29T10:00:00Z', users: { name: user_id, current_level: 3, profile_picture: null, total_xp: 100, group_id },
  });
  return {
    users: [user(NO_GROUP, 'Nogroup', null), user(A1, 'Anna', GA), user(B1, 'Bertil', GB)],
    groups: [{ id: GA, name: 'Group A', invite_code: 'CODE-A', owner_id: A1 }, { id: GB, name: 'Group B', invite_code: 'CODE-B', owner_id: B1 }],
    group_members: [{ id: 'm1', group_id: GA, user_id: A1, role: 'admin', left_at: null }, { id: 'm2', group_id: GB, user_id: B1, role: 'admin', left_at: null }],
    events: [event('ev-a', GA, 'active'), event('ev-a-old', GA, 'settled'), event('ev-b', GB, 'active'), event('ev-b-old', GB, 'settled')],
    event_entries: [],
    runs: [runIn('run-a1', A1, GA), runIn('run-b1', B1, GB)],
    activity_log: [
      { id: 1, group_id: GA, type: 'level_up', actor_user_id: A1, target_user_id: null, payload: { level: 2 }, payload_version: 1, dedupe_key: 'k1', is_backfill: false, occurred_at: '2026-06-01T00:00:00Z', created_at: '2026-06-01T00:00:00Z' },
      { id: 2, group_id: GB, type: 'level_up', actor_user_id: B1, target_user_id: null, payload: { level: 2 }, payload_version: 1, dedupe_key: 'k2', is_backfill: false, occurred_at: '2026-06-01T00:00:00Z', created_at: '2026-06-01T00:00:00Z' },
    ],
    user_badges: [{ id: 'ub1', user_id: A1, series: 'milestoner', tier: 1, earned_at: '2026-09-01T00:00:00Z', seen_tier: 0 }],
    challenges: [
      { id: 'c1', group_id: GA, status: 'completed', challenger_id: A1, opponent_id: GHOST, determine_at: '2026-09-20T00:00:00Z', created_at: '2026-09-15T00:00:00Z' },
      { id: 'c2', group_id: GB, status: 'active', challenger_id: B1, opponent_id: GHOST, created_at: '2026-09-30T00:00:00Z' },
    ],
    user_challenge_tokens: [{ id: 't-ng', user_id: NO_GROUP, tier: 'major', metric: 'km', duration_days: 5, reward_id: 'rw1', sent_at: null, challenge_id: null, earned_at: '2026-09-01T00:00:00Z' }],
    challenge_rewards: [{ id: 'rw1', winner_type: 'multiplier_days', winner_delta: 0.2, winner_duration: 3, loser_type: 'multiplier_days', loser_delta: -0.1, loser_duration: 2 }],
    user_boosts: [],
  };
}

function use(tables: Record<string, Row[]> = world()) {
  const db = createFakeDb(tables, { autoIds: true, numericIds: ['activity_log'] });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as never);
  return { tables, db };
}

const asNoGroup = mintToken({ user_id: NO_GROUP, group_id: null });
const asA = mintToken({ user_id: A1, group_id: GA });
const get = (path: string, token = asNoGroup) => server.request('GET', path, { token });

/** Inget som tillhör en grupp eller någon annan än anroparen får finnas i svaret. */
const expectNothingFromAnyGroup = (body: unknown) => {
  const text = JSON.stringify(body);
  for (const secret of [GA, GB, A1, B1, 'Anna', 'Bertil', 'CODE-A', 'CODE-B']) expect(text, `svaret nämner ${secret}`).not.toContain(secret);
};

const GROUP_READS: Array<[string, string, (body: any) => void]> = [
  ['GET /api/news', '/api/news', (b) => expect(b).toEqual({ success: true, data: { items: [] }, meta: { unread_count: 0, last_seen_id: null, has_more: false, next_before: null } })],
  ['GET /api/leaderboard/week', '/api/leaderboard/week', (b) => {
    expect(b.success).toBe(true);
    expect(b.data).toMatchObject({ users: [], mover: null, totals: { km: 0, runs: 0, xp: 0, active_runners: 0, members: 0, best_week_km: 0 } });
  }],
  ['GET /api/leaderboard/rank-delta', '/api/leaderboard/rank-delta', (b) => expect(b).toEqual({ success: true, data: { as_of: '2026-09-28', users: [] } })],
  ['GET /api/events', '/api/events', (b) => expect(b).toEqual({ success: true, events: [], data: { events: [] } })],
  ['GET /api/events/history', '/api/events/history', (b) => expect(b).toEqual({ success: true, events: [], data: { events: [] }, meta: { total: 0, limit: 30, offset: 0, has_more: false } })],
  ['GET /api/challenges/group-history', '/api/challenges/group-history', (b) => expect(b).toEqual({ success: true, data: { items: [] }, meta: { total: 0, limit: 20, offset: 0, has_more: false } })],
  ['GET /api/challenges/group-stats', '/api/challenges/group-stats', (b) => expect(b).toEqual({ success: true, data: [] })],
  ['GET /api/badges/group', '/api/badges/group', (b) => {
    expect(b.success).toBe(true);
    expect(b.data.members).toEqual([]);
    expect(b.meta).toEqual({ member_count: 0 });
  }],
  ['GET /api/runs/group-history', '/api/runs/group-history', (b) => expect(b).toEqual({ success: true, runs: [], data: { runs: [] }, meta: { total: 0, limit: 100, offset: 0, has_more: false } })],
  ['GET /api/titles/leaderboard', '/api/titles/leaderboard', (b) => expect(b).toMatchObject({ success: true, data: [] })],
  ['GET /api/titles/group-eligibility', '/api/titles/group-eligibility', (b) => expect(b).toEqual({ success: true, data: [] })],
];

describe('a user without a group, in every route that reads the group\'s data', () => {
  it.each(GROUP_READS)('%s answers 200 with empty data and nothing from any group', async (_name, path, check) => {
    use();
    const res = await get(path);
    expect(res.status).toBe(200);
    check(res.body);
    expectNothingFromAnyGroup(res.body);
  });

  it('POST /api/news/seen answers 200 with the floor it has and no unread, and writes nothing', async () => {
    const { tables } = use();
    const res = await server.request('POST', '/api/news/seen', { token: asNoGroup, body: {} });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { last_seen_id: null, unread_count: 0 } });
    expect(tables.users.find((u) => u.id === NO_GROUP)!.news_last_seen_id).toBeNull();
  });

  it('POST /api/news/read answers 200 with no unread', async () => {
    use();
    const res = await server.request('POST', '/api/news/read', { token: asNoGroup, body: { ids: [1, 2] } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { unread_count: 0 } });
  });

  it('GET /api/challenges/my answers the own tokens and nothing from any group', async () => {
    use();
    const res = await get('/api/challenges/my');
    expect(res.status).toBe(200);
    expect(res.body.data.group_active).toEqual([]);
    expect(res.body.data.tokens.map((t: { id: string }) => t.id)).toEqual(['t-ng']);
    expectNothingFromAnyGroup(res.body);
  });

  it('GET /api/groups/my answers 404 not_found: there is no group to describe', async () => {
    use();
    const res = await get('/api/groups/my');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'You are not a member of any group', code: 'not_found' });
  });

  it('POST /api/challenges/send answers 400 and creates nothing: the opponent is not in the (missing) group', async () => {
    const { tables } = use();
    const res = await server.request('POST', '/api/challenges/send', { token: asNoGroup, body: { token_id: 't-ng', opponent_id: A1 } });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'Opponent is not in your group', code: 'invalid_request' });
    expect(tables.challenges).toHaveLength(2);
    expect(tables.user_challenge_tokens[0].sent_at).toBeNull();
  });
});

describe('an id in another group answers as an id that does not exist', () => {
  it.each([
    ['GET /api/badges/user/:id', (id: string) => `/api/badges/user/${id}`],
    ['GET /api/challenges/head-to-head/:id', (id: string) => `/api/challenges/head-to-head/${id}`],
  ])('%s: the same 404 for a user in another group, a user without a group as caller, and a user who does not exist', async (_name, path) => {
    use();
    const otherGroup = await get(path(B1), asA);
    const unknown = await get(path(GHOST), asA);
    const callerWithoutGroup = await get(path(A1));

    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual({ success: false, error: 'User not found', code: 'not_found' });
    expect(otherGroup).toEqual(unknown);
    expect(callerWithoutGroup).toEqual(unknown);
  });

  it('GET /api/badges/user/:id is the own profile for the caller without a group: it is the caller\'s own data', async () => {
    use();
    const res = await get(`/api/badges/user/${NO_GROUP}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { items: [], showcase: [] } });
  });
});
