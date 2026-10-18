/**
 * The Strava routes with encrypted token storage (ADR 013 decisions 4, 5, 9 and 10), seen from the outside: the callback stores sealed
 * tokens and checks the key before it exchanges the code, GET /status and the manual sync answer 503 (not "expired", not "connect again")
 * when a token cannot be read, and the sync-all query asks for no token column.
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

import { STRAVA_CONSENT_VERSION } from '@runquest/shared';
import { getSupabaseClient } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import app from '../../app.js';
import { syncAllStravaUsers } from '../strava.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';
import { installFakeStravaFetch, stravaTokenResponse, type FakeStrava } from '../../test-utils/fakeStrava.js';
import { plainRow, storedToken, tokenCols } from '../../test-utils/stravaTokens.js';

let server: TestServer;
let strava: FakeStrava | undefined;
let logLines: string[];
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });

beforeEach(() => {
  vi.clearAllMocks();
  logLines = [];
  for (const level of ['info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
      logLines.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg, Object.getOwnPropertyNames(Object(arg))))).join(' '));
    });
  }
});
afterEach(() => {
  strava?.restore();
  strava = undefined;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const TOKEN_ROW = { user_id: 'user-1', ...tokenCols('user-1', 'old-at', 'old-rt'), expires_at: 9999999999, connection_date: '2026-09-01', users: { name: 'Test' } };

function use(tables: Record<string, Row[]> = {}) {
  const t: Record<string, Row[]> = { strava_tokens: [{ ...TOKEN_ROW }], runs: [], user_boosts: [], users: [{ id: 'user-1', is_admin: true }], ...tables };
  const db = createFakeDb(t, { autoIds: true, primaryKeys: { strava_tokens: ['user_id'] } });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return { t, db };
}

const token = () => mintToken({ user_id: 'user-1', group_id: 'group-1' });
const status = () => server.request('GET', '/api/strava/status', { token: token() });
const sync = () => server.request('POST', '/api/strava/sync', { token: token() });
const connect = () =>
  server.request('POST', '/api/strava/callback', { token: token(), body: { code: 'auth-code', consent_version: STRAVA_CONSENT_VERSION } });

/** Rows a user could have in the database that the code cannot read, each with a short label. */
const UNREADABLE: Array<[string, () => Row]> = [
  ['an access token with a broken enc: value', () => ({ ...TOKEN_ROW, access_token: 'enc:v1:test-1:AAAA' })],
  ['an access token sealed for another user', () => ({ ...TOKEN_ROW, access_token: storedToken('user-2', 'access_token', 'old-at') })],
  ['an expired token with a refresh token of the wrong shape', () => ({ ...TOKEN_ROW, expires_at: 100, refresh_token: 'short' })],
];

describe('GET /api/strava/status with a token that cannot be read', () => {
  it('status answers 503, not expired and not "not connected", for a stored token that cannot be read', async () => {
    for (const [label, row] of UNREADABLE) {
      strava = installFakeStravaFetch({ oauthToken: stravaTokenResponse() });
      use({ strava_tokens: [row()] });

      const res = await status();

      expect(res.status, label).toBe(503);
      expect(res.body, label).toEqual({ error: 'Strava is temporarily unavailable' });
      expect(strava.requests, label).toHaveLength(0);
      strava.restore();
      strava = undefined;
    }
  });

  it('status answers 503 for a connected user when the key is missing, and still says "not connected" for a user without a connection', async () => {
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', '');
    strava = installFakeStravaFetch({});
    use();
    const connected = await status();
    expect(connected.status).toBe(503);
    expect(connected.body).toEqual({ error: 'Strava is temporarily unavailable' });

    use({ strava_tokens: [] });
    const none = await status();
    expect(none.status).toBe(200);
    expect(none.body).toEqual({ connected: false, expired: false });
    expect(strava.requests).toHaveLength(0);
  });

  it('status is unchanged for a readable token', async () => {
    strava = installFakeStravaFetch({});
    use();

    const res = await status();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ connected: true, expired: false });
  });
});

describe('POST /api/strava/sync with a token that cannot be read', () => {
  it('manual sync answers 503 and calls Strava for nothing', async () => {
    for (const [label, row] of UNREADABLE) {
      strava = installFakeStravaFetch({ oauthToken: stravaTokenResponse(), athleteActivities: [] });
      const { t } = use({ strava_tokens: [row()] });
      const before = JSON.stringify(t.strava_tokens);

      const res = await sync();

      expect(res.status, label).toBe(503);
      expect(res.body, label).toEqual({ error: 'Strava is temporarily unavailable' });
      expect(strava.requests, label).toHaveLength(0);
      expect(JSON.stringify(t.strava_tokens), label).toBe(before);
      strava.restore();
      strava = undefined;
    }
  });
});

