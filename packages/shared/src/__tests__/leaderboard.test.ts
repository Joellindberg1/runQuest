import { describe, it, expect } from 'vitest';
import {
  buildWeekLeaderboard,
  bestWeekKm,
  percentOfBest,
  mondayOfCalendarDate,
  addDaysToCalendarDate,
  type WeekMember,
  type WeekRun,
} from '../leaderboard.js';

const WEEK = '2026-09-28'; // måndag
const PREV = '2026-09-21';

function member(id: string, name: string, extra: Partial<WeekMember> = {}): WeekMember {
  return { id, name, profile_picture: null, level: 3, created_date: '2026-01-01', ...extra };
}
function run(user_id: string, date: string, distance: number, xp_gained: number): WeekRun {
  return { user_id, date, distance, xp_gained };
}

describe('kalenderhjälpare (rena, tidszonsfria)', () => {
  it('mondayOfCalendarDate ger måndagen för alla veckodagar, söndag hör till veckan som slutar', () => {
    expect(mondayOfCalendarDate('2026-09-28')).toBe('2026-09-28'); // mån
    expect(mondayOfCalendarDate('2026-10-01')).toBe('2026-09-28'); // tors
    expect(mondayOfCalendarDate('2026-10-04')).toBe('2026-09-28'); // sön
    expect(mondayOfCalendarDate('2026-10-05')).toBe('2026-10-05'); // nästa mån
  });

  it('addDaysToCalendarDate hanterar sommartidsskiften och årsskiften', () => {
    expect(addDaysToCalendarDate('2026-03-28', 2)).toBe('2026-03-30'); // över DST-skiftet 29 mars
    expect(addDaysToCalendarDate('2026-10-24', 2)).toBe('2026-10-26'); // över DST-skiftet 25 okt
    expect(addDaysToCalendarDate('2025-12-29', 6)).toBe('2026-01-04');
    expect(addDaysToCalendarDate('2026-01-05', -7)).toBe('2025-12-29');
  });
});

