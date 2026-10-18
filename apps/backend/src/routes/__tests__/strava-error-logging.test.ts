/**
 * What the Strava routes log when something fails (ADR 010 decision 8.6): our user id and the error CODE, never the error object.
 * A database or Strava error can carry the values of the row or the response in its message and details (a Strava id, a coordinate,
 * a title), and the object's stack repeats the message. Every case below makes something fail with a message full of such values
 * and then looks at everything that was logged.
 *
 * Through the real app: the database is createFakeDb, the network is installFakeStravaFetch (an unconfigured Strava URL fails the
 * test). Mocked at the edge: reprocessRunsFromDate, calculateUserTotals, weather, event qualification and the XP config, so a test
 * can make each of them throw.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { STRAVA_CONSENT_VERSION } from '@runquest/shared';

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
vi.mock('../runs.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../runs.js')>()),
  reprocessRunsFromDate: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../utils/calculateUserTotals.js', () => ({ calculateUserTotals: vi.fn().mockResolvedValue(undefined) }));
// Not importOriginal: the scheduler imports routes/strava.ts, so loading the original from inside this factory would hand strava.ts the real one.
vi.mock('../../scheduler/stravaSync.js', () => ({ startStravaScheduler: vi.fn() }));
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
import { tokenCols } from '../../test-utils/stravaTokens.js';
import { calculateUserTotals } from '../../utils/calculateUserTotals.js';
import { logger } from '../../utils/logger.js';
import { checkEventQualification } from '../../services/eventService.js';
import { WeatherService } from '../../services/weatherService.js';
import { getXpConfig } from '../../services/xpConfig.js';
import { reprocessRunsFromDate } from '../runs.js';
import app from '../../app.js';
import { installFakeStravaFetch, stravaActivity, stravaError, stravaTokenResponse, type FakeStrava, type FakeStravaRoutes } from '../../test-utils/fakeStrava.js';
import { createFakeDb, type FakeDbOptions, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });

const LEAK = 'failed for external_id 987654321 at 59.3293,18.0686 "My secret morning run"';
const SECRETS = ['987654321', '59.3293', '18.0686', 'secret morning'];
/** The shape of a Postgres or Strava error: a code, and a message and details that carry the row's values. */
const leaky = (code = 'XX000'): Error => Object.assign(new Error(LEAK), { code, details: LEAK, hint: LEAK });

let strava: FakeStrava | undefined;
let errorLines: string[];
let allLines: string[];

beforeEach(() => {
  vi.clearAllMocks();
  errorLines = [];
  allLines = [];
  for (const level of ['info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
      const line = args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg, Object.getOwnPropertyNames(Object(arg))))).join(' ');
      allLines.push(line);
      if (level === 'error') errorLines.push(line);
    });
  }
});
afterEach(() => {
  vi.restoreAllMocks(); // before strava.restore(): a spy on fetch sits on top of the fake
  strava?.restore();
  strava = undefined;
});

const user = () => mintToken({ user_id: 'user-1', group_id: 'group-1' });
const admin = () => mintToken({ user_id: 'admin-1', group_id: 'group-1' });

const connected = (over: Row = {}): Row => ({
  user_id: 'user-1', ...tokenCols('user-1', 'at', 'rt'), expires_at: 9_999_999_999, connection_date: '2026-09-01', sync_paused: false, ...over,
});

interface Setup {
  tables?: Partial<Record<string, Row[]>>;
  failWhen?: FakeDbOptions['failWhen'];
  strava?: FakeStravaRoutes;
}

function setup({ tables = {}, failWhen, strava: stravaRoutes }: Setup = {}) {
  const t: Record<string, Row[]> = {
    strava_tokens: [connected()],
    runs: [],
    user_boosts: [],
    users: [{ id: 'user-1', is_admin: false }, { id: 'admin-1', is_admin: true, name: 'admin' }],
    ...(tables as Record<string, Row[]>),
  };
  vi.mocked(getSupabaseClient).mockReturnValue(createFakeDb(t, { autoIds: true, failWhen, primaryKeys: { strava_tokens: ['user_id'] } }).client as any);
  if (stravaRoutes) strava = installFakeStravaFetch(stravaRoutes);
  return t;
}

