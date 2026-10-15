/**
 * "Pause sync" (ADR 010 decision 7.5): PUT /api/strava/sync-paused, the pause state in GET /api/strava/status, and polling
 * and manual sync that respect the pause.
 *
 * Database: createFakeDb. Network: installFakeStravaFetch, wrapped so a test can hold a user's Strava list call open and see
 * what else reaches Strava meanwhile. The sync that resume starts runs in the background, so the tests wait for its effect.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.STRAVA_CLIENT_ID = 'client-id';
process.env.STRAVA_CLIENT_SECRET = 'client-secret';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));
vi.mock('../../utils/calculateUserTotals.js', () => ({ calculateUserTotals: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../services/eventService.js', () => ({
  checkEventQualification: vi.fn().mockResolvedValue(undefined),
  maybeCreateEvent: vi.fn(),
  activateScheduledEvents: vi.fn(),
  settleCompetitionEvents: vi.fn(),
  settleExpiredParticipationEvents: vi.fn(),
}));
vi.mock('../../services/weatherService.js', () => ({
  WeatherService: { fetchAndSaveWeatherForRuns: vi.fn().mockResolvedValue(undefined), backfillMissingWeather: vi.fn() },
}));
vi.mock('../../services/xpConfig.js', async () => {
  const shared = await import('@runquest/shared');
  return {
    getXpConfig: vi.fn(async () => ({
      settings: shared.DEFAULT_ADMIN_SETTINGS,
      streak_multipliers: shared.DEFAULT_STREAK_MULTIPLIERS,
      meta: { settings_source: 'defaults', multipliers_source: 'defaults' },
    })),
    invalidateXpConfigCache: vi.fn(),
  };
});

import { addDays, stockholmDay } from '@runquest/shared';
import { getSupabaseClient } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import { stravaLookback } from '../../utils/stravaLookback.js';
import app from '../../app.js';
import { syncAllStravaUsers } from '../strava.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';
import { installFakeStravaFetch, stravaActivity, stravaError, type FakeStrava } from '../../test-utils/fakeStrava.js';

let server: TestServer;
let strava: FakeStrava | undefined;
let releaseAll: (() => void) | undefined;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(() => {
  releaseAll?.(); // a failed assertion must not leave a request hanging, or afterAll's server.close() never returns
  releaseAll = undefined;
  strava?.restore();
  strava = undefined;
  vi.restoreAllMocks();
});

type UserId = 'user-1' | 'user-2';
const USERS: UserId[] = ['user-1', 'user-2'];
const accessTokenOf = (userId: UserId) => `at-${userId}`;
const activityOf: Record<UserId, ReturnType<typeof stravaActivity>> = {
  'user-1': stravaActivity({ id: 4001 }),
  'user-2': stravaActivity({ id: 4002 }),
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => { resolve = res; });
  return { promise, resolve };
}

interface SetupOptions {
  /** Users whose activity list call is held open at Strava until `release(user)`. */
  hold?: UserId[];
  /** Users that start out paused. */
  paused?: UserId[];
  /** Users without a Strava connection (no strava_tokens row). */
  unconnected?: UserId[];
  activities?: (userId: UserId) => ReturnType<typeof stravaActivity>[];
  runs?: Row[];
}

