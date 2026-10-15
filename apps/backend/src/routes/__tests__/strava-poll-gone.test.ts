/**
 * The polling after a webhook delete (ADR 010 decisions 6 and 7). Strava's activity list can be stale: it may still name an activity
 * the delete event has just removed. The detail call of the polling then answers 404, and the polling must leave the run gone.
 *
 * The REAL worker with the real delete handler removes the run; then the real polling (POST /api/strava/sync) runs against the same
 * database. Database: createFakeDb. Network: installFakeStravaFetch. Mocked at the edge: calculateUserTotals (asserted as a call),
 * event qualification, weather and the XP configuration.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { checkEventQualification } from '../../services/eventService.js';
import { WeatherService } from '../../services/weatherService.js';
import { createStravaWebhookWorker } from '../../services/stravaWebhookWorker.js';
import { STRAVA_WEBHOOK_HANDLERS } from '../../services/stravaWebhook/handlers.js';
import { createRecompute, createRunStore, createStravaApi } from '../../services/stravaWebhook/supabaseAdapters.js';
import app from '../../app.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';
import { createInMemoryWebhookStore } from '../../test-utils/inMemoryWebhookPorts.js';
import { withRunForeignKeys } from '../../test-utils/runForeignKeys.js';
import { installFakeStravaFetch, stravaActivity, stravaError, type FakeStrava } from '../../test-utils/fakeStrava.js';

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

const TOKEN_ROW = {
  user_id: 'user-1', access_token: 'old-at', refresh_token: 'old-rt', expires_at: 9999999999,
  connection_date: '2026-09-01T09:00:00+00:00', sync_paused: false,
};

describe('the polling after a webhook delete', () => {
  it('poll after a webhook delete does not resurrect the run', async () => {
    const listed = stravaActivity({ id: 1001, start_date: '2026-10-13T05:30:00Z', start_date_local: '2026-10-13T07:30:00Z' });
    // The list is stale (it still names the activity) while the detail call knows it is gone: 404 for the delete event and the poll.
    strava = installFakeStravaFetch({ athleteActivities: [listed], activities: { 1001: stravaError(404) } });
    const t: Record<string, Row[]> = {
      strava_tokens: [{ ...TOKEN_ROW }],
      runs: [{ id: 'run-1', user_id: 'user-1', source: 'strava', external_id: '1001', date: '2026-10-13', distance: 5, xp_gained: 33, streak_day: 1, is_treadmill: false }],
      user_boosts: [],
      run_weather: [],
      event_entries: [],
      user_badges: [],
      activity_log: [],
      users: [{ id: 'user-1', group_id: 'g1', event_xp: 0, total_xp: 33, total_km: 5, current_streak: 1, longest_streak: 1, current_level: 1 }],
    };
    const db = createFakeDb(t, {
      autoIds: true,
      numericIds: ['activity_log'],
      primaryKeys: { strava_tokens: ['user_id'] },
      uniqueIndexes: [{ table: 'runs', name: 'idx_runs_external_id', columns: ['user_id', 'external_id'] }],
    });
    vi.mocked(getSupabaseClient).mockReturnValue(withRunForeignKeys(db.client, t) as any);
    const store = createInMemoryWebhookStore({ now: () => new Date('2026-10-14T12:07:00.000Z') });
    const worker = createStravaWebhookWorker({
      store,
      strava: createStravaApi(),
      runs: createRunStore(),
      recompute: createRecompute(),
      handlers: STRAVA_WEBHOOK_HANDLERS,
      now: () => new Date('2026-10-14T12:07:00.000Z'),
    });

    // 1-2. The run exists; the delete event is processed and the run is gone.
    expect(t.runs.map((run) => run.external_id)).toEqual(['1001']);
    store.seed({ object_id: 1001, aspect_type: 'delete' });
    await worker.drain();
    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'deleted' });
    expect(t.runs).toEqual([]);
    expect(calculateUserTotals).toHaveBeenCalledTimes(1); // the delete's own recalculation
    const totalsAfterDelete = { ...t.users[0] };

    // 3. The poll lists the activity anyway; its detail call answers 404.
    const res = await server.request('POST', '/api/strava/sync', { token: mintToken({ user_id: 'user-1', group_id: 'g1' }) });

    // 4. Still gone, and nothing was earned: no insert, no recalculation, no weather, no event qualification, no news.
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, newRuns: 0, totalActivities: 1 });
    expect(strava.calls.athleteActivities).toBe(1);
    expect(strava.activityCalls(1001)).toBe(2); // the delete event's verification and the poll's detail call: the poll really looked
    expect(t.runs).toEqual([]);
    expect(calculateUserTotals).toHaveBeenCalledTimes(1);
    expect(t.users[0]).toEqual(totalsAfterDelete);
    expect(t.activity_log).toEqual([]);
    expect(WeatherService.fetchAndSaveWeatherForRuns).not.toHaveBeenCalled();
    expect(checkEventQualification).not.toHaveBeenCalled();
    expect(db.queries.some((q) => q.table === 'runs' && q.mutation === 'insert')).toBe(false);
  });
});