/** The database is unreachable, and says so with a message full of values. */
function databaseThrows(code = 'XX000') {
  vi.mocked(getSupabaseClient).mockImplementation(() => { throw leaky(code); });
}

/** The logged error lines name the failure by code and carry nothing from the message, details, hint or stack. */
function expectOnlyTheCode(code: string) {
  expect(errorLines.length).toBeGreaterThan(0);
  expect(errorLines.some((line) => line.includes(code))).toBe(true);
  expect(allLines.filter((line) => SECRETS.some((secret) => line.includes(secret)))).toEqual([]);
  expect(allLines.filter((line) => line.includes('Error:') || line.includes('    at '))).toEqual([]); // no stack
}

const runningActivity = () => stravaActivity({ id: 4001, start_date_local: '2026-10-12T07:30:00Z' });
const sync = () => server.request('POST', '/api/strava/sync', { token: user() });
const stravaWithOneActivity = (): FakeStravaRoutes => ({ athleteActivities: [runningActivity()], activities: { 4001: runningActivity() } });

describe('a reprocess error after a Strava import', () => {
  it('logs only the code when the message carries a Strava id, coordinates and a title', async () => {
    setup({ strava: stravaWithOneActivity() });
    vi.mocked(reprocessRunsFromDate).mockRejectedValueOnce(leaky('XX000'));

    const res = await sync();

    expect(res.status).toBe(400);
    expect(errorLines.some((line) => line.includes('Reprocess after Strava import failed for user user-1'))).toBe(true);
    expectOnlyTheCode('XX000');
  });

  it('logs only the code when the weather fetch fails on top of it', async () => {
    setup({ strava: stravaWithOneActivity() });
    vi.mocked(reprocessRunsFromDate).mockRejectedValueOnce(leaky('A0001'));
    vi.mocked(WeatherService.fetchAndSaveWeatherForRuns).mockRejectedValueOnce(leaky('W0001'));

    await sync();

    expectOnlyTheCode('W0001');
    expect(errorLines.some((line) => line.includes('A0001'))).toBe(true);
  });

  it('logs only the code when the event qualification fails', async () => {
    setup({ strava: stravaWithOneActivity() });
    vi.mocked(checkEventQualification).mockRejectedValueOnce(leaky('Q0001'));

    const res = await sync();
    await vi.waitFor(() => expect(errorLines.some((line) => line.includes('checkEventQualification'))).toBe(true));

    expect(res.status).toBe(200);
    expectOnlyTheCode('Q0001');
  });

  it('logs only the code when the sync itself fails afterwards', async () => {
    setup({ strava: stravaWithOneActivity() });
    vi.mocked(calculateUserTotals).mockRejectedValueOnce(leaky('T0001'));

    const res = await sync();

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Failed to sync activities' });
    expectOnlyTheCode('T0001');
  });

  it('logs only the code when the self-heal reprocess fails', async () => {
    setup({
      tables: { runs: [{ id: 'r1', user_id: 'user-1', source: 'strava', external_id: '1001', date: '2026-10-01', distance: 5, xp_gained: 0 }] },
      strava: { athleteActivities: [] },
    });
    vi.mocked(reprocessRunsFromDate).mockRejectedValueOnce(leaky('H0001'));

    await sync();

    expectOnlyTheCode('H0001');
  });

  it('logs only the code when the XP config cannot be read for the self-heal', async () => {
    setup({
      tables: { runs: [{ id: 'r1', user_id: 'user-1', source: 'strava', external_id: '1001', date: '2026-10-01', distance: 5, xp_gained: 0 }] },
      strava: { athleteActivities: [] },
    });
    vi.mocked(getXpConfig).mockRejectedValueOnce(leaky('C0001'));

    await sync();

    expectOnlyTheCode('C0001');
  });

  it('logs only the status when Strava answers the activity list with an error body', async () => {
    setup({ strava: { athleteActivities: stravaError(500, { body: { message: LEAK, errors: [{ field: LEAK }] } }) } });

    const res = await sync();

    expect(res.status).toBe(400);
    expect(errorLines.some((line) => line.includes('500'))).toBe(true);
    expect(allLines.filter((line) => SECRETS.some((secret) => line.includes(secret)))).toEqual([]);
  });
});

