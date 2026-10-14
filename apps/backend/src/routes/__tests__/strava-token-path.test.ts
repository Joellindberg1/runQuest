/**
 * The routes that share the token path (getValidAccessToken): GET /status, GET /debug-activities, POST /backfill-extended and the sync,
 * seen from the outside. A user without a connection, an expired token that renews, one that cannot be renewed and one that has no
 * refresh token to renew with each give the answer the endpoint always gave. Also: a duplicate insert (23505) inside the sync is neither
 * an imported run nor a failure.
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

import { getSupabaseClient } from '../../config/database.js';
import { calculateUserTotals } from '../../utils/calculateUserTotals.js';
import { logger } from '../../utils/logger.js';
import app from '../../app.js';
import { createFakeDb, type Row, type RecordedQuery } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';
import { installFakeStravaFetch, stravaActivity, stravaError, stravaTokenResponse, type FakeStrava } from '../../test-utils/fakeStrava.js';

let server: TestServer;
let strava: FakeStrava | undefined;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(() => {
  strava?.restore();
  strava = undefined;
  vi.restoreAllMocks();
});

const TOKEN_ROW = { user_id: 'user-1', access_token: 'old-at', refresh_token: 'old-rt', expires_at: 9999999999, connection_date: '2026-09-01', users: { name: 'Test' } };
const EXPIRED = { ...TOKEN_ROW, expires_at: 100 };

function use(
  tables: Record<string, Row[]> = {},
  options: { failWhen?: (q: RecordedQuery) => { message: string } | null; beforeInsert?: (table: string, tables: Record<string, Row[]>) => void } = {},
) {
  const t: Record<string, Row[]> = { strava_tokens: [{ ...TOKEN_ROW }], runs: [], user_boosts: [], users: [{ id: 'user-1', is_admin: true }], ...tables };
  const db = createFakeDb(t, {
    autoIds: true,
    primaryKeys: { strava_tokens: ['user_id'] },
    uniqueIndexes: [{ table: 'runs', name: 'idx_runs_external_id', columns: ['user_id', 'external_id'] }],
    ...options,
  });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return { t, db };
}

const token = () => mintToken({ user_id: 'user-1', group_id: 'group-1' });
const get = (path: string) => server.request('GET', path, { token: token() });

/** The backfill pauses 1-2 s between batches and users; the pauses are not what these tests are about. */
function skipLongPauses() {
  const realSetTimeout = globalThis.setTimeout;
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => realSetTimeout(fn, ms && ms >= 1000 ? 0 : ms)) as typeof setTimeout);
}

describe('GET /api/strava/status', () => {
  it('status for an expired token without a refresh token says expired and does not call Strava', async () => {
    strava = installFakeStravaFetch({});
    use({ strava_tokens: [{ ...EXPIRED, refresh_token: null }] });

    const res = await get('/api/strava/status');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: true, expired: true, expires_at: 100, connection_date: '2026-09-01', last_sync: null, consent_version: null, sync_paused: false, paused_at: null });
    expect(strava.requests).toHaveLength(0);
  });

  it('status for a refresh token that Strava rejected says the refresh failed, as for any failed refresh', async () => {
    strava = installFakeStravaFetch({ oauthToken: stravaError(400, { body: { message: 'Bad Request', errors: [{ resource: 'RefreshToken', field: 'refresh_token', code: 'invalid' }] } }) });
    use({ strava_tokens: [{ ...EXPIRED }] });

    const res = await get('/api/strava/status');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ connected: true, expired: true, refresh_failed: true });
  });

  it('status answers a server error, not "not connected", when the token row cannot be read', async () => {
    strava = installFakeStravaFetch({});
    use({}, { failWhen: (q) => (q.table === 'strava_tokens' && q.select?.includes('access_token') ? { message: 'connection reset' } : null) });

    const res = await get('/api/strava/status');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to check Strava status' });
  });
});

describe('GET /api/strava/debug-activities', () => {
  it('debug-activities and the sync fail with a refresh error when Strava rejects the refresh token, and with a read error when the row cannot be read', async () => {
    strava = installFakeStravaFetch({ oauthToken: stravaError(401, { body: { message: 'Authorization Error', errors: [{ resource: 'RefreshToken', field: 'refresh_token', code: 'invalid' }] } }) });
    use({ strava_tokens: [{ ...EXPIRED }] });
    const rejected = await get('/api/strava/debug-activities');
    expect(rejected.status).toBe(400);
    expect(rejected.body.error).toBe('Failed to refresh Strava token');
    const syncRejected = await server.request('POST', '/api/strava/sync', { token: token() });
    expect(syncRejected.body.error).toBe('Failed to refresh Strava token');

    use({}, { failWhen: (q) => (q.table === 'strava_tokens' && q.select?.includes('access_token') ? { message: 'connection reset' } : null) });
    const unreadable = await get('/api/strava/debug-activities');
    expect(unreadable.status).toBe(400);
    expect(unreadable.body.error).toBe('Failed to read Strava connection');
    const syncUnreadable = await server.request('POST', '/api/strava/sync', { token: token() });
    expect(syncUnreadable.body.error).toBe('Failed to read Strava connection');
    expect(strava.calls.athleteActivities).toBe(0);
  });

  it('debug-activities reports a user without a Strava connection', async () => {
    strava = installFakeStravaFetch({});
    use({ strava_tokens: [] });

    const res = await get('/api/strava/debug-activities');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('User not connected to Strava');
    expect(strava.requests).toHaveLength(0);
  });

  it('debug-activities renews an expired token and lists with the new one', async () => {
    strava = installFakeStravaFetch({ oauthToken: stravaTokenResponse({ access_token: 'new-at', refresh_token: 'new-rt' }), athleteActivities: [stravaActivity({ id: 9001 })] });
    const { t } = use({ strava_tokens: [{ ...EXPIRED }] });

    const res = await get('/api/strava/debug-activities');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ connection_date: '2026-09-01', total_activities: 1, running_activities: 1, new_runs_count: 1 });
    expect(strava.requests.find((r) => r.route === 'athleteActivities')?.headers.authorization).toBe('Bearer new-at');
    expect(t.strava_tokens[0]).toMatchObject({ access_token: 'new-at', refresh_token: 'new-rt' });
  });

  it('debug-activities fails with a refresh error when the token cannot be renewed', async () => {
    strava = installFakeStravaFetch({ oauthToken: stravaError(400, { body: { message: 'Bad Request' } }) });
    use({ strava_tokens: [{ ...EXPIRED }] });

    const res = await get('/api/strava/debug-activities');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Failed to refresh Strava token');
    expect(strava.calls.athleteActivities).toBe(0);
  });

  it('debug-activities fails with a refresh error, without calling Strava, when an expired token has no refresh token', async () => {
    strava = installFakeStravaFetch({});
    use({ strava_tokens: [{ ...EXPIRED, refresh_token: null }] });

    const res = await get('/api/strava/debug-activities');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Failed to refresh Strava token');
    expect(strava.requests).toHaveLength(0);
  });
});

