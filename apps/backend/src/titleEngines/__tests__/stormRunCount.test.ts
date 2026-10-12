/**
 * RUN-99 T1 — Stormborn: antal rundor med vindbyar (wind_gusts_ms) på minst STORM_GUST_MS. Null räknas inte.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { stormRunCountEngine, STORM_GUST_MS } from '../stormRunCount.js';
import type { RunData, UserStats } from '../types.js';

const stats: UserStats = { totalKm: 0, longestStreak: 0 };
const run = (wind_gusts_ms?: number | null, extra: Partial<RunData> = {}): RunData =>
  ({ date: '2026-10-01', distance_km: 5, wind_gusts_ms, ...extra });
const calc = (runs: RunData[]) => stormRunCountEngine.calculate(runs, stats);

describe('stormRunCount (T1)', () => {
  it('har metricKey stormRunCount och tröskeln 12 m/s', () => {
    expect(stormRunCountEngine.metricKey).toBe('stormRunCount');
    expect(STORM_GUST_MS).toBe(12);
  });

  it('räknar rundor med byar över tröskeln', () => {
    expect(calc([run(15), run(20.4), run(3), run(8)])).toBe(2);
  });

  it('exakt 12,0 räknas (>=), 11,9 gör inte', () => {
    expect(calc([run(12.0)])).toBe(1);
    expect(calc([run(11.9)])).toBe(0);
  });

  it('runda utan väder räknas inte (null och saknat fält)', () => {
    expect(calc([run(null), run(undefined), run(30)])).toBe(1);
  });

  it('medelvinden spelar ingen roll, bara byarna', () => {
    expect(calc([run(5, { wind_speed_ms: 20 }), run(13, { wind_speed_ms: 2 })])).toBe(1);
  });

  it('tom lista → 0', () => {
    expect(calc([])).toBe(0);
  });
});
