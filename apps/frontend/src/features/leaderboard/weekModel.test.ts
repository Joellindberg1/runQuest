import { describe, expect, it } from 'vitest';
import type { WeekDay, WeekLeaderboardResponse, WeekLeaderboardUser } from '@runquest/shared';
import { barLevel, buildDayBars, buildMover, buildPackTotal, buildWeekRows, longestDayKm } from './weekModel';

const WEEK_DATES = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'];
const days = (kms: number[]): WeekDay[] =>
  kms.map((km, i) => ({ date: WEEK_DATES[i], km, xp: km * 10, runs: km > 0 ? 1 : 0 }));

const user = (id: string, kms: number[], over: Partial<WeekLeaderboardUser> = {}): WeekLeaderboardUser => ({
  user_id: id, name: id.toUpperCase(), profile_picture: null, level: 5,
  km: kms.reduce((a, b) => a + b, 0), runs: kms.filter((k) => k > 0).length, xp: 100, days: days(kms),
  rank: 1, previous_rank: 1, rank_delta: 0, ...over,
});

describe('veckostaplarnas höjdskala', () => {
  it('längsta dagen i hela flocken = 100 %, övriga proportionellt (samma skala på alla rader)', () => {
    const users = [user('a', [0, 10, 0, 5, 0, 0, 2.5]), user('b', [20, 0, 0, 0, 0, 0, 0])];
    expect(longestDayKm(users)).toBe(20);

    const [a, b] = buildWeekRows(users);
    expect(a.bars.map((bar) => bar.heightPct)).toEqual([0, 50, 0, 25, 0, 0, 13]);
    expect(b.bars[0].heightPct).toBe(100);
  });

  it('en dag utan löpning är exakt 0 (tom), en mycket kort dag får minst 1 % så den syns', () => {
    const bars = buildDayBars(days([0, 0.01, 0, 0, 0, 0, 100]), 100);
    expect(bars[0].heightPct).toBe(0);
    expect(bars[1].heightPct).toBe(1);
    expect(bars[6].heightPct).toBe(100);
  });

  it('veckan utan en enda runda ger bara tomma staplar (ingen division med noll)', () => {
    const bars = buildDayBars(days([0, 0, 0, 0, 0, 0, 0]), 0);
    expect(bars.every((bar) => bar.heightPct === 0 && bar.level === 0)).toBe(true);
  });

  it('värmenivåerna stiger med höjden', () => {
    expect([0, 1, 33, 34, 66, 67, 100].map(barLevel)).toEqual([0, 1, 1, 2, 2, 3, 3]);
  });

  it('sju staplar mån–sön med bokstäver', () => {
    const [row] = buildWeekRows([user('a', [1, 2, 3, 4, 5, 6, 7])]);
    expect(row.bars.map((bar) => bar.label).join('')).toBe('MTWTFSS');
  });
});

describe('veckorader', () => {
  it('form-pil från rank_delta, km/runs/xp formateras', () => {
    const rows = buildWeekRows([
      user('a', [38.2], { rank: 1, rank_delta: 5, xp: 1214 }),
      user('b', [10], { rank: 2, rank_delta: -2 }),
      user('c', [0], { rank: 3, rank_delta: null, runs: 0 }),
    ]);
    expect(rows[0]).toMatchObject({ rank: 1, km: '38.2', runsText: '1 run' });
    expect(rows[0].xp.replace(/\s/g, ' ')).toBe('1 214');
    expect(rows.map((r) => r.form.text)).toEqual(['▲ 5', '▼ 2', '—']);
    expect(rows[2].runsText).toBe('0 runs');
  });
});

describe('mover och pack-total', () => {
  const week = (over: Partial<WeekLeaderboardResponse> = {}): WeekLeaderboardResponse => ({
    week: { start: '2026-09-28', end: '2026-10-04', previous_start: '2026-09-21', is_current: true, today: '2026-10-02' },
    users: [user('a', [10, 5], { rank: 1, rank_delta: 3, runs: 2, km: 15 })],
    totals: { km: 148.6, runs: 21, xp: 900, active_runners: 5, members: 6, best_week_km: 180, pct_of_best_week: 82 },
    mover: { user_id: 'a', rank_delta: 3 },
    ...over,
  });

  it('mover: namn och en mening ur veckans siffror', () => {
    expect(buildMover(week())).toEqual({ id: 'a', name: 'A', places: 3, summary: 'Up 3 places on last week — 2 runs and 15.0 km so far.' });
  });

  it('mover saknas → null (kortet visas inte)', () => {
    expect(buildMover(week({ mover: null }))).toBeNull();
    expect(buildMover(week({ mover: { user_id: 'finns-inte', rank_delta: 1 } }))).toBeNull();
  });

  it('pack-total: km, runs, aktiva av N, % av bästa vecka', () => {
    expect(buildPackTotal(week().totals)).toEqual({
      km: '148.6 km', summary: '21 runs · 5 of 6 runners active', pctOfBest: 82, pctText: '82% of your best week',
    });
  });

  it('pack-total utan bästa vecka: ingen procent', () => {
    const total = buildPackTotal({ ...week().totals, best_week_km: 0, pct_of_best_week: null });
    expect(total.pctOfBest).toBeNull();
    expect(total.pctText).toBe('No best week to compare with yet');
  });
});