describe('POST /api/strava/backfill-extended', () => {
  const backfill = () => server.request('POST', '/api/strava/backfill-extended', { token: token() });
  const RUN = { id: 'run-1', user_id: 'user-1', source: 'strava', external_id: '9101', date: '2026-10-01', distance: 5, xp_gained: 20 };

  it('backfill-extended reads the token again for each user, renews an expired one and fetches the detail with it', async () => {
    strava = installFakeStravaFetch({
      oauthToken: stravaTokenResponse({ access_token: 'new-at', refresh_token: 'new-rt' }),
      activities: { 9101: stravaActivity({ id: 9101, suffer_score: 33 }) },
    });
    const { t, db } = use({ strava_tokens: [{ ...EXPIRED }], runs: [{ ...RUN }] });
    skipLongPauses();

    const res = await backfill();

    expect(res.body).toMatchObject({ success: true, totalUpdated: 1, summary: [{ user: 'Test', updated: 1 }] });
    expect(strava.requests.find((r) => r.route === 'activity')?.headers.authorization).toBe('Bearer new-at');
    expect(t.strava_tokens[0]).toMatchObject({ access_token: 'new-at', refresh_token: 'new-rt' });
    expect(t.runs[0]).toMatchObject({ suffer_score: 33, sport_type: 'Run' });

    // The listing query no longer carries the secrets; the token path reads them per user.
    const reads = db.queries.filter((q) => q.table === 'strava_tokens' && q.select !== null && !q.mutation); // the renewal's update also selects the row it changed
    expect(reads).toHaveLength(2);
    expect(reads[0].select).not.toMatch(/access_token|refresh_token|expires_at/);
    expect(reads[1].select).toContain('access_token');
    expect(reads[1].filters).toContainEqual({ op: 'eq', column: 'user_id', value: 'user-1' });
  });

  it('backfill-extended reports the user as failed, and fetches nothing, when the token cannot be renewed', async () => {
    strava = installFakeStravaFetch({ oauthToken: stravaError(400, { body: { message: 'Bad Request' } }), activities: {} });
    use({ strava_tokens: [{ ...EXPIRED }], runs: [{ ...RUN }] });
    skipLongPauses();

    const res = await backfill();

    expect(res.body).toMatchObject({ success: true, totalUpdated: 0, summary: [{ user: 'Test', updated: 0, error: 'Failed' }] });
    expect(strava.calls.activity).toBe(0);
  });

  it('backfill-extended reports the user as failed when the connection is gone by the time the token is read', async () => {
    strava = installFakeStravaFetch({ activities: {} });
    // The listing query sees the user; the per-user token read (the only select naming access_token) finds nothing.
    use({ runs: [{ ...RUN }] }, { failWhen: (q) => (q.table === 'strava_tokens' && q.select?.includes('access_token') ? { message: 'not found' } : null) });
    skipLongPauses();

    const res = await backfill();

    expect(res.body).toMatchObject({ success: true, totalUpdated: 0, summary: [{ user: 'Test', updated: 0, error: 'Failed' }] });
    expect(strava.requests).toHaveLength(0);
  });
});

describe('POST /api/strava/sync with a duplicate insert', () => {
  it('sync counts a run that another import inserted first (23505) as neither imported nor failed', async () => {
    const activity = stravaActivity({ id: 9201 });
    strava = installFakeStravaFetch({ athleteActivities: [activity], activities: { 9201: activity } });
    // The webhook worker (or a second sync) inserts the same activity between our existing-runs read and our insert.
    const { t } = use({}, {
      beforeInsert: (table, tables) => {
        if (table === 'runs' && !tables.runs.some((run) => run.external_id === '9201')) {
          tables.runs = [...tables.runs, { id: 'rival', user_id: 'user-1', source: 'strava', external_id: '9201', date: '2026-10-12', distance: 5, xp_gained: 25, streak_day: 1 }];
        }
      },
    });

    const res = await server.request('POST', '/api/strava/sync', { token: token() });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, newRuns: 0, totalActivities: 1 });
    expect(t.runs.map((run) => run.id)).toEqual(['rival']);
    expect(vi.mocked(logger.error).mock.calls.filter((call) => String(call[0]).includes('failed to insert'))).toHaveLength(0);
    expect(calculateUserTotals).not.toHaveBeenCalled(); // nothing imported by this sync, so nothing to recalculate
  });
});