describe('POST /api/strava/callback and the key', () => {
  it('callback does not exchange the code, and saves nothing, when the key is missing or invalid', async () => {
    for (const value of ['', 'prod-1:not-a-key']) {
      vi.stubEnv('TOKEN_ENCRYPTION_KEY', value);
      strava = installFakeStravaFetch({ oauthToken: stravaTokenResponse() });
      const { t, db } = use({ strava_tokens: [] });

      const res = await connect();

      expect(res.status, value).toBe(503);
      expect(res.body, value).toEqual({ error: 'Strava is temporarily unavailable' });
      expect(strava.calls.oauthToken, value).toBe(0);
      expect(t.strava_tokens, value).toEqual([]);
      expect(db.queries.filter((q) => q.mutation), value).toEqual([]);
      expect(logLines.some((line) => line.includes('cannot store tokens') && line.includes('user-1')), value).toBe(true);
      strava.restore();
      strava = undefined;
    }
  });

  it('callback saves both tokens encrypted and never writes a plaintext token', async () => {
    strava = installFakeStravaFetch({ oauthToken: stravaTokenResponse({ access_token: 'NEW-ACCESS-VALUE', refresh_token: 'NEW-REFRESH-VALUE', expires_at: 9999999990 }) });
    const { t, db } = use({ strava_tokens: [] });
    const writes: Row[] = [];
    const from = db.client.from;
    db.client.from = (table: string) => {
      const builder = from(table);
      if (table === 'strava_tokens') {
        const upsert = builder.upsert;
        builder.upsert = (row: Row, options?: never) => { writes.push(row); return upsert(row, options); };
      }
      return builder;
    };

    const res = await connect();

    expect(res.status).toBe(200);
    expect(writes).toHaveLength(1);
    expect(writes[0].access_token).toMatch(/^enc:v1:/);
    expect(writes[0].refresh_token).toMatch(/^enc:v1:/);
    expect(JSON.stringify(writes)).not.toContain('NEW-ACCESS-VALUE');
    expect(JSON.stringify(writes)).not.toContain('NEW-REFRESH-VALUE');
    expect(JSON.stringify(t.strava_tokens)).not.toContain('NEW-');
    expect(plainRow(t.strava_tokens[0])).toMatchObject({ access_token: 'NEW-ACCESS-VALUE', refresh_token: 'NEW-REFRESH-VALUE', expires_at: 9999999990 });
  });
});

describe('everything that does not touch Strava tokens without a key', () => {
  it('routes that do not read a Strava token answer as usual when the key is missing', async () => {
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', '');
    use();

    const config = await server.request('GET', '/api/strava/config');

    expect(config.status).toBe(200);
    expect(config.body).toEqual({ client_id: 'client-id' });
  });
});

describe('the polling when tokens cannot be read', () => {
  const userRow = (userId: string, over: Row = {}): Row => ({
    user_id: userId, ...tokenCols(userId, `at-${userId}`, `rt-${userId}`), expires_at: 9999999999, connection_date: '2026-09-01', sync_paused: false, users: { name: userId }, ...over,
  });

  /** The polling pauses a second between users; the pause is not what these tests are about. */
  function skipLongPauses() {
    const realSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => realSetTimeout(fn, ms && ms >= 1000 ? 0 : ms)) as typeof setTimeout);
  }

  it('polling without a key reports "Strava is temporarily unavailable" per user, calls Strava for nothing, runs every user and leaves the tables alone', async () => {
    skipLongPauses();
    strava = installFakeStravaFetch({ oauthToken: stravaTokenResponse(), athleteActivities: [] });
    const { t, db } = use({ strava_tokens: [userRow('user-1'), userRow('user-2')] });
    const before = JSON.stringify(t);
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', ''); // after the rows are sealed

    const result = await syncAllStravaUsers();

    expect(result).toMatchObject({ success: true, syncedUsers: 0, totalUsers: 2, totalNewRuns: 0 });
    expect(result.results).toEqual([
      { userId: 'user-1', userName: 'user-1', error: 'Strava is temporarily unavailable' },
      { userId: 'user-2', userName: 'user-2', error: 'Strava is temporarily unavailable' }, // the next user is still tried
    ]);
    expect(strava.requests).toHaveLength(0);
    expect(JSON.stringify(t)).toBe(before);
    expect(db.queries.filter((q) => q.mutation)).toEqual([]);
  });

  it('one user whose token cannot be read does not stop the next user from syncing', async () => {
    skipLongPauses();
    strava = installFakeStravaFetch({ oauthToken: stravaTokenResponse(), athleteActivities: [] });
    const damaged = userRow('user-1', { access_token: 'enc:v1:test-1:AAAA' });
    const { t, db } = use({ strava_tokens: [damaged, userRow('user-2')] });
    const before = JSON.stringify(t.strava_tokens);

    const result = await syncAllStravaUsers();

    expect(result.results[0]).toEqual({ userId: 'user-1', userName: 'user-1', error: 'Strava is temporarily unavailable' });
    expect(result.results[1]).toMatchObject({ userId: 'user-2', newRuns: 0 });
    expect(result.syncedUsers).toBe(1);
    expect(strava.calls.athleteActivities).toBe(1);
    expect(strava.requests.every((request) => request.headers.authorization === 'Bearer at-user-2')).toBe(true);
    expect(JSON.stringify(t.strava_tokens)).toBe(before);
    expect(db.queries.filter((q) => q.mutation && q.table === 'strava_tokens')).toEqual([]);
  });
});

describe('the sync-all query', () => {
  it('syncAllStravaUsers does not select the token columns', async () => {
    strava = installFakeStravaFetch({ athleteActivities: [] });
    const { db } = use();

    const res = await server.request('GET', '/api/strava/sync-all', { token: token() });

    expect(res.status).toBe(200);
    const listing = db.queries.find((q) => q.table === 'strava_tokens' && q.select?.includes('users!inner'));
    expect(listing).toBeDefined();
    expect(listing?.select).not.toMatch(/access_token|refresh_token/);
    expect(listing?.select).toMatch(/user_id/);
  });
});
