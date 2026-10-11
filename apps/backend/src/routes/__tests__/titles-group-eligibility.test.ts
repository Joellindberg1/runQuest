/**
 * RUN-98 T3/T5 — GET /api/titles/group-eligibility: runs-selecten hämtar run_weather och ctx.now skickas till
 * motorerna, medan svarets form är oförändrad (envelope, {userId, name, gender, values}, de 21 nycklarna).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

const holder = vi.hoisted(() => ({ client: null as any }));

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { get client() { return holder.client; } },
  testDatabaseConnection: vi.fn(),
  getSupabaseClient: vi.fn(() => holder.client),
}));

import app from '../../app.js';
import { titleEngineRegistry } from '../../titleEngines/index.js';
import type { TitleEngine } from '../../titleEngines/types.js';
import { createFakeDb } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

const NOW = new Date('2026-12-20T10:00:00Z');
const SPY_KEY = '__weatherSpy';
const spyEngine = { metricKey: SPY_KEY, calculate: vi.fn(() => 1) };

const ENGINE_KEYS = [
  'longestRun', 'totalKm', 'longestStreak', 'weekendAvg', 'nightRunCount', 'earlyRunCount', 'lunchRunCount',
  'maxRunsOneWeek', 'longestRunAfterBreak14', 'longestRunAfterBreak30', 'lowestPaceStdDev', 'maxWeekdayStreak',
  'bestDoubleDayKm', 'fastestMarathon', 'fastestHalfMarathon', 'lastRunOfWeek', 'maxKmRolling30',
  'totalElevationGain', 'bestSingleRunElevation', 'fastest5km', 'avgPaceStdDev',
  'winterKm', // RUN-100: första motorn efter de 21
  'stormRunCount', 'coldRunCount', // RUN-99
];

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });
beforeEach(() => {
  vi.clearAllMocks();
  titleEngineRegistry.set(SPY_KEY, spyEngine as TitleEngine);
  vi.useFakeTimers({ toFake: ['Date'] }); // bara klockan — riktiga timers behövs för HTTP-servern
  vi.setSystemTime(NOW);
});
afterEach(() => {
  titleEngineRegistry.delete(SPY_KEY);
  vi.useRealTimers();
});

function seed() {
  const db = createFakeDb({
    users: [
      { id: 'user-1', name: 'Alice', group_id: 'group-1', total_km: 13.5, longest_streak: 2, gender: 'female' },
      { id: 'user-2', name: 'Bob', group_id: 'group-1', total_km: 6, longest_streak: 1, gender: null },
      { id: 'admin', name: 'Admin', group_id: 'group-1', total_km: 0, longest_streak: 0, gender: null },
      { id: 'user-3', name: 'Carol', group_id: 'group-2', total_km: 99, longest_streak: 9, gender: 'female' },
    ],
    runs: [
      { id: 'r1', user_id: 'user-1', date: '2026-12-01', distance: 8.5, start_time: null, total_elevation_gain: 20,
        pace_std_dev: null, moving_time: 3000, run_weather: { temperature_c: -4, wind_speed_ms: 12, wind_gusts_ms: 19 } },
      { id: 'r2', user_id: 'user-1', date: '2026-12-02', distance: 5, start_time: null, total_elevation_gain: null,
        pace_std_dev: null, moving_time: null, run_weather: null },
      { id: 'r3', user_id: 'user-2', date: '2026-12-03', distance: 6, start_time: null, total_elevation_gain: null,
        pace_std_dev: null, moving_time: null, run_weather: [{ temperature_c: 3, wind_speed_ms: 1, wind_gusts_ms: 2 }] },
      { id: 'r4', user_id: 'user-3', date: '2026-12-04', distance: 40, start_time: null, total_elevation_gain: null,
        pace_std_dev: null, moving_time: null, run_weather: null },
    ],
  });
  holder.client = db.client;
  return db;
}

describe('GET /api/titles/group-eligibility', () => {
  it('svarets form är oförändrad: envelope, {userId, name, gender, values} och motornycklarna (21 + winterKm, stormRunCount, coldRunCount)', async () => {
    seed();
    const res = await server.request('GET', '/api/titles/group-eligibility', { token: mintToken({ user_id: 'user-1' }) });

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['data', 'success']);
    expect(res.body.success).toBe(true);
    expect(res.body.data.map((e: any) => e.userId).sort()).toEqual(['user-1', 'user-2']); // gruppen, utan Admin
    for (const entry of res.body.data) {
      expect(Object.keys(entry).sort()).toEqual(['gender', 'name', 'userId', 'values']);
    }
    const alice = res.body.data.find((e: any) => e.userId === 'user-1');
    expect(alice).toMatchObject({ name: 'Alice', gender: 'female' });
    expect(alice.values).toMatchObject({ longestRun: 8.5, totalKm: 13.5, longestStreak: 2, totalElevationGain: 20 });
    expect(ENGINE_KEYS.every((k) => k in alice.values)).toBe(true);
    // ingen ny nyckel får läcka ut i svaret förrän en riktig motor registrerats (spionmotorn är testets egen)
    expect(Object.keys(alice.values).filter((k) => !ENGINE_KEYS.includes(k))).toEqual([SPY_KEY]);
    expect(res.body.data.find((e: any) => e.userId === 'user-2').gender).toBeNull();
  });

  it('runs-selecten hämtar run_weather och motorerna får väder + ctx.now', async () => {
    const db = seed();
    await server.request('GET', '/api/titles/group-eligibility', { token: mintToken({ user_id: 'user-1' }) });

    const runReads = db.queries.filter((q) => q.table === 'runs');
    expect(runReads).toHaveLength(2);
    for (const q of runReads) {
      expect(q.select).toContain('run_weather(temperature_c, wind_speed_ms, wind_gusts_ms)');
    }

    expect(spyEngine.calculate).toHaveBeenCalledTimes(2);
    const calls = spyEngine.calculate.mock.calls as unknown as any[][];
    for (const call of calls) expect(call[2]).toEqual({ now: NOW });
    const aliceRuns = calls.map((c) => c[0]).find((runs) => runs[0].date === '2026-12-01')!;
    expect(aliceRuns[0]).toMatchObject({ temperature_c: -4, wind_speed_ms: 12, wind_gusts_ms: 19 });
    expect(aliceRuns[1]).toMatchObject({ temperature_c: null, wind_speed_ms: null, wind_gusts_ms: null });
    const bobRuns = calls.map((c) => c[0]).find((runs) => runs[0].date === '2026-12-03')!;
    expect(bobRuns[0]).toMatchObject({ temperature_c: 3, wind_speed_ms: 1, wind_gusts_ms: 2 });
  });

  it('400 när anroparen saknar grupp (oförändrat)', async () => {
    holder.client = createFakeDb({ users: [{ id: 'user-9', group_id: null }], runs: [] }).client;
    const res = await server.request('GET', '/api/titles/group-eligibility', { token: mintToken({ user_id: 'user-9' }) });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'No group found for user' });
  });
});