function setup(options: SetupOptions = {}) {
  const { hold = [], paused = [], unconnected = [], runs = [] } = options;
  const activitiesOf = options.activities ?? ((userId: UserId) => [activityOf[userId]]);
  const tables: Record<string, Row[]> = {
    strava_tokens: USERS.filter((userId) => !unconnected.includes(userId)).map((userId) => ({
      user_id: userId,
      access_token: accessTokenOf(userId),
      refresh_token: `rt-${userId}`,
      expires_at: 9999999999,
      connection_date: '2026-09-01',
      sync_paused: paused.includes(userId),
      paused_at: paused.includes(userId) ? '2026-10-01T08:00:00.000Z' : null,
      users: { name: userId },
    })),
    runs,
    user_boosts: [],
    users: USERS.map((id) => ({ id, is_admin: false })),
  };
  vi.mocked(getSupabaseClient).mockReturnValue(
    createFakeDb(tables, {
      autoIds: true,
      uniqueIndexes: [{ table: 'runs', name: 'idx_runs_external_id', columns: ['user_id', 'external_id'] }],
      primaryKeys: { strava_tokens: ['user_id'] },
    }).client as any,
  );

  const userOfCall = (headers: Record<string, string>): UserId => (headers.authorization === `Bearer ${accessTokenOf('user-2')}` ? 'user-2' : 'user-1');
  const fake = installFakeStravaFetch({
    athleteActivities: (call) => activitiesOf(userOfCall(call.headers)),
    activities: Object.fromEntries(USERS.flatMap((userId) => activitiesOf(userId).map((activity) => [activity.id, activity]))),
  });
  strava = fake;

  const gates = new Map(hold.map((userId) => [userId, deferred()]));
  releaseAll = () => gates.forEach((gate) => gate.resolve());
  const listCalls = { order: [] as UserId[], open: 0 };
  const stubbed = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes('/athlete/activities')) return stubbed(input, init);
    const userId: UserId = new Headers(init?.headers).get('authorization') === `Bearer ${accessTokenOf('user-2')}` ? 'user-2' : 'user-1';
    listCalls.order.push(userId);
    listCalls.open += 1;
    try {
      await gates.get(userId)?.promise;
      return await stubbed(input, init);
    } finally {
      listCalls.open -= 1;
    }
  }) as typeof fetch;

  const tokenRow = (userId: UserId) => tables.strava_tokens.find((row) => row.user_id === userId);
  return { tables, listCalls, fake, tokenRow, release: (userId: UserId) => gates.get(userId)?.resolve() };
}

/**
 * Replaces the database with one whose reads of the pause state (a select of sync_paused on strava_tokens) fail while
 * `on` is true. Every other query, including the token read and the pause writes, works as before.
 */
function failPauseReads(tables: Record<string, Row[]>) {
  const failing = { on: true };
  vi.mocked(getSupabaseClient).mockReturnValue(
    createFakeDb(tables, {
      autoIds: true,
      uniqueIndexes: [{ table: 'runs', name: 'idx_runs_external_id', columns: ['user_id', 'external_id'] }],
      primaryKeys: { strava_tokens: ['user_id'] },
      failWhen: (q) => (failing.on && q.table === 'strava_tokens' && !q.mutation && q.select?.includes('sync_paused') ? { message: 'boom' } : null),
    }).client as any,
  );
  return failing;
}

const as = (userId: UserId) => mintToken({ user_id: userId, group_id: 'group-1' });
const putPaused = (userId: UserId, body: unknown) => server.request('PUT', '/api/strava/sync-paused', { token: as(userId), body });
const manualSync = (userId: UserId) => server.request('POST', '/api/strava/sync', { token: as(userId) });
const statusOf = (userId: UserId) => server.request('GET', '/api/strava/status', { token: as(userId) });
// A negative ("has not reached Strava") can only be asserted after giving the competing work time to get there.
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 100));

