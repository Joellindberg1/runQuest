import { describe, it, expect } from 'vitest';
import { bestDoubleDayKmEngine } from '../bestDoubleDayKm.js';
import type { RunData, UserStats } from '../types.js';

const stats: UserStats = { totalKm: 0, longestStreak: 0 };
const run = (date: string, time: string | null, distance_km: number): RunData => ({
  date,
  distance_km,
  start_time: time === null ? null : `${date}T${time}:00Z`,
});
const calc = (runs: RunData[]) => bestDoubleDayKmEngine.calculate(runs, stats);

describe('bestDoubleDayKm', () => {
  it('gives no value when two runs on one day start less than 4 hours apart', () => {
    expect(calc([run('2026-07-04', '07:00', 6), run('2026-07-04', '08:00', 5)])).toBe(0);
  });

  it('gives no value when three runs on one day are all under 5 km', () => {
    expect(calc([run('2026-07-04', '07:00', 4), run('2026-07-04', '12:00', 4), run('2026-07-04', '18:00', 4)])).toBe(0);
  });

  it('gives no value when the second 5 km run has no start time', () => {
    expect(calc([run('2026-07-04', '07:00', 6), run('2026-07-04', null, 5)])).toBe(0);
  });

  it('gives no value without any runs', () => {
    expect(calc([])).toBe(0);
  });

  it('sums the two runs of a day that meets the rule', () => {
    expect(calc([run('2026-07-04', '07:00', 6), run('2026-07-04', '12:00', 5)])).toBe(11);
  });

  it('does not count a run under 5 km on a qualifying day', () => {
    expect(calc([run('2026-07-04', '07:00', 6), run('2026-07-04', '12:00', 5), run('2026-07-04', '18:00', 3)])).toBe(11);
  });

  it('picks the best qualifying day and ignores a bigger non-qualifying day', () => {
    const runs = [
      run('2026-07-04', '07:00', 6), run('2026-07-04', '12:00', 5), // 11, qualifies
      run('2026-07-05', '07:00', 9), run('2026-07-05', '12:00', 8), // 17, qualifies
      run('2026-07-06', '07:00', 20), run('2026-07-06', '08:00', 20), // 40, gap too short
    ];
    expect(calc(runs)).toBe(17);
  });
});