describe('a sync that goes well', () => {
  it('logs no Strava activity id, not those Strava lists and not those already stored', async () => {
    const listed = stravaActivity({ id: 987654321, name: 'Secret morning run', start_date_local: '2026-10-12T07:30:00Z' });
    setup({
      tables: { runs: [{ id: 'r1', user_id: 'user-1', source: 'strava', external_id: '123456789', date: '2026-10-05', distance: 5, xp_gained: 50 }] },
      strava: { athleteActivities: [listed, stravaActivity({ id: 123456789, start_date_local: '2026-10-05T07:30:00Z' })], activities: { 987654321: listed } },
    });

    const res = await sync();

    expect(res.status).toBe(200);
    expect(allLines.length).toBeGreaterThan(0);
    expect(allLines.filter((line) => ['987654321', '123456789', 'Secret morning', '59.3293'].some((value) => line.includes(value)))).toEqual([]);
  });
});

describe('the other Strava routes', () => {
  it('config logs only the code', async () => {
    vi.spyOn(logger, 'info').mockImplementationOnce(() => { throw leaky('K0001'); });

    const res = await server.request('GET', '/api/strava/config');

    expect(res.status).toBe(500);
    expectOnlyTheCode('K0001');
  });

  it('status logs only the code', async () => {
    databaseThrows('S0001');

    const res = await server.request('GET', '/api/strava/status', { token: user() });

    expect(res.status).toBe(500);
    expectOnlyTheCode('S0001');
  });

  it('sync-paused logs only the code', async () => {
    databaseThrows('P0001');

    const res = await server.request('PUT', '/api/strava/sync-paused', { token: user(), body: { paused: true } });

    expect(res.status).toBe(500);
    expectOnlyTheCode('P0001');
  });

  it('callback logs only the code when the token exchange fails', async () => {
    setup({ strava: { oauthToken: stravaError(400, { body: { message: LEAK, errors: [{ field: LEAK }] } }) } });

    const res = await server.request('POST', '/api/strava/callback', { token: user(), body: { code: 'c', consent_version: STRAVA_CONSENT_VERSION } });

    expect(res.status).toBe(400);
    expect(errorLines.some((line) => line.includes('400'))).toBe(true);
    expect(allLines.filter((line) => SECRETS.some((secret) => line.includes(secret)))).toEqual([]);
  });

  it('callback logs only the code when the tokens cannot be saved', async () => {
    setup({
      strava: { oauthToken: stravaTokenResponse({ athlete: { id: 424242 } }) },
      failWhen: (q) => (q.table === 'strava_tokens' && q.mutation === 'upsert' ? (Object.assign({ message: LEAK }, { code: 'U0001', details: LEAK }) as never) : null),
    });

    const res = await server.request('POST', '/api/strava/callback', { token: user(), body: { code: 'c', consent_version: STRAVA_CONSENT_VERSION } });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to save Strava connection' });
    expectOnlyTheCode('U0001');
  });

  it('callback logs only the code when something throws', async () => {
    strava = installFakeStravaFetch({ oauthToken: stravaTokenResponse({ athlete: { id: 424242 } }) });
    databaseThrows('B0001');

    const res = await server.request('POST', '/api/strava/callback', { token: user(), body: { code: 'c', consent_version: STRAVA_CONSENT_VERSION } });

    expect(res.status).toBe(500);
    expectOnlyTheCode('B0001');
  });

  it('disconnect logs only the code', async () => {
    strava = installFakeStravaFetch({ oauthDeauthorize: { access_token: 'at' } });
    databaseThrows('D0001');

    const res = await server.request('DELETE', '/api/strava/disconnect', { token: user() });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to disconnect Strava' });
    expectOnlyTheCode('D0001');
  });

  it('manual sync logs only the code when something throws outside the sync', async () => {
    databaseThrows('M0001');

    const res = await sync();

    expect(res.status).toBe(500);
    expectOnlyTheCode('M0001');
  });

  it('sync-all logs only the code', async () => {
    setup({ failWhen: (q) => (q.table === 'strava_tokens' && q.select?.includes('users!inner') ? (Object.assign({ message: LEAK }, { code: 'Y0001', details: LEAK }) as never) : null) });

    const res = await server.request('GET', '/api/strava/sync-all', { token: admin() });

    expect(res.status).toBe(500);
    expect(errorLines.some((line) => line.includes('API Error in /strava/sync-all') && line.includes('Y0001'))).toBe(true);
    expect(allLines.filter((line) => SECRETS.some((secret) => line.includes(secret)))).toEqual([]);
  });

  it('backfill-extended logs only the code when a run update fails', async () => {
    setup({
      tables: {
        strava_tokens: [{ ...connected(), users: { name: 'runner' } }],
        runs: [{ id: 'r1', user_id: 'user-1', source: 'strava', external_id: '4001', date: '2026-10-12', distance: 5 }],
      },
      strava: { activities: { 4001: runningActivity() } },
      failWhen: (q) => (q.table === 'runs' && q.mutation === 'update' ? (Object.assign({ message: LEAK }, { code: 'R0001', details: LEAK }) as never) : null),
    });

    const res = await server.request('POST', '/api/strava/backfill-extended', { token: admin() });

    expect(res.status).toBe(200);
    expect(errorLines.some((line) => line.includes('Failed to update run r1 for user user-1') && line.includes('R0001'))).toBe(true);
    expect(allLines.filter((line) => SECRETS.some((secret) => line.includes(secret)))).toEqual([]);
  });
});