describe('PUT /api/strava/sync-paused', () => {
  it('PUT sync-paused sets the flag and paused_at for the caller only', async () => {
    const { tokenRow } = setup();
    const before = Date.now();

    const res = await putPaused('user-1', { paused: true });
    const after = Date.now();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { sync_paused: true, paused_at: expect.any(String) } });
    const pausedAt = Date.parse(res.body.data.paused_at);
    expect(pausedAt).toBeGreaterThanOrEqual(before);
    expect(pausedAt).toBeLessThanOrEqual(after);
    expect(tokenRow('user-1')).toMatchObject({ sync_paused: true, paused_at: res.body.data.paused_at });
    expect(tokenRow('user-2')).toMatchObject({ sync_paused: false, paused_at: null }); // another user's row is untouched
  });

  it('PUT sync-paused with false clears paused_at', async () => {
    const { tokenRow, tables } = setup({ paused: ['user-1', 'user-2'] });

    const res = await putPaused('user-1', { paused: false });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { sync_paused: false, paused_at: null } });
    expect(tokenRow('user-1')).toMatchObject({ sync_paused: false, paused_at: null });
    expect(tokenRow('user-2')).toMatchObject({ sync_paused: true, paused_at: '2026-10-01T08:00:00.000Z' });
    await vi.waitFor(() => expect(tables.runs).toHaveLength(1)); // let the resume sync finish before teardown
  });

  it.each([
    ['a string', { paused: 'true' }],
    ['a number', { paused: 1 }],
    ['null', { paused: null }],
    ['a missing key', {}],
    ['an extra key', { paused: true, userId: 'user-2' }],
    ['an array', [true]],
  ])('PUT sync-paused rejects a body that is not a boolean with 400 (%s)', async (_label, body) => {
    const { tokenRow, listCalls } = setup();

    const res = await putPaused('user-1', body);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Body must be exactly { "paused": boolean }' });
    expect(tokenRow('user-1')).toMatchObject({ sync_paused: false, paused_at: null });
    await settle();
    expect(listCalls.order).toEqual([]);
  });

  it('PUT sync-paused rejects a request without a body, and a body that is not an object, with 400', async () => {
    const { tokenRow } = setup();

    expect((await server.request('PUT', '/api/strava/sync-paused', { token: as('user-1') })).status).toBe(400);
    expect((await putPaused('user-1', 'true')).status).toBe(400); // the JSON parser itself refuses a bare string
    expect(tokenRow('user-1')).toMatchObject({ sync_paused: false, paused_at: null });
  });

  it('PUT sync-paused requires authentication', async () => {
    const { tokenRow } = setup();

    const res = await server.request('PUT', '/api/strava/sync-paused', { body: { paused: true } });

    expect(res.status).toBe(401);
    expect(tokenRow('user-1')).toMatchObject({ sync_paused: false });
  });

  it('PUT sync-paused for a user without a Strava connection returns 400', async () => {
    const { tables } = setup({ unconnected: ['user-1'] });

    for (const paused of [true, false]) {
      const res = await putPaused('user-1', { paused });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'User not connected to Strava' });
    }
    expect(tables.strava_tokens.map((row) => row.user_id)).toEqual(['user-2']);
  });

  it('pausing twice keeps the first paused_at', async () => {
    const { tokenRow } = setup();

    const first = await putPaused('user-1', { paused: true });
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    const second = await putPaused('user-1', { paused: true });

    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(tokenRow('user-1')?.paused_at).toBe(first.body.data.paused_at);
  });

  it('resuming a user that is not paused is a no-op that starts no sync', async () => {
    const { tokenRow, listCalls } = setup();

    const res = await putPaused('user-1', { paused: false });
    await settle();

    expect(res.body).toEqual({ success: true, data: { sync_paused: false, paused_at: null } });
    expect(tokenRow('user-1')).toMatchObject({ sync_paused: false, paused_at: null });
    expect(listCalls.order).toEqual([]);
  });

  it('pausing does not start a sync', async () => {
    const { listCalls } = setup();

    await putPaused('user-1', { paused: true });
    await settle();

    expect(listCalls.order).toEqual([]);
  });

  it('PUT sync-paused answers 500 and changes nothing when the database fails', async () => {
    const { tables } = setup();
    vi.mocked(getSupabaseClient).mockReturnValue(
      createFakeDb(tables, { errors: { strava_tokens: { message: 'boom' } } }).client as any,
    );

    const res = await putPaused('user-1', { paused: true });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to update sync pause' });
    expect(tables.strava_tokens[0]).toMatchObject({ sync_paused: false, paused_at: null });
  });
});

