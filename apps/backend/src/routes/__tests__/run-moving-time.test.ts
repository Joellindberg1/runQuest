/**
 * `moving_time` (sekunder, nullbar) på rundorna i två läs-svar (ADR 007 Addendum 2026-10-26, punkt 2): GET /api/runs/group-history och
 * GET /api/auth/users-with-runs. POST- och PUT-svaren får inte fältet (manuella rundor har aldrig tid).
 * Fake-DB:n projicerar medvetet inte kolumner, så "svaret innehåller inte fältet" bevisas både på svaret och på kolumnlistorna som routen begär.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';

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
afterEach(() => { vi.clearAllMocks(); });

const GROUP = 'group-1';
const token = () => mintToken({ user_id: 'user-1', group_id: GROUP });

function useDb(tables: Record<string, Row[]>) {
  const db = createFakeDb(tables, { autoIds: true });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as never);
  return db;
}

function historyRow(id: string, extra: Row = {}): Row {
  return {
    id, user_id: 'user-1', date: '2026-10-01', distance: '5.0', xp_gained: 30, multiplier: '1.0', streak_day: 1, base_xp: 15, km_xp: 10,
    distance_bonus: 5, streak_bonus: 0, source: 'manual', is_treadmill: null, start_time: null, created_at: '2026-10-01T08:00:00Z', run_weather: null,
    users: { group_id: GROUP, name: 'Anna', current_level: 3, profile_picture: null, total_xp: 100 },
    ...extra,
  };
}

it('group-history returns moving_time in seconds for a run that has it', async () => {
  useDb({ runs: [historyRow('r-strava', { source: 'strava', start_time: '2026-10-01T06:30:00Z', moving_time: 3120 })] });
  const res = await server.request('GET', '/api/runs/group-history', { token: token() });
  expect(res.status).toBe(200);
  expect(res.body.runs).toHaveLength(1);
  expect(res.body.runs[0].moving_time).toBe(3120);
  expect(Number.isInteger(res.body.runs[0].moving_time)).toBe(true);
  expect(res.body.data.runs[0].moving_time).toBe(3120);
});

it('group-history returns null moving_time for a manual run', async () => {
  useDb({ runs: [historyRow('r-manual', { moving_time: null }), historyRow('r-old', { id: 'r-old', date: '2026-09-30' })] });
  const res = await server.request('GET', '/api/runs/group-history', { token: token() });
  expect(res.status).toBe(200);
  expect(res.body.runs).toHaveLength(2);
  for (const run of res.body.runs) {
    expect(run).toHaveProperty('moving_time', null);
  }
});

it('users-with-runs includes moving_time on every run', async () => {
  const db = useDb({
    users: [{
      id: 'user-1', group_id: GROUP, total_xp: 10,
      runs: [
        { id: 'r1', date: '2026-10-01', distance: 5, source: 'strava', moving_time: 1500 },
        { id: 'r2', date: '2026-10-02', distance: 6, source: 'manual', moving_time: null },
      ],
    }],
    user_challenge_tokens: [],
  });
  const res = await server.request('GET', '/api/auth/users-with-runs', { token: token() });
  expect(res.status).toBe(200);

  const sel = db.queries.find((q) => q.table === 'users')!.select!;
  const runsSelect = sel.slice(sel.indexOf('runs('));
  expect(runsSelect).toMatch(/\bmoving_time\b/);

  const runs = res.body.data[0].runs;
  expect(runs).toHaveLength(2);
  for (const run of runs) {
    expect(run).toHaveProperty('moving_time');
    expect(run.moving_time === null || typeof run.moving_time === 'number').toBe(true);
  }
  expect(runs.map((r: Row) => r.moving_time)).toEqual([1500, null]);
});

it('create and update responses do not expose moving_time', async () => {
  const tables: Record<string, Row[]> = {
    runs: [{
      id: 'run-1', user_id: 'user-1', date: '2026-10-01', distance: 4, streak_day: 1, xp_gained: 0, multiplier: 1, base_xp: 0, km_xp: 0, distance_bonus: 0,
      streak_bonus: 0, source: 'manual', external_id: null, is_treadmill: null,
    }],
    users: [{ id: 'user-1', name: 'Alice', current_level: 3, total_xp: 100, profile_picture: null, group_id: GROUP }],
    user_boosts: [], event_entries: [], run_weather: [],
  };
  const db = useDb(tables);

  const created = await server.request('POST', '/api/runs', { token: token(), body: { date: '2026-10-02', distance: 5 } });
  expect(created.status).toBe(200);
  expect(created.body.run).toMatchObject({ distance: 5 });
  expect(created.body.run).not.toHaveProperty('moving_time');
  expect(created.body.data.run).not.toHaveProperty('moving_time');

  const updated = await server.request('PUT', '/api/runs/run-1', { token: token(), body: { date: '2026-10-01', distance: 9 } });
  expect(updated.status).toBe(200);
  expect(updated.body.run).toMatchObject({ id: 'run-1' });
  expect(updated.body.run).not.toHaveProperty('moving_time');
  expect(updated.body.data.run).not.toHaveProperty('moving_time');

  // Fake-DB:n projicerar inte, så en rads fält skulle alltid komma med i svaret: kolumnlistorna som routen begär är det som avgör, och ingen av dem
  // (eller någon skriven rad) får bära fältet.
  for (const row of tables.runs) expect(row).not.toHaveProperty('moving_time');
  const projections = db.queries.filter((q) => q.table === 'runs' && q.select !== null && q.select !== '*').map((q) => q.select!);
  expect(projections.length).toBeGreaterThan(0);
  for (const columns of projections) expect(columns).not.toMatch(/moving_time/);
});
