/**
 * RUN-136: runs.source (och external_id) sätts av servern, aldrig av klienten.
 *
 * source styr bland annat Precisionist-badgen (bara Strava-rundor) och Strava-dedupen; en manuell
 * runda som klienten själv stämplar 'strava' kringgår båda. Bara Strava-importen får skriva 'strava'.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

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
import app from '../../app.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });
beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const manualRun = (over: Row = {}): Row => ({
  id: 'run-1', user_id: 'user-1', date: '2026-10-01', distance: 4, streak_day: 1, xp_gained: 20,
  source: 'manual', external_id: null, ...over,
});

function use(tables: Record<string, Row[]> = {}) {
  const t: Record<string, Row[]> = { runs: [manualRun()], user_boosts: [], ...tables };
  const db = createFakeDb(t, { autoIds: true });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return t;
}

const token = mintToken({ user_id: 'user-1', group_id: 'group-1' });
const post = (body: unknown) => server.request('POST', '/api/runs', { token, body });
const put = (id: string, body: unknown) => server.request('PUT', `/api/runs/${id}`, { token, body });

describe('POST /api/runs — source är serverstyrd', () => {
  it("body.source 'strava' ignoreras: sparas som 'manual'", async () => {
    const tables = use({ runs: [] });
    const res = await post({ date: '2026-10-02', distance: 5, source: 'strava' });
    expect(res.status).toBe(200);
    expect(tables.runs).toHaveLength(1);
    expect(tables.runs[0].source).toBe('manual');
  });

  it("body.external_id ignoreras: ingen klientstyrd external_id sparas", async () => {
    const tables = use({ runs: [] });
    const res = await post({ date: '2026-10-02', distance: 5, source: 'strava', external_id: '123456789' });
    expect(res.status).toBe(200);
    expect(tables.runs[0].source).toBe('manual');
    expect(tables.runs[0].external_id ?? null).toBeNull();
  });

  it("godtyckligt source-värde i body sparas inte heller", async () => {
    const tables = use({ runs: [] });
    await post({ date: '2026-10-02', distance: 5, source: 'garmin' });
    expect(tables.runs[0].source).toBe('manual');
  });

  it("utan source i body sparas 'manual' (oförändrat beteende)", async () => {
    const tables = use({ runs: [] });
    await post({ date: '2026-10-02', distance: 5 });
    expect(tables.runs[0].source).toBe('manual');
  });

  it("svaret visar den sparade källan 'manual'", async () => {
    use({ runs: [] });
    const res = await post({ date: '2026-10-02', distance: 5, source: 'strava' });
    expect(res.body.run.source).toBe('manual');
  });
});

describe('PUT /api/runs/:id — source och external_id kan inte ändras', () => {
  it("body.source 'strava' på en manuell runda lämnar source oförändrad", async () => {
    const tables = use();
    const res = await put('run-1', { distance: 6, source: 'strava' });
    expect(res.status).toBe(200);
    expect(tables.runs[0].distance).toBe(6);
    expect(tables.runs[0].source).toBe('manual');
  });

  it('body.external_id och body.source sparas inte', async () => {
    const tables = use();
    await put('run-1', { distance: 6, source: 'strava', external_id: '999' });
    expect(tables.runs[0].source).toBe('manual');
    expect(tables.runs[0].external_id).toBeNull();
  });

  // Sedan RUN-139 avvisas PUT på en Strava-runda med 409 (se runs-strava-lock.test.ts); här säkras att inget i body kan flytta source/external_id.
  it("en Strava-runda förblir 'strava' med oförändrat external_id vid redigering med source/external_id i body", async () => {
    const tables = use({ runs: [manualRun({ source: 'strava', external_id: '42' })] });
    await put('run-1', { distance: 6, source: 'manual', external_id: null });
    expect(tables.runs[0].source).toBe('strava');
    expect(tables.runs[0].external_id).toBe('42');
  });
});

describe('Strava-importen skriver fortfarande source = strava', () => {
  it('POST /api/strava/sync sparar importerade rundor som strava med external_id', async () => {
    const tables = use({
      runs: [],
      strava_tokens: [{ user_id: 'user-1', access_token: 'at', refresh_token: 'rt', expires_at: 9999999999, connection_date: '2026-09-01' }],
    });
    // fakeDb saknar stöd för .not('external_id','is',null) (och kastar hellre än matchar tyst) — släpp igenom just det anropet.
    const real = vi.mocked(getSupabaseClient)();
    vi.mocked(getSupabaseClient).mockReturnValue({
      ...real,
      from: (table: string) => {
        const b: any = (real as any).from(table);
        const origNot = b.not.bind(b);
        b.not = (col: string, op: string, val: unknown) => (op === 'is' ? b : origNot(col, op, val));
        return b;
      },
    } as any);

    const activity = {
      id: 777001, type: 'Run', sport_type: 'Run', distance: 6000, moving_time: 1800,
      start_date_local: '2026-10-02T07:00:00Z', trainer: false,
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/athlete/activities')) return { ok: true, status: 200, json: async () => [activity] };
      return { ok: true, status: 200, json: async () => activity }; // detaljerad aktivitet
    }));

    const res = await server.request('POST', '/api/strava/sync', { token });
    expect(res.status).toBe(200);
    expect(res.body.newRuns).toBe(1);
    expect(tables.runs).toHaveLength(1);
    expect(tables.runs[0].source).toBe('strava');
    expect(tables.runs[0].external_id).toBe('777001');
  });
});