describe('GET /api/strava/status', () => {
  it('status includes sync_paused and paused_at', async () => {
    setup({ paused: ['user-1'] });

    const paused = await statusOf('user-1');
    const active = await statusOf('user-2');

    expect(paused.body).toMatchObject({ connected: true, sync_paused: true, paused_at: '2026-10-01T08:00:00.000Z' });
    expect(active.body).toMatchObject({ connected: true, sync_paused: false, paused_at: null });
  });

  it('status reports the pause also when the expired token is refreshed or cannot be', async () => {
    const { tokenRow } = setup({ paused: ['user-1'] });
    tokenRow('user-1')!.expires_at = 1;
    strava!.restore();
    strava = installFakeStravaFetch({
      oauthToken: { token_type: 'Bearer', access_token: 'new-at', refresh_token: 'new-rt', expires_at: 9999999999, expires_in: 21600 },
    });

    const refreshed = await statusOf('user-1');
    expect(refreshed.body).toMatchObject({ connected: true, auto_refreshed: true, sync_paused: true, paused_at: '2026-10-01T08:00:00.000Z' });

    strava.restore();
    strava = installFakeStravaFetch({ oauthToken: stravaError(400) });
    tokenRow('user-1')!.expires_at = 1;
    const failed = await statusOf('user-1');
    expect(failed.body).toMatchObject({ connected: true, refresh_failed: true, sync_paused: true, paused_at: '2026-10-01T08:00:00.000Z' });
  });

  it('status answers 500, not sync_paused false, when the pause state cannot be read', async () => {
    const { tables } = setup();
    failPauseReads(tables);

    const res = await statusOf('user-1');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to check Strava status' });
  });

  it('status for a user without a connection does not mention the pause', async () => {
    setup({ unconnected: ['user-1'] });

    const res = await statusOf('user-1');

    expect(res.body).toEqual({ connected: false, expired: false });
  });
});

describe('polling and manual sync respect the pause', () => {
  it('scheduled sync skips paused users', async () => {
    const { tables, listCalls } = setup({ paused: ['user-1'] });

    const result = await syncAllStravaUsers();

    expect(listCalls.order).toEqual(['user-2']); // the paused user never reached Strava
    // The paused user is left out by the selection itself, so it never reaches the lock or the token path.
    expect(result.totalUsers).toBe(1);
    expect(result.results.map((r) => r.userId)).toEqual(['user-2']);
    expect(tables.runs.map((run) => run.user_id)).toEqual(['user-2']);
  });

  it('manual sync for a paused user returns 409 Sync is paused', async () => {
    const { tables, listCalls } = setup({ paused: ['user-1'] });

    const res = await manualSync('user-1');
    await settle();

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Sync is paused' });
    expect(listCalls.order).toEqual([]);
    expect(tables.runs).toEqual([]);
  });

  it('a manual sync of a user that is not paused still works', async () => {
    const { tables } = setup({ paused: ['user-1'] });

    const res = await manualSync('user-2');

    expect(res.body).toMatchObject({ success: true, newRuns: 1 });
    expect(tables.runs.map((run) => run.user_id)).toEqual(['user-2']);
  });

  it('manual sync for a user without a connection still says so', async () => {
    setup({ unconnected: ['user-1'] });

    const res = await manualSync('user-1');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'User not connected to Strava' });
  });

  it('a manual sync that cannot read the pause state fails closed', async () => {
    const { tables, listCalls } = setup();
    vi.mocked(getSupabaseClient).mockReturnValue(
      createFakeDb(tables, { errors: { strava_tokens: { message: 'boom' } } }).client as any,
    );

    const res = await manualSync('user-1');

    expect(res.status).toBe(500);
    expect(listCalls.order).toEqual([]);
  });

  it('a manual sync queued behind the lock does not import when the user pauses in between', async () => {
    const { tables, listCalls, release } = setup({ hold: ['user-1'] });

    const first = manualSync('user-1');
    await vi.waitFor(() => expect(listCalls.order).toEqual(['user-1']));
    const queued = manualSync('user-1'); // passes the pause check (not paused yet) and waits for the lock
    await settle();
    await putPaused('user-1', { paused: true });
    release('user-1');

    // The sync that started before the pause may finish (ADR 010 decision 7.5); the queued one must not run.
    expect((await first).body).toMatchObject({ success: true, newRuns: 1 });
    const queuedResult = await queued;
    expect(queuedResult.status).toBe(409);
    expect(queuedResult.body).toEqual({ error: 'Sync is paused' });
    expect(listCalls.order).toEqual(['user-1']);
    expect(tables.runs).toHaveLength(1);
  });

  it('a manual sync queued behind the lock does not import when the pause state cannot be read inside the lock', async () => {
    const { tables, listCalls, release } = setup({ hold: ['user-1'] });
    const failing = failPauseReads(tables);
    failing.on = false;

    const first = manualSync('user-1');
    await vi.waitFor(() => expect(listCalls.order).toEqual(['user-1']));
    const queued = manualSync('user-1'); // its pause check before the lock passed; the read inside the lock fails
    await settle();
    failing.on = true;
    release('user-1');

    expect((await first).body).toMatchObject({ success: true, newRuns: 1 });
    const queuedResult = await queued;
    expect(queuedResult.status).toBe(400);
    expect(queuedResult.body).toEqual({ error: 'Failed to sync activities' });
    expect(listCalls.order).toEqual(['user-1']); // the queued sync never reached Strava
    expect(tables.runs).toHaveLength(1);
  });

  it('a scheduled sync queued behind the lock does not import when the user pauses in between', async () => {
    const { tables, listCalls, release } = setup({ hold: ['user-1'] });

    const manual = manualSync('user-1');
    await vi.waitFor(() => expect(listCalls.order).toEqual(['user-1']));
    const scheduled = syncAllStravaUsers(); // selected user-1 while active, then waits for the lock
    await settle();
    await putPaused('user-1', { paused: true });
    release('user-1');

    expect((await manual).body).toMatchObject({ success: true, newRuns: 1 });
    const result = await scheduled;
    expect(result.results.map((r) => r.userId)).toEqual(['user-2']);
    expect(listCalls.order.filter((userId) => userId === 'user-1')).toHaveLength(1);
    expect(tables.runs.filter((run) => run.user_id === 'user-1')).toHaveLength(1);
  });
});

