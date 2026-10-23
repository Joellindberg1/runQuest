import { describe, it, expect } from 'vitest';
import { totalElevationGainEngine } from '../totalElevationGain.js';
import { bestSingleRunElevationEngine } from '../bestSingleRunElevation.js';
import type { RunData, UserStats } from '../types.js';

const stats: UserStats = { totalKm: 0, longestStreak: 0 };
const run = (elevation: number | null, is_treadmill: boolean | null | undefined): RunData => ({
  date: '2026-07-04',
  distance_km: 10,
  total_elevation_gain: elevation,
  ...(is_treadmill === undefined ? {} : { is_treadmill }),
});

describe('totalElevationGain', () => {
  it('does not count the elevation of a treadmill run', () => {
    expect(totalElevationGainEngine.calculate([run(100, false), run(300, true)], stats)).toBe(100);
  });

  it('counts runs with is_treadmill null or missing as outdoors', () => {
    expect(totalElevationGainEngine.calculate([run(100, null), run(50, undefined), run(25, false)], stats)).toBe(175);
  });
});

describe('bestSingleRunElevation', () => {
  it('does not count the elevation of a treadmill run', () => {
    expect(bestSingleRunElevationEngine.calculate([run(100, false), run(300, true)], stats)).toBe(100);
  });

  it('gives 0 when the only run with elevation is a treadmill run', () => {
    expect(bestSingleRunElevationEngine.calculate([run(300, true)], stats)).toBe(0);
  });

  it('counts runs with is_treadmill null or missing as outdoors', () => {
    expect(bestSingleRunElevationEngine.calculate([run(100, null), run(150, undefined)], stats)).toBe(150);
  });
});
