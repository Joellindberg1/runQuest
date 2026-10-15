/**
 * The polling (syncAllStravaUsers, the 30-minute cron) is counted by the rate budget through the hook on stravaFetch,
 * without the polling code knowing about the budget (ADR 010 decision 9). Database: createFakeDb. Network: installFakeStravaFetch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
vi.mock('../eventService.js', () => ({
  checkEventQualification: vi.fn().mockResolvedValue(undefined),
  maybeCreateEvent: vi.fn(),
  activateScheduledEvents: vi.fn(),
  settleCompetitionEvents: vi.fn(),
  settleExpiredParticipationEvents: vi.fn(),
}));
vi.mock('../weatherService.js', () => ({
  WeatherService: { fetchAndSaveWeatherForRuns: vi.fn().mockResolvedValue(undefined), backfillMissingWeather: vi.fn() },
}));
vi.mock('../xpConfig.js', async () => {
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
import { syncAllStravaUsers } from '../../routes/strava.js';
import { createFakeDb, type Row } from '../../routes/__tests__/helpers/fakeDb.js';
import { installFakeStravaFetch, stravaActivity, type FakeStrava } from '../../test-utils/fakeStrava.js';
import { createStravaRateBudget, registerStravaRateBudget } from '../stravaRateBudget.js';

let strava: FakeStrava | undefined;
let unregister: (() => void) | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(() => {
  unregister?.();
  unregister = undefined;
  strava?.restore();
  strava = undefined;
  vi.restoreAllMocks();
});

describe('Strava polling and the rate budget', () => {
  it('polling requests are counted by the rate budget', async () => {
    const activity = stravaActivity({ id: 8101 });
    strava = installFakeStravaFetch({ athleteActivities: [activity], activities: { 8101: activity } });
    const tables: Record<string, Row[]> = {
      strava_tokens: [{ user_id: 'user-1', access_token: 'at', refresh_token: 'rt', expires_at: 9999999999, connection_date: '2026-09-01', sync_paused: false, users: { name: 'Test' } }],
      runs: [],
      user_boosts: [],
      users: [{ id: 'user-1', is_admin: false }],
    };
    vi.mocked(getSupabaseClient).mockReturnValue(createFakeDb(tables, { autoIds: true, primaryKeys: { strava_tokens: ['user_id'] } }).client as any);
    const budget = createStravaRateBudget();
    unregister = registerStravaRateBudget(budget);

    await syncAllStravaUsers();

    // One list call and one detail call for the new run; the fake sends no rate limit headers, so this is the local counter.
    expect(strava.calls.athleteActivities + strava.calls.activity).toBe(2);
    expect(budget.usage()).toMatchObject({ last15Min: 2, daily: 2 });
  });
});
