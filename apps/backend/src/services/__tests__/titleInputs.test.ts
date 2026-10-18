/**
 * titleInputs: vad titelmotorerna får för en medlem (ADR 012 beslut 1.3). Utan startdag (null) är indata exakt det de alltid varit:
 * alla rundor plus de lagrade totalerna users.total_km/longest_streak. Med en startdag räknas rundor, km och streak ur fönstret.
 */
import { describe, it, expect } from 'vitest';
import { titleWindow } from '@runquest/shared';
import { titleInputs } from '../titleInputs.js';

const run = (date: string, distance_km: number) => ({ date, distance_km });

const RUNS = [run('2026-09-01', 10), run('2026-09-02', 5), run('2026-09-03', 5), run('2026-09-10', 4.004), run('2026-09-11', 4.004)];

describe('titleInputs', () => {
  it('utan startdag: alla rundor oförändrade och de lagrade totalerna', () => {
    const result = titleInputs(RUNS, titleWindow({ starts_on: null }), { total_km: 28.01, longest_streak: 3 });
    expect(result.runs).toEqual(RUNS);
    expect(result.stats).toEqual({ totalKm: 28.01, longestStreak: 3 });
  });

  it('utan startdag och utan lagrade totaler (null) blir statistiken 0, som förut', () => {
    const result = titleInputs(RUNS, titleWindow({ starts_on: null }), { total_km: null, longest_streak: null });
    expect(result.stats).toEqual({ totalKm: 0, longestStreak: 0 });
  });

  it('med startdag: bara rundor från och med dagen, och km och streak räknas ur dem, inte ur de lagrade totalerna', () => {
    const result = titleInputs(RUNS, titleWindow({ starts_on: '2026-09-03' }), { total_km: 28.01, longest_streak: 3 });
    expect(result.runs.map((r) => r.date)).toEqual(['2026-09-03', '2026-09-10', '2026-09-11']);
    expect(result.stats.totalKm).toBe(13.01); // 5 + 4.004 + 4.004 = 13.008 avrundat till numeric(8,2)
    expect(result.stats.longestStreak).toBe(2); // 10:e och 11:e (den 3:e står ensam)
  });

  it('en streak som korsar startdagen räknas bara från startdagen', () => {
    const result = titleInputs(RUNS, titleWindow({ starts_on: '2026-09-02' }), { total_km: 0, longest_streak: 3 });
    expect(result.stats.longestStreak).toBe(2); // 2:a och 3:e, inte 1:a-3:e
  });

  it('flera rundor samma dag ger en streakdag men räknas alla i km', () => {
    const result = titleInputs([run('2026-09-05', 3), run('2026-09-05', 4), run('2026-09-06', 1)], titleWindow({ starts_on: '2026-09-05' }), { total_km: 99, longest_streak: 99 });
    expect(result.stats).toEqual({ totalKm: 8, longestStreak: 2 });
  });

  it('distance_km som sträng (PostgREST-numeric) räknas som tal', () => {
    const result = titleInputs([{ date: '2026-09-05', distance_km: '2.5' }], titleWindow({ starts_on: '2026-09-01' }), { total_km: 0, longest_streak: 0 });
    expect(result.stats.totalKm).toBe(2.5);
  });

  it('inga rundor i fönstret ger noll, inte de lagrade totalerna', () => {
    const result = titleInputs(RUNS, titleWindow({ starts_on: '2026-12-01' }), { total_km: 28.01, longest_streak: 3 });
    expect(result.runs).toEqual([]);
    expect(result.stats).toEqual({ totalKm: 0, longestStreak: 0 });
  });

  it('en runda med ogiltigt datum i ett fönster med startdag kastar (tappas inte tyst)', () => {
    expect(() => titleInputs([run('inte-ett-datum', 1)], titleWindow({ starts_on: '2026-09-01' }), { total_km: 0, longest_streak: 0 })).toThrow(RangeError);
  });
});
