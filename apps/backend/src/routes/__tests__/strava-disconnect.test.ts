/**
 * DELETE /api/strava/disconnect (ADR 010 decision 7.4): "Disconnect" asks Strava to revoke the authorisation, then removes the user's
 * Strava runs and, last, the token row. Through the real app: the database is createFakeDb (with the foreign keys of runs(id)), the
 * network is installFakeStravaFetch (an unconfigured Strava URL fails the test), the lock is the real withUserLock. Mocked at the
 * edge: reprocessRunsFromDate and calculateUserTotals, which are asserted as calls.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { STRAVA_CONSENT_VERSION, stockholmDay, stockholmMidnightIso } from '@runquest/shared';

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
// The 10-per-minute limit on disconnect has its own file (strava-disconnect-rate-limit.test.ts); this file makes more calls than that.
vi.mock('../../middleware/rateLimit.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../middleware/rateLimit.js')>()),
  createRateLimiter: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../runs.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../runs.js')>()),
  reprocessRunsFromDate: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../utils/calculateUserTotals.js', () => ({ calculateUserTotals: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../utils/keyedMutex.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/keyedMutex.js')>();
  return { ...actual, withUserLock: vi.fn(actual.withUserLock) };
});
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

import { getSupabaseClient } from '../../config/database.js';
import { calculateUserTotals } from '../../utils/calculateUserTotals.js';
import { withUserLock } from '../../utils/keyedMutex.js';
import { logger } from '../../utils/logger.js';
import { reprocessRunsFromDate } from '../runs.js';
import app from '../../app.js';
import { createStravaWebhookWorker } from '../../services/stravaWebhookWorker.js';
import { STRAVA_WEBHOOK_HANDLERS } from '../../services/stravaWebhook/handlers.js';
import { createRunStore, createStravaApi } from '../../services/stravaWebhook/supabaseAdapters.js';
import { removeStravaConnection } from '../../services/stravaConnection.js';
import { withRunForeignKeys } from '../../test-utils/runForeignKeys.js';
import { createInMemoryRecompute, createInMemoryWebhookStore } from '../../test-utils/inMemoryWebhookPorts.js';
import {
  installFakeStravaFetch,
  stravaActivity,
  stravaDeauthorizeEvent,
  stravaError,
  stravaEvent,
  stravaTokenResponse,
  type FakeStrava,
  type FakeStravaRoutes,
} from '../../test-utils/fakeStrava.js';
import { createFakeDb, type FakeDbOptions, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });

let strava: FakeStrava | undefined;
let releaseLock: (() => void) | undefined;
let lines: string[];

beforeEach(() => {
  vi.clearAllMocks();
  lines = [];
  for (const level of ['info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
      lines.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg, Object.getOwnPropertyNames(Object(arg))))).join(' '));
    });
  }
});
afterEach(() => {
  releaseLock?.(); // a failed assertion must not leave a request waiting on the lock, or afterAll's server.close() never returns
  releaseLock = undefined;
  vi.restoreAllMocks(); // before strava.restore(): a spy on fetch sits on top of the fake
  strava?.restore();
  strava = undefined;
});

const NEVER_LOGGED = ['SECRET-ACCESS', 'SECRET-REFRESH', 'SECRET-ACCESS-2', '424242', '1001', '1002', 'Morning Run'];

const run = (over: Row = {}): Row => ({
  id: 'r1', user_id: 'user-1', source: 'strava', external_id: '1001', date: '2026-10-01', distance: 5, xp_gained: 55, streak_day: 1, ...over,
});
const tokenRow = (over: Row = {}): Row => ({
  user_id: 'user-1',
  strava_athlete_id: 424242,
  access_token: 'SECRET-ACCESS',
  refresh_token: 'SECRET-REFRESH',
  expires_at: 9_999_999_999,
  connection_date: '2026-09-01T09:00:00+00:00',
  consent_version: '2026-10-14',
  consented_at: '2026-10-14T09:30:00.000Z',
  sync_paused: false,
  paused_at: null,
  ...over,
});

interface Setup {
  runs?: Row[];
  tokens?: Row[];
  extra?: Record<string, Row[]>;
  failWhen?: FakeDbOptions['failWhen'];
  strava?: FakeStravaRoutes;
}

function setup({ runs = [run()], tokens = [tokenRow()], extra = {}, failWhen, strava: stravaRoutes }: Setup = {}) {
  const tables: Record<string, Row[]> = { runs, strava_tokens: tokens, user_boosts: [], ...extra };
  const db = createFakeDb(tables, {
    autoIds: true,
    failWhen,
    uniqueIndexes: [{ table: 'runs', name: 'idx_runs_external_id', columns: ['user_id', 'external_id'] }],
    primaryKeys: { strava_tokens: ['user_id'] },
  });
  vi.mocked(getSupabaseClient).mockReturnValue(withRunForeignKeys(db.client, tables) as any);
  strava?.restore();
  strava = installFakeStravaFetch({ oauthDeauthorize: { access_token: 'SECRET-ACCESS' }, ...stravaRoutes });
  return { tables, db };
}

const disconnect = (userId = 'user-1', body?: unknown) =>
  server.request('DELETE', '/api/strava/disconnect', { token: mintToken({ user_id: userId, group_id: 'group-1' }), body });
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 100));
const lockCallsFor = (userId: string) => vi.mocked(withUserLock).mock.calls.filter(([key]) => key === userId).length;

describe('DELETE /api/strava/disconnect', () => {
  it('disconnect revokes the Strava authorization before deleting any run or the token row', async () => {
    let seen: { runs: number; tokens: number } | undefined;
    const { tables } = setup({
      runs: [run(), run({ id: 'r2', external_id: '1002', date: '2026-10-02' })],
      strava: {
        oauthDeauthorize: () => {
          seen = { runs: tables.runs.length, tokens: tables.strava_tokens.length };
          return { access_token: 'SECRET-ACCESS' };
        },
      },
    });

    const res = await disconnect();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'Strava disconnected successfully' });
    expect(strava!.requests).toHaveLength(1);
    expect(strava!.requests[0]).toMatchObject({ route: 'oauthDeauthorize', method: 'POST', body: { access_token: 'SECRET-ACCESS' } });
    expect(seen).toEqual({ runs: 2, tokens: 1 }); // everything was still there when Strava was asked
    expect(tables.runs).toEqual([]);
    expect(tables.strava_tokens).toEqual([]);
  });

  it('disconnect continues and logs a warning when Strava answers 401, 5xx or a network error on revoke', async () => {
    const failures: Array<{ expectedCode: string; deauthorize: FakeStravaRoutes['oauthDeauthorize'] }> = [
      { expectedCode: 'strava_401', deauthorize: stravaError(401) },
      { expectedCode: 'strava_503', deauthorize: stravaError(503) },
      {
        expectedCode: 'strava_network',
        deauthorize: () => {
          throw new TypeError('fetch failed: ECONNRESET for token SECRET-ACCESS');
        },
      },
    ];

    for (const { expectedCode, deauthorize } of failures) {
      lines.length = 0;
      const { tables } = setup({ strava: { oauthDeauthorize: deauthorize } });

      const res = await disconnect();

      expect(res.status, expectedCode).toBe(200);
      expect(res.body).toEqual({ success: true, message: 'Strava disconnected successfully' });
      expect(tables.runs, expectedCode).toEqual([]);
      expect(tables.strava_tokens, expectedCode).toEqual([]);
      const warning = lines.find((line) => line.includes('revoke at Strava failed'));
      expect(warning, expectedCode).toContain('user user-1');
      expect(warning, expectedCode).toContain(expectedCode);
      expect(lines.filter((line) => line.includes('SECRET'))).toEqual([]);
    }
  });

  it('disconnect continues and warns with its own code when Strava rejects the refresh token or the token row cannot be read', async () => {
    const cases: Array<{ expectedCode: string; options: Setup }> = [
      {
        expectedCode: 'strava_refresh_rejected',
        options: {
          tokens: [tokenRow({ expires_at: 1 })],
          strava: { oauthToken: stravaError(400, { body: { message: 'Bad Request', errors: [{ resource: 'RefreshToken', field: 'refresh_token', code: 'invalid' }] } }) },
        },
      },
      {
        expectedCode: 'strava_token_read_failed',
        // Only the token lookup of the revoke selects the refresh token; the removal reads other columns.
        options: { failWhen: (q) => (q.table === 'strava_tokens' && q.select?.includes('refresh_token') ? { message: 'connection reset' } : null) },
      },
    ];

    for (const { expectedCode, options } of cases) {
      lines.length = 0;
      const { tables } = setup(options);

      const res = await disconnect();

      expect(res.status, expectedCode).toBe(200);
      expect(tables.runs, expectedCode).toEqual([]);
      expect(tables.strava_tokens, expectedCode).toEqual([]);
      expect(strava!.calls.oauthDeauthorize, expectedCode).toBe(0);
      const warning = lines.find((line) => line.includes('revoke at Strava failed'));
      expect(warning, expectedCode).toContain('user user-1');
      expect(warning, expectedCode).toContain(expectedCode);
      expect(lines.filter((line) => line.includes('SECRET'))).toEqual([]);
    }
  });

  it('disconnect deletes the strava runs first and the token row last', async () => {
    const { tables, db } = setup({ runs: [run(), run({ id: 'r2', external_id: '1002', date: '2026-10-02' })] });
    const rowsDuringRecompute: number[] = [];
    vi.mocked(reprocessRunsFromDate).mockImplementation(async () => { rowsDuringRecompute.push(tables.strava_tokens.length); });

    const res = await disconnect();

    expect(res.status).toBe(200);
    expect(db.queries.filter((q) => q.mutation === 'delete').map((q) => q.table)).toEqual(['runs', 'strava_tokens']);
    expect(rowsDuringRecompute).toEqual([1]); // the row outlives the recompute
  });

  it('disconnect keeps manual runs and event xp', async () => {
    const { tables } = setup({
      runs: [
        run({ id: 'a', external_id: '1001' }),
        run({ id: 'manual', source: 'manual', external_id: null, date: '2026-09-20' }),
        run({ id: 'manual-same-id', source: 'manual', external_id: '1001', date: '2026-09-21' }),
      ],
      extra: {
        event_entries: [{ id: 'e1', user_id: 'user-1', run_id: 'a', xp_awarded: 120 }],
        users: [{ id: 'user-1', event_xp: 120 }],
      },
    });

    const res = await disconnect();

    expect(res.status).toBe(200);
    expect(tables.runs.map((r) => r.id).sort()).toEqual(['manual', 'manual-same-id']);
    expect(tables.event_entries).toEqual([{ id: 'e1', user_id: 'user-1', run_id: null, xp_awarded: 120 }]);
    expect(tables.users).toEqual([{ id: 'user-1', event_xp: 120 }]);
  });

  it('disconnect recomputes totals and badges once for the user', async () => {
    setup({
      runs: [
        run({ id: 'a', external_id: '1001', date: '2026-10-05' }),
        run({ id: 'b', external_id: '1002', date: '2026-09-01' }),
        run({ id: 'c', external_id: '1003', date: '2026-10-06' }),
      ],
    });

    await disconnect();

    expect(reprocessRunsFromDate).toHaveBeenCalledTimes(1);
    expect(reprocessRunsFromDate).toHaveBeenCalledWith('user-1', '2026-09-01');
    expect(calculateUserTotals).toHaveBeenCalledTimes(1);
    expect(calculateUserTotals).toHaveBeenCalledWith('user-1');
  });

  it('disconnect can be rerun after a crash between the runs and the token row', async () => {
    let tokenDeleteFails = true;
    const { tables } = setup({
      failWhen: (q) => (tokenDeleteFails && q.table === 'strava_tokens' && q.mutation === 'delete' ? ({ message: 'connection to 10.0.0.7 lost', code: '57P01' } as never) : null),
    });

    const crashed = await disconnect();

    expect(crashed.status).toBe(500);
    expect(crashed.body).toEqual({ error: 'Failed to disconnect Strava' }); // no code, no message
    expect(tables.runs).toEqual([]);
    expect(tables.strava_tokens).toHaveLength(1);

    tokenDeleteFails = false;
    const rerun = await disconnect();

    expect(rerun.status).toBe(200);
    expect(rerun.body).toEqual({ success: true, message: 'Strava disconnected successfully' });
    expect(tables.strava_tokens).toEqual([]);
  });

  it('disconnect answers a failure when the recompute throws, keeps the row and can be repeated with the same call', async () => {
    const { tables } = setup();
    vi.mocked(reprocessRunsFromDate).mockRejectedValueOnce(Object.assign(new Error('failed for 59.3293,18.0686'), { code: 'XX000' }));

    const failed = await disconnect();

    expect(failed.status).toBe(500);
    expect(failed.body).toEqual({ error: 'Failed to disconnect Strava' });
    expect(tables.strava_tokens).toHaveLength(1);
    expect(lines.filter((line) => line.includes('59.3293'))).toEqual([]);

    const repeated = await disconnect();

    expect(repeated.status).toBe(200);
    expect(tables.strava_tokens).toEqual([]);
  });

  it('disconnect logs user id, consent version and consent time but never a token', async () => {
    setup({ tokens: [tokenRow({ access_token: 'SECRET-ACCESS', refresh_token: 'SECRET-REFRESH' })] });

    await disconnect();

    expect(lines.some((line) => line.includes('user_id=user-1 consent_version=2026-10-14 consented_at=2026-10-14T09:30:00.000Z'))).toBe(true);
    expect(lines.filter((line) => NEVER_LOGGED.some((secret) => line.includes(secret)))).toEqual([]);
  });

  it('disconnect only affects the calling user', async () => {
    const { tables } = setup({
      runs: [run(), run({ id: 'r2', user_id: 'user-2', external_id: '2001', date: '2026-10-03' })],
      tokens: [tokenRow(), tokenRow({ user_id: 'user-2', strava_athlete_id: 7, access_token: 'SECRET-ACCESS-2', refresh_token: 'SECRET-REFRESH-2' })],
    });

    // The body is ignored: the caller's own row is the only one the route can reach.
    const res = await disconnect('user-1', { user_id: 'user-2', userId: 'user-2' });

    expect(res.status).toBe(200);
    expect(tables.runs.map((r) => r.user_id)).toEqual(['user-2']);
    expect(tables.strava_tokens.map((t) => t.user_id)).toEqual(['user-2']);
    expect(strava!.requests).toHaveLength(1);
    expect(strava!.requests[0].body).toEqual({ access_token: 'SECRET-ACCESS' }); // user-1's token, not user-2's
    expect(reprocessRunsFromDate).toHaveBeenCalledWith('user-1', expect.any(String));
    expect(calculateUserTotals).toHaveBeenCalledTimes(1);
  });

  it('disconnect for a paused user deletes the runs as usual', async () => {
    const { tables } = setup({ tokens: [tokenRow({ sync_paused: true, paused_at: '2026-10-10T08:00:00+00:00' })] });

    const res = await disconnect();

    expect(res.status).toBe(200);
    expect(tables.runs).toEqual([]);
    expect(tables.strava_tokens).toEqual([]); // the pause state goes with the row
  });

  it('disconnect answers 200 and writes nothing for a user without a connection or runs', async () => {
    const { tables, db } = setup({ runs: [run({ id: 'manual', source: 'manual', external_id: null })], tokens: [] });

    const res = await disconnect();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'Strava disconnected successfully' });
    expect(strava!.requests).toEqual([]); // no token, nothing to revoke
    expect(db.queries.filter((q) => q.mutation !== undefined)).toEqual([]);
    expect(tables.runs).toHaveLength(1);
  });

  it('GET status says not connected after a completed disconnect', async () => {
    setup();
    await disconnect();

    const status = await server.request('GET', '/api/strava/status', { token: mintToken({ user_id: 'user-1', group_id: 'group-1' }) });

    expect(status.body).toEqual({ connected: false, expired: false });
  });

  it('disconnect needs a signed-in user', async () => {
    setup();

    const res = await server.request('DELETE', '/api/strava/disconnect');

    expect(res.status).toBe(401);
    expect(strava!.requests).toEqual([]);
  });
});

describe('the user lock around a disconnect', () => {
  it('disconnect takes the user lock once for the whole removal', async () => {
    setup();

    const res = await disconnect();

    expect(res.status).toBe(200);
    expect(lockCallsFor('user-1')).toBe(1);
    // A second, nested lock (in the revoke hook) would be a ReentrantLockError, swallowed as a warning, and the revoke skipped.
    expect(strava!.calls.oauthDeauthorize).toBe(1);
    expect(lines.filter((line) => line.includes('revoke at Strava failed'))).toEqual([]);
  });

  it('disconnect waits for the lock the user already holds and then does everything', async () => {
    const { tables } = setup();
    const held = new Promise<void>((resolve) => { releaseLock = resolve; });
    const holder = withUserLock('user-1', () => held);

    const pending = disconnect();
    await settle();
    expect(strava!.calls.oauthDeauthorize).toBe(0);
    expect(tables.runs).toHaveLength(1);
    expect(tables.strava_tokens).toHaveLength(1);

    releaseLock!();
    await holder;
    const res = await pending;

    expect(res.status).toBe(200);
    expect(strava!.calls.oauthDeauthorize).toBe(1);
    expect(tables.runs).toEqual([]);
    expect(tables.strava_tokens).toEqual([]);
  });

  it('a reconnect waits for an ongoing disconnect and ends connected', async () => {
    const { tables } = setup({ strava: { oauthToken: stravaTokenResponse({ access_token: 'NEW-ACCESS', refresh_token: 'NEW-REFRESH', athlete: { id: 424242 } }) } });
    const token = mintToken({ user_id: 'user-1', group_id: 'group-1' });
    const held = new Promise<void>((resolve) => { releaseLock = resolve; });
    const holder = withUserLock('user-1', () => held);

    const pendingDisconnect = disconnect();
    await settle();
    const pendingReconnect = server.request('POST', '/api/strava/callback', { token, body: { code: 'fresh-code', consent_version: STRAVA_CONSENT_VERSION } });
    await settle();
    // Neither has started: not even the code is exchanged, so a new authorisation cannot be revoked by the disconnect in front of it.
    expect(strava!.calls.oauthToken).toBe(0);
    expect(tables.strava_tokens[0]).toMatchObject({ access_token: 'SECRET-ACCESS' });

    releaseLock!();
    await holder;
    const [disconnected, reconnected] = await Promise.all([pendingDisconnect, pendingReconnect]);

    expect(disconnected.status).toBe(200);
    expect(reconnected.status).toBe(200);
    expect(strava!.requests.map((call) => call.route)).toEqual(['oauthDeauthorize', 'oauthToken']);
    expect(tables.runs).toEqual([]);
    expect(tables.strava_tokens).toHaveLength(1);
    expect(tables.strava_tokens[0]).toMatchObject({ access_token: 'NEW-ACCESS', refresh_token: 'NEW-REFRESH' });
  });

  it('a sync that queued behind the disconnect answers not connected and never reaches Strava', async () => {
    const { tables } = setup({ strava: { athleteActivities: [stravaActivity({ id: 5001 })] } });
    const held = new Promise<void>((resolve) => { releaseLock = resolve; });
    const holder = withUserLock('user-1', () => held);

    const pendingDisconnect = disconnect();
    await settle();
    const pendingSync = server.request('POST', '/api/strava/sync', { token: mintToken({ user_id: 'user-1', group_id: 'group-1' }) });
    await settle();

    releaseLock!();
    await holder;
    const [disconnected, synced] = await Promise.all([pendingDisconnect, pendingSync]);

    expect(disconnected.status).toBe(200);
    expect(synced.status).toBe(400);
    expect(synced.body).toEqual({ error: 'User not connected to Strava' });
    expect(strava!.calls.athleteActivities).toBe(0);
    expect(tables.runs).toEqual([]);
  });
});

describe('after a disconnect', () => {
  it('a deauthorize event arriving after a completed disconnect is a no-op', async () => {
    const { tables, db } = setup({ runs: [run(), run({ id: 'manual', source: 'manual', external_id: null, date: '2026-09-20' })] });
    await disconnect();
    const writesAfterDisconnect = db.queries.filter((q) => q.mutation !== undefined).length;

    // Strava's `athlete` event, queued for the user before the row went; the worker meets it with today's registry.
    const event = stravaDeauthorizeEvent({ owner_id: 424242 });
    const store = createInMemoryWebhookStore({ now: () => new Date() });
    store.seed({ object_type: 'athlete', aspect_type: 'update', object_id: event.object_id, owner_id: event.owner_id, updates: event.updates, user_id: 'user-1' });
    const recompute = createInMemoryRecompute();
    await createStravaWebhookWorker({ store, strava: createStravaApi(), runs: createRunStore(), recompute, handlers: STRAVA_WEBHOOK_HANDLERS }).drain();

    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'noop' });
    expect(db.queries.filter((q) => q.mutation !== undefined)).toHaveLength(writesAfterDisconnect); // nothing written
    expect(recompute.calls.filter((call) => call.kind === 'reprocess')).toEqual([]);
    expect(tables.runs.map((r) => r.id)).toEqual(['manual']);
    expect(strava!.requests.filter((call) => call.route !== 'oauthDeauthorize')).toEqual([]);
  });

  it('a second removal as a deauthorize after a completed disconnect writes nothing and recomputes nothing', async () => {
    const { db } = setup();
    await disconnect();
    const writes = db.queries.filter((q) => q.mutation !== undefined).length;
    vi.mocked(reprocessRunsFromDate).mockClear();
    vi.mocked(calculateUserTotals).mockClear();

    await withUserLock('user-1', () => removeStravaConnection('user-1', { reason: 'deauthorized' }));

    expect(db.queries.filter((q) => q.mutation !== undefined)).toHaveLength(writes);
    expect(reprocessRunsFromDate).not.toHaveBeenCalled();
    expect(calculateUserTotals).not.toHaveBeenCalled();
  });

  it('reconnecting after disconnect starts syncing from the new connection date and does not bring back the deleted history', async () => {
    const connectionDay = stockholmDay(new Date());
    const oldActivity = stravaActivity({ id: 1001, start_date_local: '2026-10-01T07:30:00Z' });
    const todaysActivity = stravaActivity({ id: 7001, start_date_local: `${connectionDay}T12:00:00Z` });
    const { tables } = setup({
      runs: [run({ id: 'a', external_id: '1001', date: '2026-10-01' }), run({ id: 'b', external_id: '1002', date: '2026-10-02' })],
      strava: {
        oauthToken: stravaTokenResponse({ access_token: 'NEW-ACCESS', refresh_token: 'NEW-REFRESH', athlete: { id: 424242 } }),
        athleteActivities: [oldActivity, todaysActivity],
        activities: { 1001: oldActivity },
      },
    });
    const token = mintToken({ user_id: 'user-1', group_id: 'group-1' });

    expect((await disconnect()).status).toBe(200);
    expect(tables.runs).toEqual([]);

    const reconnected = await server.request('POST', '/api/strava/callback', { token, body: { code: 'fresh-code', consent_version: STRAVA_CONSENT_VERSION } });
    expect(reconnected.status).toBe(200);
    expect(tables.strava_tokens).toHaveLength(1);
    expect(tables.strava_tokens[0]).toMatchObject({ access_token: 'NEW-ACCESS', sync_paused: false });
    expect(stockholmDay(new Date(tables.strava_tokens[0].connection_date))).toBe(connectionDay);

    // The first poll asks Strava from the connection day, not from the deleted runs.
    const synced = await server.request('POST', '/api/strava/sync', { token });
    expect(synced.status).toBe(200);
    const listCall = strava!.requests.find((call) => call.route === 'athleteActivities')!;
    expect(Number(listCall.query.after)).toBe(Date.parse(stockholmMidnightIso(connectionDay)) / 1000);
    expect(tables.runs.map((r) => r.external_id)).toEqual(['7001']);

    // And a webhook event for the old activity is turned away by the connection day rule.
    const store = createInMemoryWebhookStore({ now: () => new Date() });
    const create = stravaEvent({ object_id: 1001, owner_id: 424242 });
    store.seed({ object_type: 'activity', aspect_type: 'create', object_id: create.object_id, owner_id: create.owner_id, user_id: 'user-1' });
    await createStravaWebhookWorker({
      store,
      strava: createStravaApi(),
      runs: createRunStore(),
      recompute: createInMemoryRecompute(),
      handlers: STRAVA_WEBHOOK_HANDLERS,
    }).drain();

    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'noop' });
    expect(tables.runs.map((r) => r.external_id)).toEqual(['7001']);
  });
});