describe('buildWeekLeaderboard', () => {
  it('bucketar dagstaplar måndag–söndag (7 st) med km, xp och antal per dag', () => {
    const runs = [
      run('a', '2026-09-28', 5, 30),   // mån
      run('a', '2026-09-28', 2.5, 20), // mån, andra rundan samma dag
      run('a', '2026-10-04', 10, 60),  // sön (sista dagen)
    ];
    const { users } = buildWeekLeaderboard([member('a', 'Anna')], runs, WEEK);
    const a = users[0];
    expect(a.days.map(d => d.date)).toEqual([
      '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
    ]);
    expect(a.days[0]).toEqual({ date: '2026-09-28', km: 7.5, xp: 50, runs: 2 });
    expect(a.days[1]).toEqual({ date: '2026-09-29', km: 0, xp: 0, runs: 0 });
    expect(a.days[6]).toEqual({ date: '2026-10-04', km: 10, xp: 60, runs: 1 });
    expect(a.km).toBe(17.5);
    expect(a.runs).toBe(3);
    expect(a.xp).toBe(110);
  });

  it('räknar söndagen före veckan som förra veckan, inte denna (gränsfall)', () => {
    const runs = [run('a', '2026-09-27', 8, 40), run('a', '2026-10-05', 8, 40)]; // sön före, mån efter
    const { users } = buildWeekLeaderboard([member('a', 'Anna')], runs, WEEK);
    expect(users[0].km).toBe(0);
    expect(users[0].runs).toBe(0);
  });

  it('avrundar flyttalssummor av km till 2 decimaler', () => {
    const runs = [run('a', WEEK, 0.1, 1), run('a', WEEK, 0.2, 1)];
    const { users } = buildWeekLeaderboard([member('a', 'Anna')], runs, WEEK);
    expect(users[0].km).toBe(0.3);
  });

  it('tar med medlemmar utan rundor och rankar dem (xp desc, km desc, namn asc)', () => {
    const members = [member('c', 'Cecilia'), member('b', 'Bertil'), member('a', 'Anna'), member('d', 'David')];
    const runs = [
      run('d', WEEK, 10, 100),
      run('b', WEEK, 5, 50),
      run('a', WEEK, 7, 50), // samma xp som Bertil, mer km -> före
    ];
    const { users } = buildWeekLeaderboard(members, runs, WEEK);
    expect(users.map(u => [u.name, u.rank])).toEqual([
      ['David', 1], ['Anna', 2], ['Bertil', 3], ['Cecilia', 4],
    ]);
  });

  it('bryter lika xp och km på namn (asc, skiftlägesokänsligt) och sedan id', () => {
    const members = [member('2', 'bertil'), member('1', 'Anna'), member('3', 'anna')];
    const { users } = buildWeekLeaderboard(members, [], WEEK);
    expect(users.map(u => u.user_id)).toEqual(['1', '3', '2']);
  });

  it('räknar previous_rank med samma regel för förra veckan och rank_delta = previous - rank', () => {
    const members = [member('a', 'Anna'), member('b', 'Bertil'), member('c', 'Cecilia')];
    const runs = [
      // förra veckan: Bertil 1, Anna 2, Cecilia 3
      run('b', PREV, 10, 90), run('a', PREV, 5, 50), run('c', PREV, 1, 10),
      // denna vecka: Cecilia 1, Anna 2, Bertil 3
      run('c', WEEK, 12, 120), run('a', WEEK, 5, 50), run('b', WEEK, 1, 10),
    ];
    const { users } = buildWeekLeaderboard(members, runs, WEEK);
    const by = Object.fromEntries(users.map(u => [u.name, u]));
    expect(by.Cecilia).toMatchObject({ rank: 1, previous_rank: 3, rank_delta: 2 });
    expect(by.Anna).toMatchObject({ rank: 2, previous_rank: 2, rank_delta: 0 });
    expect(by.Bertil).toMatchObject({ rank: 3, previous_rank: 1, rank_delta: -2 });
  });

  it('ger null previous_rank/rank_delta för användare skapade efter förra veckans start, och de räknas inte med i förra rankingen', () => {
    const members = [
      member('a', 'Anna'),
      member('n', 'Nyman', { created_date: '2026-09-23' }), // skapad under förra veckan (efter dess start)
    ];
    const runs = [run('a', PREV, 5, 50), run('n', PREV, 9, 90), run('n', WEEK, 9, 90)];
    const { users } = buildWeekLeaderboard(members, runs, WEEK);
    const by = Object.fromEntries(users.map(u => [u.name, u]));
    expect(by.Nyman.previous_rank).toBeNull();
    expect(by.Nyman.rank_delta).toBeNull();
    expect(by.Anna.previous_rank).toBe(1); // Nyman tränger inte undan Anna i förra rankingen
  });

  it('en användare skapad exakt på förra veckans start räknas som medlem då', () => {
    const members = [member('a', 'Anna', { created_date: PREV })];
    const { users } = buildWeekLeaderboard(members, [], WEEK);
    expect(users[0].previous_rank).toBe(1);
  });

  it('ignorerar rundor från användare som inte är medlemmar och rundor utanför de två veckorna', () => {
    const runs = [run('ghost', WEEK, 50, 500), run('a', '2026-08-01', 50, 500)];
    const { users, totals } = buildWeekLeaderboard([member('a', 'Anna')], runs, WEEK);
    expect(users[0].km).toBe(0);
    expect(totals).toEqual({ km: 0, runs: 0, xp: 0, active_runners: 0, members: 1 });
  });

  it('beräknar pack-totaler och aktiva löpare', () => {
    const members = [member('a', 'Anna'), member('b', 'Bertil'), member('c', 'Cecilia')];
    const runs = [run('a', WEEK, 5, 30), run('a', '2026-09-30', 5, 30), run('b', WEEK, 3, 20)];
    const { totals } = buildWeekLeaderboard(members, runs, WEEK);
    expect(totals).toEqual({ km: 13, runs: 3, xp: 80, active_runners: 2, members: 3 });
  });

  describe('mover', () => {
    const members = [member('a', 'Anna'), member('b', 'Bertil'), member('c', 'Cecilia')];

    it('är användaren med störst positivt rank_delta', () => {
      const runs = [
        run('a', PREV, 5, 50), run('b', PREV, 4, 40), run('c', PREV, 1, 10),
        run('c', WEEK, 12, 120), run('a', WEEK, 5, 50), run('b', WEEK, 4, 40),
      ];
      expect(buildWeekLeaderboard(members, runs, WEEK).mover).toEqual({ user_id: 'c', rank_delta: 2 });
    });

    it('bryter lika rank_delta på högst xp', () => {
      const four = [...members, member('d', 'David')];
      // förra: a1 b2 c3 d4 ; denna: c1 d2 a3 b4 -> c +2, d +2, a -2, b -2
      const runs = [
        run('a', PREV, 4, 40), run('b', PREV, 3, 30), run('c', PREV, 2, 20), run('d', PREV, 1, 10),
        run('c', WEEK, 9, 90), run('d', WEEK, 8, 80), run('a', WEEK, 7, 70), run('b', WEEK, 6, 60),
      ];
      expect(buildWeekLeaderboard(four, runs, WEEK).mover).toEqual({ user_id: 'c', rank_delta: 2 });
    });

    it('är null om ingen klättrat', () => {
      const runs = [run('a', PREV, 5, 50), run('a', WEEK, 5, 50)];
      expect(buildWeekLeaderboard(members, runs, WEEK).mover).toBeNull();
    });

    it('är null om förra veckan saknar rundor (ingen jämförelse finns)', () => {
      const runs = [run('c', WEEK, 12, 120)];
      expect(buildWeekLeaderboard(members, runs, WEEK).mover).toBeNull();
    });
  });

  it('ger 7 sammanhängande dagar även för veckan med sommartidsskifte och vid årsskifte', () => {
    for (const [start, last] of [['2026-03-23', '2026-03-29'], ['2026-10-19', '2026-10-25'], ['2025-12-29', '2026-01-04']]) {
      const { users } = buildWeekLeaderboard([member('a', 'Anna')], [], start);
      const dates = users[0].days.map(d => d.date);
      expect(dates).toHaveLength(7);
      expect(dates[0]).toBe(start);
      expect(dates[6]).toBe(last);
      for (let i = 1; i < 7; i++) expect(dates[i]).toBe(addDaysToCalendarDate(dates[i - 1], 1));
    }
  });

  it('tom medlemslista ger tomt resultat', () => {
    expect(buildWeekLeaderboard([], [run('a', WEEK, 5, 30)], WEEK)).toEqual({
      users: [],
      totals: { km: 0, runs: 0, xp: 0, active_runners: 0, members: 0 },
      mover: null,
    });
  });

  it('tål distance som sträng (numeric från databasen) och xp_gained null', () => {
    const { users } = buildWeekLeaderboard(
      [member('a', 'Anna')],
      [{ user_id: 'a', date: WEEK, distance: '5.25', xp_gained: null }],
      WEEK,
    );
    expect(users[0].km).toBe(5.25);
    expect(users[0].xp).toBe(0);
  });
});

describe('bestWeekKm / percentOfBest', () => {
  it('summerar km per Stockholm-vecka (mån–sön) över hela historiken och ger största veckan', () => {
    const runs = [
      { date: '2026-09-27', distance: 20 }, // sön, vecka 21 sep
      { date: '2026-09-21', distance: 5 },  // mån, vecka 21 sep -> 25 totalt
      { date: '2026-09-28', distance: 10 }, // vecka 28 sep
      { date: '2026-10-04', distance: 10 }, // sön, vecka 28 sep -> 20 totalt
    ];
    expect(bestWeekKm(runs)).toBe(25);
  });

  it('ger 0 för tom historik', () => {
    expect(bestWeekKm([])).toBe(0);
  });

  it('percentOfBest avrundar, klampar vid 100 och ger null om bästa veckan är 0', () => {
    expect(percentOfBest(12.5, 25)).toBe(50);
    expect(percentOfBest(30, 25)).toBe(100);
    expect(percentOfBest(0, 0)).toBeNull();
  });
});
