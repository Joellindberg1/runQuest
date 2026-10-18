/**
 * The write protection of Strava runs (PUT and DELETE /api/runs/:id answer 409, owner decision 2026-10-11) holds for a run that
 * the webhook worker imported: it is a source='strava' row like the polling's, so the route needs no change. The run here is
 * created by an activity:create event through the real worker and handler, then edited through the real app.
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
import { tokenCols } from '../../test-utils/stravaTokens.js';
import { logger } from '../../utils/logger.js';
import app from '../../app.js';
import { createStravaWebhookWorker } from '../../services/stravaWebhookWorker.js';
import { STRAVA_WEBHOOK_HANDLERS } from '../../services/stravaWebhook/handlers.js';
import { createRecompute, createRunStore, createStravaApi } from '../../services/stravaWebhook/supabaseAdapters.js';
import { createInMemoryWebhookStore } from '../../test-utils/inMemoryWebhookPorts.js';
import { installFakeStravaFetch, stravaActivity, type FakeStrava } from '../../test-utils/fakeStrava.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

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

const token = mintToken({ user_id: 'user-1', group_id: 'group-1' });

/** Imports activity 7001 through an activity:create event and returns the tables and the id of the new run. */
async function importThroughWebhook() {
  strava = installFakeStravaFetch({ activities: { 7001: stravaActivity({ id: 7001 }) } });
  const tables: Record<string, Row[]> = {
    strava_tokens: [{ user_id: 'user-1', ...tokenCols('user-1', 'at', 'rt'), expires_at: 9999999999, connection_date: '2026-09-01T09:00:00+00:00', sync_paused: false }],
    runs: [],
    user_boosts: [],
    event_entries: [],
  };
  const db = createFakeDb(tables, {
    autoIds: true,
    uniqueIndexes: [{ table: 'runs', name: 'idx_runs_external_id', columns: ['user_id', 'external_id'] }],
    primaryKeys: { strava_tokens: ['user_id'] },
  });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);

  const now = () => new Date('2026-10-14T12:07:00.000Z');
  const store = createInMemoryWebhookStore({ now });
  store.seed({ object_id: 7001, aspect_type: 'create' });
  await createStravaWebhookWorker({
    store,
    strava: createStravaApi(),
    runs: createRunStore(),
    recompute: createRecompute(),
    handlers: STRAVA_WEBHOOK_HANDLERS,
    now,
  }).drain();

  expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'imported' });
  expect(tables.runs).toHaveLength(1);
  return { tables, db, runId: tables.runs[0].id as string };
}

describe('webhook-imported runs are read-only', () => {
  it('PUT and DELETE /api/runs/:id still return 409 for a webhook-imported run', async () => {
    const { tables, db, runId } = await importThroughWebhook();
    const before = { ...tables.runs[0] };
    const writesBefore = db.queries.filter((q) => q.mutation).length;

    const put = await server.request('PUT', `/api/runs/${runId}`, { token, body: { distance: 9, date: '2026-10-13' } });
    const del = await server.request('DELETE', `/api/runs/${runId}`, { token });

    expect(put.status).toBe(409);
    expect(put.body).toEqual({ error: 'Strava runs are read-only' });
    expect(del.status).toBe(409);
    expect(del.body).toEqual({ error: 'Strava runs are read-only' });
    expect(tables.runs).toHaveLength(1);
    expect(tables.runs[0]).toEqual(before);
    expect(db.queries.filter((q) => q.mutation)).toHaveLength(writesBefore);
  });
});
