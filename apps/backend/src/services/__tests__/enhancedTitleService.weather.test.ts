/**
 * RUN-98 T3 — titelmotorerna får väder per runda (run_weather) och ett injicerbart "nu" (ctx.now).
 * Stormborn/Iceborn/Winter Warrior bygger på detta; här bevisas bara att datat når motorn.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const holder = vi.hoisted(() => ({ client: null as any }));

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { get client() { return holder.client; } },
  getSupabaseClient: vi.fn(() => holder.client),
}));
const MEMBER = { userId: 'u1', groupId: 'g1', window: { from: null } };

import { EnhancedTitleService } from '../enhancedTitleService.js';
import { titleEngineRegistry } from '../../titleEngines/index.js';
import type { TitleEngine } from '../../titleEngines/types.js';
import { createFakeDb, type Row } from '../../routes/__tests__/helpers/fakeDb.js';

const NOW = new Date('2026-12-20T10:00:00Z');
const SPY_KEY = '__weatherSpy';

const spyEngine = { metricKey: SPY_KEY, calculate: vi.fn(() => 1) };

function tables(): Record<string, Row[]> {
  return {
    users: [
      { id: 'u1', group_id: 'g1', total_km: 10, longest_streak: 1 },
      { id: 'u2', group_id: 'g1', total_km: 20, longest_streak: 2 },
    ],
    runs: [
      { id: 'r1', user_id: 'u1', date: '2026-12-01', distance: '8.5', start_time: null, total_elevation_gain: null,
        pace_std_dev: null, moving_time: null,
        run_weather: { temperature_c: '-3.5', wind_speed_ms: '11.0', wind_gusts_ms: 17.5 } },
      { id: 'r2', user_id: 'u1', date: '2026-12-02', distance: 5, start_time: null, total_elevation_gain: null,
        pace_std_dev: null, moving_time: null, run_weather: null },
      { id: 'r3', user_id: 'u2', date: '2026-12-03', distance: 6, start_time: null, total_elevation_gain: null,
        pace_std_dev: null, moving_time: null,
        run_weather: [{ temperature_c: 4, wind_speed_ms: 1.5, wind_gusts_ms: null }] },
    ],
    group_members: [
      { id: 'm1', user_id: 'u1', group_id: 'g1', role: 'member', starts_on: null, left_at: null },
      { id: 'm2', user_id: 'u2', group_id: 'g1', role: 'member', starts_on: null, left_at: null },
    ],
    titles: [{ id: 't1', name: 'Spy', description: '', unlock_requirement: 0, metric_key: SPY_KEY }],
    user_titles: [],
    title_leaderboard: [],
    activity_log: [],
  };
}

function setup() {
  const db = createFakeDb(tables(), { numericIds: ['activity_log'] });
  holder.client = db.client;
  return { db, service: new EnhancedTitleService() };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  titleEngineRegistry.set(SPY_KEY, spyEngine as TitleEngine);
});
afterEach(() => {
  titleEngineRegistry.delete(SPY_KEY);
  vi.useRealTimers();
});

describe('processGroupTitles — väder och ctx', () => {
  it('processGroupTitles hämtar run_weather i runs-selecten och skickar ctx.now till motorn', async () => {
    const { db, service } = setup();
    await service.processGroupTitles('g1', { emitNews: false });

    const runReads = db.queries.filter((q) => q.table === 'runs');
    expect(runReads).toHaveLength(2);
    for (const q of runReads) {
      expect(q.select).toContain('run_weather(temperature_c, wind_speed_ms, wind_gusts_ms)');
      // de gamla kolumnerna ska finnas kvar
      for (const col of ['date', 'distance', 'start_time', 'total_elevation_gain', 'pace_std_dev', 'moving_time']) {
        expect(q.select).toContain(col);
      }
    }

    expect(spyEngine.calculate).toHaveBeenCalledTimes(2);
    for (const call of spyEngine.calculate.mock.calls as unknown as any[][]) {
      expect(call[2]).toEqual({ now: NOW });
    }
  });

  it('väderfälten når motorn som tal (objekt, null och array från PostgREST-embeden)', async () => {
    const { service } = setup();
    await service.processGroupTitles('g1', { emitNews: false });

    const byFirstDate = new Map<string, any[]>();
    for (const call of spyEngine.calculate.mock.calls as unknown as any[][]) byFirstDate.set(call[0][0].date, call[0]);

    const u1 = byFirstDate.get('2026-12-01')!;
    expect(u1[0]).toMatchObject({ distance_km: 8.5, temperature_c: -3.5, wind_speed_ms: 11, wind_gusts_ms: 17.5 });
    expect(u1[1]).toMatchObject({ temperature_c: null, wind_speed_ms: null, wind_gusts_ms: null });

    const u2 = byFirstDate.get('2026-12-03')!;
    expect(u2[0]).toMatchObject({ temperature_c: 4, wind_speed_ms: 1.5, wind_gusts_ms: null });
  });

  it('alla användare i en körning delar samma ctx.now (ett "nu" per omräkning)', async () => {
    const { service } = setup();
    vi.setSystemTime(NOW);
    const seen: Date[] = [];
    spyEngine.calculate.mockImplementation(((_r: unknown, _s: unknown, ctx: { now: Date }) => {
      seen.push(ctx.now);
      vi.setSystemTime(new Date(NOW.getTime() + 60_000)); // klockan går medan körningen pågår
      return 1;
    }) as any);
    await service.processGroupTitles('g1', { emitNews: false });
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
    spyEngine.calculate.mockImplementation(() => 1);
  });

  it('processUserTitlesAfterRun utan ctx defaultar till nuvarande tid', async () => {
    const { service } = setup();
    await service.processUserTitlesAfterRun(MEMBER, [{ date: '2026-12-01', distance_km: 5 }], { total_km: 5, longest_streak: 1 });
    expect(spyEngine.calculate).toHaveBeenCalledTimes(1);
    expect((spyEngine.calculate.mock.calls[0] as unknown as any[])[2]).toEqual({ now: NOW });
  });

  it('processUserTitlesAfterRun skickar ett explicit ctx vidare oförändrat', async () => {
    const { service } = setup();
    const ctx = { now: new Date('2027-01-01T00:00:00Z') };
    await service.processUserTitlesAfterRun(MEMBER, [{ date: '2026-12-01', distance_km: 5 }], { total_km: 5, longest_streak: 1 }, ctx);
    expect((spyEngine.calculate.mock.calls[0] as unknown as any[])[2]).toBe(ctx);
  });

  it('calculateUserValues skickar ctx till motorerna (default: nu)', () => {
    const { service } = setup();
    service.calculateUserValues([{ date: '2026-12-01', distance_km: 5, run_weather: { temperature_c: 2 } }], 5, 1);
    const call = spyEngine.calculate.mock.calls[0] as unknown as any[];
    expect(call[2]).toEqual({ now: NOW });
    expect(call[0][0].temperature_c).toBe(2);

    const ctx = { now: new Date('2027-02-02T00:00:00Z') };
    service.calculateUserValues([], 0, 0, ctx);
    expect((spyEngine.calculate.mock.calls[1] as unknown as any[])[2]).toBe(ctx);
  });
});
