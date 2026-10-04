import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Run, User, UserTitle } from '@runquest/types';
import { getLevelFromXP, getXPForLevel } from '@/shared/services/levelService';
import { buildSeasonRows, displayedTitleNames, rankDeltaMap, titleLine } from './seasonModel';

const NOW = new Date('2026-10-04T10:00:00Z');

const run = (over: Partial<Run> & Pick<Run, 'date'>): Run => ({
  id: `r-${over.date}-${over.distance ?? 5}`, user_id: 'x', distance: 5, xp_gained: 100, multiplier: 1, streak_day: 1,
  base_xp: 15, km_xp: 10, distance_bonus: 5, streak_bonus: 0, ...over,
});

const user = (over: Partial<User> & Pick<User, 'id' | 'name' | 'total_xp'>): User => ({
  current_level: 1, total_km: 100, current_streak: 0, longest_streak: 0, runs: [], challenge_counts: {}, displayed_title_ids: [], ...over,
});

const title = (id: string, name: string, holder = true): UserTitle => ({
  title_id: id, title_name: name, title_description: '', position: 1, value: 0, earned_at: '', is_current_holder: holder, status: 'holder',
});

beforeEach(() => {
  // Bara Date — calculateUserStats läser `new Date()` för 14-dagarsfönstret.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

const input = { now: NOW, titlesByUser: {}, rankDeltaByUser: {} };

describe('buildSeasonRows', () => {
  it('rankar på nivå och XP, ger placering 1..n och döljer admin', () => {
    const rows = buildSeasonRows(
      [user({ id: 'b', name: 'Bea', total_xp: 900 }), user({ id: 'a', name: 'Adam', total_xp: 4000 }), user({ id: 'z', name: 'Admin', total_xp: 99999 })],
      input,
    );
    expect(rows.map((row) => [row.rank, row.name])).toEqual([[1, 'Adam'], [2, 'Bea']]);
  });

  it('nivåframsteg: xpInto/pct räknas mot nivåtabellen (levelService)', () => {
    const xp = 5243;
    const level = getLevelFromXP(xp);
    const from = getXPForLevel(level);
    const to = getXPForLevel(level + 1);
    const [row] = buildSeasonRows([user({ id: 'a', name: 'Adam', total_xp: xp })], input);

    expect(row.level).toBe(level);
    expect(row.progress.into.replace(/\s/g, '')).toBe(`${Math.round(xp - from)}/${Math.round(to - from)}XP`);
    expect(row.progress.pct).toBe(Math.round(((xp - from) / (to - from)) * 100));
    expect(row.progress.atMax).toBe(false);
  });

  it('maxnivå: full stapel och "Max level" i stället för xp-intervall', () => {
    const [row] = buildSeasonRows([user({ id: 'a', name: 'Adam', total_xp: 9_999_999 })], input);
    expect(row.progress).toEqual({ pct: 100, into: 'Max level', atMax: true });
    expect(row.nextLevelDays).toBeNull();
  });

  it('rank-delta → pilriktning: positivt ▲, negativt ▼, 0/saknas —', () => {
    const rows = buildSeasonRows(
      [user({ id: 'a', name: 'Adam', total_xp: 4000 }), user({ id: 'b', name: 'Bea', total_xp: 3000 }), user({ id: 'c', name: 'Cia', total_xp: 2000 }), user({ id: 'd', name: 'Dan', total_xp: 1000 })],
      { ...input, rankDeltaByUser: { a: 2, b: -1, c: 0 } },
    );
    expect(rows.map((row) => row.delta)).toEqual([
      { direction: 'up', places: 2, text: '▲ 2' },
      { direction: 'down', places: 1, text: '▼ 1' },
      { direction: 'flat', places: 0, text: '—' },
      { direction: 'flat', places: 0, text: '—' },
    ]);
  });

  it('senaste rundan: nyast start_time vinner samma dag; "X h ago · km"', () => {
    const runs = [
      run({ date: '2026-10-04', distance: 3, start_time: '2026-10-04T04:00:00Z' }),
      run({ date: '2026-10-04', distance: 8.4, start_time: '2026-10-04T05:00:00Z' }),
      run({ date: '2026-10-01', distance: 20 }),
    ];
    const [row] = buildSeasonRows([user({ id: 'a', name: 'Adam', total_xp: 4000, runs })], input);
    expect(row.lastRun).toEqual({ age: '5 h ago', km: '8.4' });
  });

  it('utan rundor: ingen senaste runda och noll i statistiken', () => {
    const [row] = buildSeasonRows([user({ id: 'a', name: 'Adam', total_xp: 4000 })], input);
    expect(row.lastRun).toBeNull();
    expect(row).toMatchObject({ runs: 0, longest: '0.0', avgPerRun: '0.0', nextLevelDays: null });
    expect(row.pace).toMatchObject({ perDay: 0, text: '0 / d', tone: 'down' });
  });

  it('xp-tempo (14 d) och nästa-nivå-prognos; tonen är relativ flockens snitt', () => {
    const fast = [run({ date: '2026-10-03', xp_gained: 280 }), run({ date: '2026-10-02', xp_gained: 280 })]; // 560/14 = 40
    const slow = [run({ date: '2026-10-03', xp_gained: 140 })]; // 140/14 = 10
    const rows = buildSeasonRows(
      [user({ id: 'a', name: 'Adam', total_xp: 4000, runs: fast }), user({ id: 'b', name: 'Bea', total_xp: 3000, runs: slow })],
      input,
    );
    expect(rows[0].pace).toEqual({ perDay: 40, text: '40 / d', tone: 'up' });
    expect(rows[1].pace).toEqual({ perDay: 10, text: '10 / d', tone: 'down' });
    const level = getLevelFromXP(4000);
    expect(rows[0].nextLevelDays).toBe(Math.ceil((Math.round((getXPForLevel(level + 1) - 4000) * 10) / 10) / 40));
  });

  it('challenge-ribbons = osända tokens per nivå, tokensLeft = summan', () => {
    const [row] = buildSeasonRows([user({ id: 'a', name: 'Adam', total_xp: 4000, challenge_counts: { minor: 3, major: 1 } })], input);
    expect(row.tokens).toEqual({ minor: 3, major: 1, legendary: 0 });
    expect(row.tokensLeft).toBe(4);
  });

  it('profilbild och initialer', () => {
    const [row] = buildSeasonRows([user({ id: 'a', name: 'Karl Persson', total_xp: 4000, profile_picture: 'https://x/k.png' })], input);
    expect(row.pictureUrl).toBe('https://x/k.png');
    expect(row.initials).toBe('KP');
  });
});

describe('titlar', () => {
  const titles = [title('t1', 'The Rooster'), title('t2', 'The Hamster'), title('t3', 'Lunch Breaker'), title('t4', 'The Batman'), title('t5', 'Old', false)];

  it('valda titlar i vald ordning, annars innehavda (max 3)', () => {
    const chosen = displayedTitleNames({ ...user({ id: 'a', name: 'A', total_xp: 1 }), displayed_title_ids: ['t3', 't1'] }, titles);
    expect(chosen).toEqual({ names: ['Lunch Breaker', 'The Rooster'], heldCount: 4 });

    const fallback = displayedTitleNames(user({ id: 'a', name: 'A', total_xp: 1 }), titles);
    expect(fallback.names).toEqual(['The Rooster', 'The Hamster', 'Lunch Breaker']);
  });

  it('titleLine: tomt, en, flera och för många', () => {
    expect(titleLine([], 0)).toBe('No titles held yet');
    expect(titleLine(['A'], 1)).toBe('A');
    expect(titleLine(['A', 'B', 'C'], 3)).toBe('A, B & C');
    expect(titleLine(['A', 'B', 'C'], 4)).toBe('A, B, C & The one with too many names to mention!');
  });

  it('buildSeasonRows bär titlarna in på raden', () => {
    const [row] = buildSeasonRows([user({ id: 'a', name: 'Adam', total_xp: 4000 })], { ...input, titlesByUser: { a: titles } });
    expect(row.titleNames).toEqual(['The Rooster', 'The Hamster', 'Lunch Breaker']);
    expect(row.heldTitleCount).toBe(4);
  });
});

describe('rankDeltaMap', () => {
  it('user_id → rank_delta, tom lista vid saknad data', () => {
    expect(rankDeltaMap([{ user_id: 'a', rank_delta: 2 }, { user_id: 'b', rank_delta: null }])).toEqual({ a: 2, b: null });
    expect(rankDeltaMap(undefined)).toEqual({});
  });
});