describe('the two outer catches', () => {
  it('sync-all logs only the code when one user fails unexpectedly', async () => {
    setup({ tables: { strava_tokens: [{ ...connected(), users: { name: 'runner' } }] } });
    const record = vi.mocked(logger.info).getMockImplementation()!;
    vi.mocked(logger.info).mockImplementation((...args: unknown[]) => {
      record(...args);
      if (String(args[0]).includes('Syncing user')) throw leaky('N0001');
    });

    const res = await server.request('GET', '/api/strava/sync-all', { token: admin() });

    expect(res.status).toBe(200);
    expect(errorLines.some((line) => line.includes('Error syncing user user-1') && line.includes('N0001'))).toBe(true);
    expectOnlyTheCode('N0001');
  });

  it('backfill-extended logs only the code when it fails as a whole', async () => {
    const db = createFakeDb({ users: [{ id: 'admin-1', is_admin: true, name: 'admin' }] });
    let calls = 0;
    vi.mocked(getSupabaseClient).mockImplementation(() => {
      if (++calls === 1) return db.client as any; // the admin check
      throw leaky('B1001');
    });

    const res = await server.request('POST', '/api/strava/backfill-extended', { token: admin() });

    expect(res.status).toBe(500);
    expect(errorLines.some((line) => line.includes('Backfill error') && line.includes('B1001'))).toBe(true);
    expectOnlyTheCode('B1001');
  });
});

describe('a reprocess error after a run is deleted', () => {
  it('logs only the code when the message carries a Strava id, coordinates and a title', async () => {
    setup({
      tables: {
        runs: [
          { id: 'run-1', user_id: 'user-1', source: 'manual', date: '2026-10-01', distance: 4, streak_day: 1, xp_gained: 10 },
          { id: 'run-2', user_id: 'user-1', source: 'manual', date: '2026-10-02', distance: 4, streak_day: 2, xp_gained: 10 },
        ],
      },
      failWhen: (q) => (q.table === 'runs' && q.mutation === 'update' ? (Object.assign({ message: LEAK }, { code: 'X0001', details: LEAK }) as never) : null),
    });

    const res = await server.request('DELETE', '/api/runs/run-1', { token: user() });

    expect(res.status).toBe(500);
    expect(errorLines.some((line) => line.includes('Reprocess from 2026-10-01 failed for user user-1'))).toBe(true);
    expect(allLines.filter((line) => SECRETS.some((secret) => line.includes(secret)))).toEqual([]);
  });
});
