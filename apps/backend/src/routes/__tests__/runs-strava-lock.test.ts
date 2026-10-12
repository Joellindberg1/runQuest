/**
 * RUN-139: distans och datum på Strava-rundor går inte att redigera — Strava är sanningskällan (ägarbeslut 2026-10-11).
 *
 * Gäller även DELETE /api/runs/:id (spärren satt tidigare bara i UI:t).
 *
 * PUT /api/runs/:id redigerar bara distance och date, så en Strava-runda har inget redigerbart fält kvar: 409 med
 * { error: 'Strava runs are read-only' } (ADR 007: fel = HTTP-status + { error }), utan skrivning och utan omräkning.
 * Ägarskapskontrollen (404/403) körs först och är oförändrad. Manuella rundor beter sig som förut.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

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
import { calculateUserTotals } from '../../utils/calculateUserTotals.js';
import { checkEventQualification } from '../../services/eventService.js';
import app from '../../app.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });
beforeEach(() => { vi.clearAllMocks(); });

const run = (over: Row = {}): Row => ({
  id: 'run-1', user_id: 'user-1', date: '2026-10-01', distance: 4, streak_day: 1, xp_gained: 20,
  source: 'manual', external_id: null, ...over,
});
const stravaRun = (over: Row = {}): Row => run({ source: 'strava', external_id: '42', ...over });

function use(runs: Row[]) {
  const tables: Record<string, Row[]> = { runs, user_boosts: [], event_entries: [] };
  const db = createFakeDb(tables, { autoIds: true });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return { tables, db };
}

const token = mintToken({ user_id: 'user-1', group_id: 'group-1' });
const put = (id: string, body: unknown) => server.request('PUT', `/api/runs/${id}`, { token, body });
const writes = (db: ReturnType<typeof use>['db']) => db.queries.filter((q) => q.mutation);

describe('PUT /api/runs/:id — Strava-rundor är skrivskyddade', () => {
  it('Strava-runda: ändrad distans → 409, inget skrivs (update ej anropad)', async () => {
    const { tables, db } = use([stravaRun()]);
    const res = await put('run-1', { distance: 9, date: '2026-10-01' });
    expect(res.status).toBe(409);
    expect(checkEventQualification).not.toHaveBeenCalled();
    expect(res.body).toEqual({ error: 'Strava runs are read-only' });
    expect(writes(db)).toEqual([]);
    expect(tables.runs[0].distance).toBe(4);
    expect(tables.runs[0].date).toBe('2026-10-01');
  });

  it('Strava-runda: ändrat datum → 409', async () => {
    const { tables, db } = use([stravaRun()]);
    const res = await put('run-1', { distance: 4, date: '2026-10-02' });
    expect(res.status).toBe(409);
    expect(checkEventQualification).not.toHaveBeenCalled();
    expect(res.body).toEqual({ error: 'Strava runs are read-only' });
    expect(writes(db)).toEqual([]);
    expect(tables.runs[0].date).toBe('2026-10-01');
  });

  it('Strava-runda: PUT med oförändrad distans/datum → 409 ändå', async () => {
    const { tables, db } = use([stravaRun()]);
    const res = await put('run-1', { distance: 4, date: '2026-10-01' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Strava runs are read-only' });
    expect(checkEventQualification).not.toHaveBeenCalled();
    expect(writes(db)).toEqual([]);
    expect(tables.runs[0]).toMatchObject({ distance: 4, date: '2026-10-01' });
  });

  it('Strava-runda: ingen omräkning (rundor skrivs inte om, användartotaler räknas inte)', async () => {
    const { db } = use([stravaRun(), run({ id: 'run-2', date: '2026-10-02', streak_day: 2 })]);
    await put('run-1', { distance: 9, date: '2026-09-30' });
    expect(calculateUserTotals).not.toHaveBeenCalled();
    // Bara ägarskapsläsningen av rundan: en omräkning hade läst användarens hela rundlista och skrivit streak/XP.
    expect(db.queries.filter((q) => q.table === 'runs')).toHaveLength(1);
    expect(writes(db)).toEqual([]);
  });

  it('annans Strava-runda → 403 som förut (ägarskap kontrolleras före Strava-låset)', async () => {
    const { db } = use([stravaRun({ user_id: 'user-2' })]);
    const res = await put('run-1', { distance: 9, date: '2026-10-01' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Not authorized to update this run');
    expect(writes(db)).toEqual([]);
  });

  it('saknad runda → 404 som förut', async () => {
    use([]);
    const res = await put('run-1', { distance: 9, date: '2026-10-01' });
    expect(res.status).toBe(404);
  });

  it('manuell runda: distans/datum ändras som förut', async () => {
    const { tables } = use([run()]);
    const res = await put('run-1', { distance: 6, date: '2026-10-01' });
    expect(res.status).toBe(200);
    expect(tables.runs[0].distance).toBe(6);
    expect(calculateUserTotals).toHaveBeenCalledWith('user-1');

    const moved = await put('run-1', { distance: 6, date: '2026-09-30' });
    expect(moved.status).toBe(200);
    expect(tables.runs[0].date).toBe('2026-09-30');
  });

  it('äldre rad utan source (null) räknas som manuell och kan ändras', async () => {
    const { tables } = use([run({ source: null })]);
    const res = await put('run-1', { distance: 7, date: '2026-10-01' });
    expect(res.status).toBe(200);
    expect(tables.runs[0].distance).toBe(7);
  });
});

const del = (id: string) => server.request('DELETE', `/api/runs/${id}`, { token });

describe('DELETE /api/runs/:id — Strava-rundor är skrivskyddade', () => {
  it('Strava-runda: radering → 409, inget skrivs (delete ej anropad), ingen omräkning', async () => {
    const { tables, db } = use([stravaRun(), run({ id: 'run-2', date: '2026-10-02', streak_day: 2 })]);
    const res = await del('run-1');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Strava runs are read-only' });
    expect(writes(db)).toEqual([]);
    expect(tables.runs.map((r) => r.id)).toEqual(['run-1', 'run-2']);
    expect(calculateUserTotals).not.toHaveBeenCalled();
    expect(checkEventQualification).not.toHaveBeenCalled();
  });

  it('Strava-runda som också kvalificerat ett event: Strava-409:an går före event-409:an (ingen event_entries-query)', async () => {
    const { tables, db } = use([stravaRun()]);
    tables.event_entries.push({ id: 'e1', run_id: 'run-1' });
    const res = await del('run-1');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Strava runs are read-only' });
    expect(db.queries.some((q) => q.table === 'event_entries')).toBe(false);
    expect(writes(db)).toEqual([]);
  });

  it('annans Strava-runda → 403 som förut', async () => {
    const { tables, db } = use([stravaRun({ user_id: 'user-2' })]);
    const res = await del('run-1');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Not authorized to delete this run');
    expect(writes(db)).toEqual([]);
    expect(tables.runs).toHaveLength(1);
  });

  it('saknad runda → 404 som förut', async () => {
    use([]);
    expect((await del('run-1')).status).toBe(404);
  });

  it('manuell runda: radering som förut', async () => {
    const { tables } = use([run()]);
    const res = await del('run-1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(tables.runs).toHaveLength(0);
    expect(calculateUserTotals).toHaveBeenCalledWith('user-1');
  });

  it('manuell runda som kvalificerat ett event: event-409 som förut', async () => {
    const { tables } = use([run()]);
    tables.event_entries.push({ id: 'e1', run_id: 'run-1' });
    const res = await del('run-1');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/qualified an event/);
    expect(tables.runs).toHaveLength(1);
  });
});
