/**
 * maxKmRolling30 — "förra kalendermånaden" räknas i Stockholm-tid, inte UTC.
 * Runt månadsskiftet ligger Stockholm och UTC i olika månader en timme om dygnet (två på sommartid).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { maxKmRolling30Engine } from '../maxKmRolling30.js';
import type { RunData } from '../types.js';

const run = (date: string, distance_km: number): RunData => ({ date, distance_km });
const stats = { totalKm: 0, longestStreak: 0 };

const RUNS = [run('2026-09-20', 7), run('2026-10-05', 10), run('2026-10-20', 5), run('2026-11-01', 3)];
const DEC_RUNS = [run('2026-11-10', 4), run('2026-12-10', 9)];

afterEach(() => {
  vi.useRealTimers();
});

const at = (iso: string) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
};

describe('maxKmRolling30 runt månadsskiftet', () => {
  it('2026-11-01 00:30 Stockholm (= 23:30 UTC den 31 okt) räknar oktober som förra månaden', () => {
    at('2026-10-31T23:30:00Z');
    // UTC-månaden (oktober) skulle ge september = 7.
    expect(maxKmRolling30Engine.calculate(RUNS, stats)).toBe(15);
  });

  it('2026-11-01 00:30 UTC (= 01:30 Stockholm) ger samma månad', () => {
    at('2026-11-01T00:30:00Z');
    expect(maxKmRolling30Engine.calculate(RUNS, stats)).toBe(15);
  });

  it('före skiftet i Stockholm (22:30 UTC den 31 okt = 23:30 Stockholm) är förra månaden fortfarande september', () => {
    at('2026-10-31T22:30:00Z');
    expect(maxKmRolling30Engine.calculate(RUNS, stats)).toBe(7);
  });

  it('nyår: 2027-01-01 00:30 Stockholm (= 23:30 UTC den 31 dec) räknar december 2026 som förra månaden', () => {
    at('2026-12-31T23:30:00Z');
    expect(maxKmRolling30Engine.calculate(DEC_RUNS, stats)).toBe(9);
  });

  it('januari räknar december föregående år', () => {
    at('2027-01-15T12:00:00Z');
    expect(maxKmRolling30Engine.calculate(DEC_RUNS, stats)).toBe(9);
  });

  it('ett injicerat ctx.now går före systemklockan', () => {
    at('2027-01-15T12:00:00Z');
    expect(maxKmRolling30Engine.calculate(RUNS, stats, { now: new Date('2026-10-31T23:30:00Z') })).toBe(15);
  });

  it('inga rundor ger 0', () => {
    expect(maxKmRolling30Engine.calculate([], stats)).toBe(0);
  });
});
