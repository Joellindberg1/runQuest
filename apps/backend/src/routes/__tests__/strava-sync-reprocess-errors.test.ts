/**
 * RUN-215 (bör-punkt A/C) — syncUserStravaActivities när omräkningen (reprocessRunsFromDate) felar.
 *
 * Synkresultatet rapporteras som misslyckat, men totaler, väder och eventkvalificering körs ändå best-effort
 * (annars är datat sämre än före RUN-215). Strava-rader som fick placeholder-XP 0 vid felet självläker vid nästa synk:
 * en rad med xp_gained 0 ger en omräkning från den äldsta sådana raden, även när inga nya aktiviteter finns.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  testDatabaseConnection: vi.fn(),
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
import { checkEventQualification } from '../../services/eventService.js';
import { WeatherService } from '../../services/weatherService.js';
import { logger } from '../../utils/logger.js';
import app from '../../app.js';
import { createFakeDb, type Row, type RecordedQuery } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });

const activity = (id: number, date: string) => ({
  id, type: 'Run', sport_type: 'Run', distance: 5000, moving_time: 1500, start_date_local: `${date}T07:00:00Z`, trainer: false,
});

/** Strava-API:t: aktivitetslistan svarar med `activities`, detaljanropen faller (koden faller tillbaka på sammanfattningen). */
function stubStrava(activities: unknown[]) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/athlete/activities')) return { ok: true, status: 200, json: async () => activities };
    return { ok: false, status: 404, json: async () => ({}) };
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
  vi.mocked(WeatherService.fetchAndSaveWeatherForRuns).mockReset().mockResolvedValue(undefined); // ett oförbrukat mockRejectedValueOnce får inte läcka mellan tester
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function use(tables: Partial<Record<string, Row[]>> = {}, failWhen?: (q: RecordedQuery) => { message: string } | null) {
  const t: Record<string, Row[]> = {
    strava_tokens: [{ user_id: 'user-1', access_token: 'at', refresh_token: 'rt', expires_at: 9999999999, connection_date: '2026-09-01' }],
    runs: [],
    user_boosts: [],
    ...(tables as Record<string, Row[]>),
  };
  const db = createFakeDb(t, { autoIds: true, failWhen });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return { t, db };
}

const sync = () => server.request('POST', '/api/strava/sync', { token: mintToken({ user_id: 'user-1', group_id: 'group-1' }) });
const runsUpdateFails = (q: RecordedQuery) => (q.table === 'runs' && q.mutation === 'update' ? { message: 'update failed' } : null);
const stravaRun = (over: Row = {}): Row => ({
  id: 'run-1', user_id: 'user-1', source: 'strava', external_id: '1001', date: '2026-10-01', distance: 5, xp_gained: 0, streak_day: 1, ...over,
});

describe('syncUserStravaActivities — reprocess-fel vid import', () => {
  it('reports the sync as failed but still runs totals, weather and event qualification', async () => {
    stubStrava([activity(1001, '2026-10-01')]);
    const { t } = use({}, runsUpdateFails);

    const res = await sync();

    expect(res.status).toBe(400); // misslyckat synkresultat (routen svarar 400 + { error } vid success:false)
    expect(res.body.error).toMatch(/recalculate|XP/i);
    expect(t.runs).toHaveLength(1); // importen själv lyckades
    expect(calculateUserTotals).toHaveBeenCalledWith('user-1');
    expect(WeatherService.fetchAndSaveWeatherForRuns).toHaveBeenCalledTimes(1);
    expect(checkEventQualification).toHaveBeenCalledTimes(1);
  });

  it('ett väderfel ovanpå reprocess-felet stoppar inte totalerna', async () => {
    stubStrava([activity(1001, '2026-10-01')]);
    use({}, runsUpdateFails);
    vi.mocked(WeatherService.fetchAndSaveWeatherForRuns).mockRejectedValueOnce(new Error('weather down'));

    const res = await sync();

    expect(res.status).toBe(400);
    expect(calculateUserTotals).toHaveBeenCalledWith('user-1');
    expect(checkEventQualification).toHaveBeenCalledTimes(1);
  });

  it('lyckad synk oförändrad: 200, XP skrivet, totaler/väder/event körda', async () => {
    stubStrava([activity(1001, '2026-10-01')]);
    const { t } = use();

    const res = await sync();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, newRuns: 1 });
    expect(t.runs[0].xp_gained).toBeGreaterThan(0);
    expect(calculateUserTotals).toHaveBeenCalledTimes(1);
    expect(WeatherService.fetchAndSaveWeatherForRuns).toHaveBeenCalledTimes(1);
    expect(checkEventQualification).toHaveBeenCalledTimes(1);
  });
});

describe('syncUserStravaActivities — självläkning av rader med XP 0', () => {
  it('a later sync reprocesses already-imported Strava runs that still have placeholder XP 0', async () => {
    stubStrava([activity(1001, '2026-10-01')]); // inga NYA aktiviteter: 1001 är redan importerad
    const { t } = use({ runs: [stravaRun(), stravaRun({ id: 'run-2', external_id: '1002', date: '2026-10-02', xp_gained: 0 })] });

    const res = await sync();

    expect(res.status).toBe(200);
    expect(t.runs.every((r) => r.xp_gained > 0)).toBe(true);
    expect(t.runs.map((r) => r.streak_day)).toEqual([1, 2]);
    expect(calculateUserTotals).toHaveBeenCalledWith('user-1');
  });

  it('omräkningen startar från den äldsta raden med XP 0 — rader före den rörs inte', async () => {
    stubStrava([]);
    const { t } = use({
      runs: [
        stravaRun({ id: 'run-0', external_id: '999', date: '2026-09-20', xp_gained: 77, streak_day: 1 }),
        stravaRun({ id: 'run-1', date: '2026-10-01', xp_gained: 0 }),
      ],
    });

    await sync();

    expect(t.runs.find((r) => r.id === 'run-0')!.xp_gained).toBe(77);
    expect(t.runs.find((r) => r.id === 'run-1')!.xp_gained).toBeGreaterThan(0);
  });

  it('ett misslyckat läkningsförsök fäller inte synken (och försöket upprepas nästa gång)', async () => {
    stubStrava([]);
    const { t } = use({ runs: [stravaRun()] }, runsUpdateFails);

    const res = await sync();

    expect(res.status).toBe(200);
    expect(t.runs[0].xp_gained).toBe(0); // fortfarande 0 → nästa synk försöker igen
  });

  it('inga rader med XP 0 → ingen onödig omräkning', async () => {
    stubStrava([]);
    const { db } = use({ runs: [stravaRun({ xp_gained: 25 })] });

    await sync();

    expect(db.queries.filter((q) => q.table === 'runs' && q.mutation === 'update')).toHaveLength(0);
    expect(calculateUserTotals).not.toHaveBeenCalled();
  });
});
