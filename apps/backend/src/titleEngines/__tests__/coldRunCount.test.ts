/**
 * RUN-99 T2 — Iceborn: antal rundor med verklig temperatur (temperature_c, inte apparent) på högst ICE_TEMP_C.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { coldRunCountEngine, ICE_TEMP_C } from '../coldRunCount.js';
import type { RunData, UserStats } from '../types.js';

const stats: UserStats = { totalKm: 0, longestStreak: 0 };
const run = (temperature_c?: number | null): RunData => ({ date: '2026-01-10', distance_km: 5, temperature_c });
const calc = (runs: RunData[]) => coldRunCountEngine.calculate(runs, stats);

describe('coldRunCount (RUN-99 T2)', () => {
  it('har metricKey coldRunCount och tröskeln 5 °C', () => {
    expect(coldRunCountEngine.metricKey).toBe('coldRunCount');
    expect(ICE_TEMP_C).toBe(5);
  });

  it('5,0 °C räknas, 5,1 inte', () => {
    expect(calc([run(5.0)])).toBe(1);
    expect(calc([run(5.1)])).toBe(0);
  });

  it('null-temperatur räknas inte (ingen väderrad är inte 0 °C)', () => {
    expect(calc([run(null), run(undefined), run(-1)])).toBe(1);
  });

  it('−12 °C räknas; 0 °C räknas', () => {
    expect(calc([run(-12), run(0), run(18)])).toBe(2);
  });

  it('läser temperature_c, inte upplevd temperatur', () => {
    const r = { ...run(8), apparent_temp_c: -3 } as RunData;
    expect(calc([r])).toBe(0);
  });

  it('tom lista → 0', () => {
    expect(calc([])).toBe(0);
  });
});
