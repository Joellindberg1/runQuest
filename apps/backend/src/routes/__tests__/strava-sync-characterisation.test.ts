/**
 * Characterisation of today's Strava sync (POST /api/strava/sync -> syncUserStravaActivities) against fakeStrava.
 *
 * Written before the Strava client and import logic moved out of routes/strava.ts (ADR 010 decision 7), and unchanged by the move:
 * what the sync reads from Strava, which rows it writes and how it heals. Database: createFakeDb with the real unique index on
 * (user_id, external_id). Network: installFakeStravaFetch, so an unexpected Strava call fails the test.
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
  strava?.restore(); // throws when the code reached a Strava URL the test did not configure
  strava = undefined;
  vi.restoreAllMocks();
});

const TOKEN_ROW = { user_id: 'user-1', access_token: 'old-at', refresh_token: 'old-rt', expires_at: 9999999999, connection_date: '2026-09-01' };

function use(tables: Partial<Record<string, Row[]>> = {}, failWhen?: (q: RecordedQuery) => { message: string } | null) {
  const t: Record<string, Row[]> = {
    strava_tokens: [{ ...TOKEN_ROW }],
    runs: [],
    user_boosts: [],
    ...(tables as Record<string, Row[]>),
  };
  const db = createFakeDb(t, {
    autoIds: true,
    failWhen,
    uniqueIndexes: [{ table: 'runs', name: 'idx_runs_external_id', columns: ['user_id', 'external_id'] }],
    primaryKeys: { strava_tokens: ['user_id'] },
  });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return { t, db };
}

const sync = () => server.request('POST', '/api/strava/sync', { token: mintToken({ user_id: 'user-1', group_id: 'group-1' }) });
const stravaRun = (over: Row = {}): Row => ({
  id: 'run-1', user_id: 'user-1', source: 'strava', external_id: '1001', date: '2026-10-01', distance: 5, xp_gained: 20, streak_day: 1, ...over,
});
const importedIds = (t: Record<string, Row[]>) => t.runs.map((run) => run.external_id).sort();

describe('Strava sync (characterisation)', () => {
  it('sync imports a new run with start_time kept as local wall clock', async () => {
    // 00:30 local on the 12th is 22:30 UTC on the 11th: the row must follow the local wall clock, with Strava's fake Z.
    const summary = stravaActivity({ id: 2001, start_date: '2026-10-11T22:30:00Z', start_date_local: '2026-10-12T00:30:00Z', distance: 5000 });
    const detailed = stravaActivity({
      ...summary,
      splits_metric: [
        { distance: 1000, moving_time: 280, elapsed_time: 280, split: 1 },
        { distance: 1000, moving_time: 320, elapsed_time: 320, split: 2 },
      ],
      average_heartrate: 150,
      suffer_score: 42,
    });
    strava = installFakeStravaFetch({ athleteActivities: [summary], activities: { 2001: detailed } });
    const { t } = use();

    const res = await sync();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, newRuns: 1, totalActivities: 1 });
    expect(t.runs).toHaveLength(1);
    expect(t.runs[0]).toMatchObject({
      user_id: 'user-1',
      source: 'strava',
      external_id: '2001',
      date: '2026-10-12',
      distance: 5,
      start_time: '2026-10-12T00:30:00Z',
      moving_time: 1500,
      sport_type: 'Run',
      is_treadmill: false,
      avg_heartrate: 150,
      suffer_score: 42,
      start_lat: 59.3293,
      start_lng: 18.0686,
      pace_std_dev: 20, // from the detail call's splits_metric: paces 280 and 320 s/km
    });
    expect(t.runs[0].xp_gained).toBeGreaterThan(0); // recalculated from the placeholder 0 by the reprocess
    expect(strava.activityCalls(2001)).toBe(1);
  });

  it('sync skips activities that already exist (unique external_id)', async () => {
    strava = installFakeStravaFetch({
      athleteActivities: [stravaActivity({ id: 1001 }), stravaActivity({ id: 1002, start_date: '2026-10-13T05:30:00Z', start_date_local: '2026-10-13T07:30:00Z' })],
      activities: { 1002: stravaActivity({ id: 1002, start_date: '2026-10-13T05:30:00Z', start_date_local: '2026-10-13T07:30:00Z' }) },
    });
    const { t } = use({ runs: [stravaRun({ external_id: '1001', date: '2026-10-12' })] });

    const res = await sync();

    expect(res.body).toMatchObject({ success: true, newRuns: 1, totalActivities: 2 });
    expect(importedIds(t)).toEqual(['1001', '1002']);
    expect(strava.activityCalls(1001)).toBe(0); // the existing run is not even fetched in detail
    expect(strava.activityCalls(1002)).toBe(1);
  });

  it('sync skips zero-distance and non-running activities', async () => {
    const good = stravaActivity({ id: 3001 });
    strava = installFakeStravaFetch({
      athleteActivities: [
        stravaActivity({ id: 3002, distance: 0 }),
        stravaActivity({ id: 3003, sport_type: 'Ride' }),
        stravaActivity({ id: 3004, sport_type: 'Walk' }),
        good,
      ],
      activities: { 3001: good },
    });
    const { t } = use();

    const res = await sync();

    expect(res.body).toMatchObject({ success: true, newRuns: 1, totalActivities: 4 });
    expect(importedIds(t)).toEqual(['3001']);
    for (const skipped of [3002, 3003, 3004]) expect(strava.activityCalls(skipped)).toBe(0);
  });

  it('sync heals imported runs that still have placeholder xp', async () => {
    // Nothing new on Strava: the only trigger is the stored run that still has the placeholder xp_gained 0.
    strava = installFakeStravaFetch({ athleteActivities: [] });
    const { t } = use({
      runs: [stravaRun({ id: 'run-1', external_id: '1001', date: '2026-10-01', xp_gained: 0 }), stravaRun({ id: 'run-2', external_id: '1002', date: '2026-10-02', xp_gained: 0 })],
    });

    const res = await sync();

    expect(res.status).toBe(200);
    expect(t.runs.every((run) => run.xp_gained > 0)).toBe(true);
    expect(t.runs.map((run) => run.streak_day)).toEqual([1, 2]);
  });

  it('sync renews an expired token once, saves it and lists activities with the new one', async () => {
    strava = installFakeStravaFetch({
      oauthToken: stravaTokenResponse({ access_token: 'new-at', refresh_token: 'new-rt', expires_at: 9999999990 }),
      athleteActivities: [],
    });
    const { t } = use({ strava_tokens: [{ ...TOKEN_ROW, expires_at: 100 }] });

    const res = await sync();

    expect(res.status).toBe(200);
    expect(strava.calls.oauthToken).toBe(1);
    expect(strava.requests.find((r) => r.route === 'oauthToken')?.body).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'old-rt' });
    expect(t.strava_tokens[0]).toMatchObject({ access_token: 'new-at', refresh_token: 'new-rt', expires_at: 9999999990 });
    expect(strava.requests.find((r) => r.route === 'athleteActivities')?.headers.authorization).toBe('Bearer new-at');
  });

  it('sync fails with a refresh error and raises the critical alarm when the rotated tokens cannot be saved', async () => {
    strava = installFakeStravaFetch({ oauthToken: stravaTokenResponse({ access_token: 'new-at' }) });
    const { db } = use(
      { strava_tokens: [{ ...TOKEN_ROW, expires_at: 100 }] },
      (q) => (q.table === 'strava_tokens' && q.mutation === 'update' ? { message: 'write failed' } : null),
    );

    const res = await sync();

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Failed to refresh Strava token');
    expect(db.queries.filter((q) => q.table === 'strava_tokens' && q.mutation === 'update')).toHaveLength(2); // one retry
    expect(vi.mocked(logger.error).mock.calls.some((call) => String(call[0]).includes('KRITISKT'))).toBe(true);
    expect(strava.calls.athleteActivities).toBe(0);
  });

  it('sync reports a user without a Strava connection', async () => {
    strava = installFakeStravaFetch({ athleteActivities: [] });
    use({ strava_tokens: [] });

    const res = await sync();

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('User not connected to Strava');
    expect(strava.requests).toHaveLength(0);
  });

  it('sync reports a Strava list failure and writes nothing', async () => {
    strava = installFakeStravaFetch({ athleteActivities: stravaError(500) as any });
    const { t } = use();

    const res = await sync();

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Failed to fetch Strava activities');
    expect(t.runs).toHaveLength(0);
  });
});
