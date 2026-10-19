/**
 * What the status card sees after Strava has deauthorized the app: the athlete event is processed by the real worker and handler
 * (stravaAthleteDeauthorize.test.ts has the handler's own cases), then GET /api/strava/status goes through the real app.
 * Mocked at the edge: reprocessRunsFromDate and calculateUserTotals.
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
vi.mock('../runs.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../runs.js')>()),
  reprocessRunsFromDate: vi.fn().mockResolvedValue(undefined),
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
import { tokenCols } from '../../test-utils/stravaTokens.js';
import { logger } from '../../utils/logger.js';
import app from '../../app.js';
import { createStravaWebhookWorker } from '../../services/stravaWebhookWorker.js';
import { STRAVA_WEBHOOK_HANDLERS } from '../../services/stravaWebhook/handlers.js';
import { createRecompute, createRunStore, createStravaApi } from '../../services/stravaWebhook/supabaseAdapters.js';
import { createInMemoryWebhookStore } from '../../test-utils/inMemoryWebhookPorts.js';
import { withRunForeignKeys } from '../../test-utils/runForeignKeys.js';
import { installFakeStravaFetch, stravaDeauthorizeEvent, stravaError, type FakeStrava } from '../../test-utils/fakeStrava.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });

let strava: FakeStrava | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  for (const level of ['info', 'warn', 'error', 'debug'] as const) vi.spyOn(logger, level).mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  strava?.restore();
  strava = undefined;
});

describe('GET /api/strava/status after a deauthorize event', () => {
  it('GET /api/strava/status reports connected false after deauthorize', async () => {
    const tables: Record<string, Row[]> = {
      runs: [{ id: 'r1', user_id: 'user-1', source: 'strava', external_id: '1001', date: '2026-10-01', distance: 5, xp_gained: 55, streak_day: 1 }],
      strava_tokens: [
        {
          user_id: 'user-1', strava_athlete_id: 424242, ...tokenCols('user-1', 'SECRET-ACCESS', 'SECRET-REFRESH'), expires_at: 9_999_999_999,
          connection_date: '2026-09-01T09:00:00+00:00', consent_version: '2026-10-14', sync_paused: false, paused_at: null,
        },
      ],
      user_boosts: [],
    };
    const db = createFakeDb(tables, { autoIds: true, primaryKeys: { strava_tokens: ['user_id'] } });
    vi.mocked(getSupabaseClient).mockReturnValue(withRunForeignKeys(db.client, tables) as any);
    strava = installFakeStravaFetch({ athlete: stravaError(401) });
    const status = () => server.request('GET', '/api/strava/status', { token: mintToken({ user_id: 'user-1', group_id: 'group-1' }) });

    expect((await status()).body).toMatchObject({ connected: true }); // the card shows a connection before the event

    const event = stravaDeauthorizeEvent({ owner_id: 424242 });
    const store = createInMemoryWebhookStore({ now: () => new Date() });
    store.seed({ object_type: 'athlete', aspect_type: 'update', object_id: event.object_id, owner_id: event.owner_id, updates: event.updates, user_id: 'user-1' });
    await createStravaWebhookWorker({
      store,
      strava: createStravaApi(),
      runs: createRunStore(),
      recompute: createRecompute(),
      handlers: STRAVA_WEBHOOK_HANDLERS,
    }).drain();

    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'deauthorized_runs_deleted' });
    const after = await status();
    expect(after.status).toBe(200);
    expect(after.body).toEqual({ connected: false, expired: false });
  });
});