describe('resume', () => {
  it('resuming starts an immediate sync for the user in the background and responds without waiting for it', async () => {
    const { tables, listCalls, release } = setup({ hold: ['user-1'], paused: ['user-1'] });

    const res = await putPaused('user-1', { paused: false });

    // The response is here while the sync it started is still waiting on Strava.
    expect(res.body).toEqual({ success: true, data: { sync_paused: false, paused_at: null } });
    await vi.waitFor(() => expect(listCalls.order).toEqual(['user-1']));
    expect(listCalls.open).toBe(1);
    expect(tables.runs).toEqual([]);

    release('user-1');
    await vi.waitFor(() => expect(tables.runs.map((run) => run.external_id)).toEqual(['4001']));
  });

  it('first sync after resume fetches activities created during the pause', async () => {
    const today = stockholmDay(new Date());
    const lastImportedDay = addDays(today, -10);
    const during = stravaActivity({ id: 5002, start_date: new Date().toISOString(), start_date_local: new Date().toISOString() });
    const { tables, listCalls } = setup({
      activities: (userId) => (userId === 'user-1' ? [during] : []),
      runs: [{ id: 'old', user_id: 'user-1', source: 'strava', external_id: '5001', date: lastImportedDay, distance: 5, xp_gained: 10 }],
    });

    await putPaused('user-1', { paused: true });
    const scheduled = await syncAllStravaUsers();
    const manual = await manualSync('user-1');
    // Nothing is fetched during the pause: not by polling, not by a manual sync.
    expect(scheduled.results.map((r) => r.userId)).toEqual(['user-2']);
    expect(manual.status).toBe(409);
    expect(listCalls.order).toEqual(['user-2']);
    expect(tables.runs.filter((run) => run.user_id === 'user-1').map((run) => run.external_id)).toEqual(['5001']);

    await putPaused('user-1', { paused: false });

    await vi.waitFor(() => expect(tables.runs.filter((run) => run.user_id === 'user-1').map((run) => run.external_id).sort()).toEqual(['5001', '5002']));
    const resumeCall = strava!.requests.filter((call) => call.route === 'athleteActivities').at(-1)!;
    // The list starts 7 days before the latest imported run, so the whole pause is covered.
    expect(Number(resumeCall.query.after)).toBe(stravaLookback([lastImportedDay], null, new Date()).after);
    expect(listCalls.order).toEqual(['user-2', 'user-1']);
  });
});
