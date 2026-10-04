import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Run, User, UserTitle } from '@runquest/types';
import type { ChallengeHistoryItem, HeadToHeadResponse } from '@runquest/shared';
import type { TitleLeaderboard } from '@/shared/services/backendApi';
import { getLevelFromXP, getXPForLevel } from '@/shared/services/levelService';
import {
  DOUBLE_RUN_MIN_GAP_MS, buildDistanceRows, buildFunRows, buildHeadToHead, buildHero, buildMeeting, buildStatCells,
  buildStreakRows, buildTitleRows, countDoubleRunDays, favouriteWeekday, marathonEquivalents, nextTier, titleValueText,
  xpToNextText,
} from './runnerModel';

// Fast klocka: söndag 2026-10-04 12:00 Stockholm (CEST) = 10:00 UTC.
const NOW = new Date('2026-10-04T10:00:00Z');

const run = (over: Partial<Run> & Pick<Run, 'date'>): Run => ({
  id: `r-${over.date}-${over.distance ?? 5}-${over.start_time ?? ''}`, user_id: 'x', distance: 5, xp_gained: 100, multiplier: 1,
  streak_day: 1, base_xp: 15, km_xp: 10, distance_bonus: 5, streak_bonus: 0, ...over,
});

const user = (over: Partial<User> & Pick<User, 'id' | 'name' | 'total_xp'>): User => ({
  current_level: 1, total_km: 100, current_streak: 0, longest_streak: 0, runs: [], challenge_counts: {},
  displayed_title_ids: [], wins: 0, draws: 0, losses: 0, ...over,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('buildHero', () => {
  const karl = user({ id: 'k', name: 'Karl Persson', total_xp: 5539, runs: [run({ date: '2026-10-01' }), run({ date: '2026-10-02' })] });
  const joel = user({ id: 'j', name: 'Joel Lindberg', total_xp: 5243 });
  const admin = user({ id: 'a', name: 'Admin', total_xp: 99999 });

  it('nivå, ring (andel av nivån), rank i gruppen och antal rundor', () => {
    const level = getLevelFromXP(5539);
    const from = getXPForLevel(level);
    const to = getXPForLevel(level + 1);
    const hero = buildHero(karl, [joel, karl, admin]);

    expect(hero).toMatchObject({ id: 'k', name: 'Karl Persson', level, rank: 1, runs: 2, nextLevel: level + 1 });
    expect(hero.ringTurn).toBeCloseTo(Math.round(((5539 - from) / (to - from)) * 100) / 100, 5);
    expect(hero.xpToNext).toBeCloseTo(to - 5539, 5);
    expect(buildHero(joel, [joel, karl]).rank).toBe(2);
  });

  it('text: "N XP to level M" — designens rad', () => {
    const hero = buildHero(karl, [karl]);
    expect(xpToNextText(hero)).toBe(`${Math.round(hero.xpToNext!).toLocaleString('sv-SE')} XP to level ${hero.nextLevel}`);
  });

  it('maxnivå: full ring, ingen nästa nivå', () => {
    const maxed = user({ id: 'm', name: 'Max', total_xp: 9_999_999 });
    const hero = buildHero(maxed, [maxed]);
    expect(hero).toMatchObject({ ringTurn: 1, xpToNext: null, nextLevel: null });
    expect(xpToNextText(hero)).toBe('Max level reached');
  });

  it('en löpare som inte finns i listan (eller admin) får ingen rank i stället för en påhittad', () => {
    expect(buildHero(karl, []).rank).toBeNull();
    expect(buildHero(admin, [admin, karl]).rank).toBeNull();
  });

});

describe('buildStatCells', () => {
  const karl = user({ id: 'k', name: 'Karl', total_xp: 5539, total_km: 988.4, wins: 0, losses: 2, runs: [run({ date: '2026-10-01' })] });

  it('total xp · total km · challenges W–L, i designens form', () => {
    const [xp, km, challenges] = buildStatCells(karl, 4);
    expect(xp).toMatchObject({ key: 'xp', label: 'total xp', tone: 'gold', wideOnly: false });
    expect(xp.value.replace(/\s/g, '')).toBe('5539');
    expect(km).toMatchObject({ value: '988.4', label: 'total km', tone: 'default' });
    expect(challenges).toMatchObject({ value: '0–2', label: 'challenges', tone: 'down' });
  });

  it('challenges är grön vid vunnen eller jämn balans, röd när förlusterna leder', () => {
    expect(buildStatCells({ ...karl, wins: 11, losses: 6 }, 0)[2].tone).toBe('up');
    expect(buildStatCells({ ...karl, wins: 0, losses: 0 }, 0)[2].tone).toBe('up');
    expect(buildStatCells({ ...karl, wins: 1, losses: 2 }, 0)[2].tone).toBe('down');
  });

  it('rundor och titlar är bara för den breda varianten; okända titlar visas som —', () => {
    const cells = buildStatCells(karl, null);
    expect(cells.filter((cell) => cell.wideOnly).map((cell) => [cell.key, cell.value])).toEqual([['runs', '1'], ['titles', '—']]);
    expect(buildStatCells(karl, 4)[4].value).toBe('4');
  });
});

describe('buildDistanceRows', () => {
  const runs = [
    run({ date: '2026-10-03', distance: 10 }),
    run({ date: '2026-10-01', distance: 4.5 }),
    run({ date: '2026-09-30', distance: 32.8 }),
    run({ date: '2025-10-02', distance: 6 }),
  ];
  const karl = user({ id: 'k', name: 'Karl', total_xp: 1000, total_km: 53.3, runs });

  it('longest (2 dec), total, snitt per runda och denna månad (Stockholm-månad)', () => {
    expect(buildDistanceRows(karl, NOW)).toEqual([
      { label: 'Longest run', value: '32.80 km', tone: 'default' },
      { label: 'Total', value: '53.3 km', tone: 'default' },
      { label: 'Average per run', value: '13.3 km', tone: 'default' },
      { label: 'This month', value: '14.5 km', tone: 'gold' },
    ]);
  });

  it('månadsskiftet går efter Stockholm-tid: 23:30 UTC den 30 sep är redan 1 okt lokalt', () => {
    const lateNight = new Date('2026-09-30T23:30:00Z');
    const [, , , month] = buildDistanceRows(karl, lateNight);
    expect(month.value).toBe('14.5 km');
  });

  it('inga rundor → nollor, inga NaN', () => {
    const rows = buildDistanceRows(user({ id: 'n', name: 'Ny', total_xp: 0, total_km: 0 }), NOW);
    expect(rows.map((row) => row.value)).toEqual(['0.00 km', '0.0 km', '0.0 km', '0.0 km']);
  });
});

describe('streak: nästa steg och rader', () => {
  const ladder = [{ days: 14, multiplier: 1.8 }, { days: 3, multiplier: 1.3 }, { days: 7, multiplier: 1.5 }];

  it('nextTier: närmaste steg över nuvarande streak, oavsett trappans ordning; null på toppen', () => {
    expect(nextTier(0, ladder)).toEqual({ days: 3, multiplier: 1.3 });
    expect(nextTier(3, ladder)).toEqual({ days: 7, multiplier: 1.5 });
    expect(nextTier(8, ladder)).toEqual({ days: 14, multiplier: 1.8 });
    expect(nextTier(14, ladder)).toBeNull();
    expect(nextTier(5, [])).toBeNull();
  });

  const alive = user({
    id: 'k', name: 'Karl', total_xp: 100, current_streak: 8, longest_streak: 31, runs: [run({ date: '2026-10-04' })],
  });

  it('Current / Best / Multiplier / Next tier at — multiplikatorn ur trappan, inte ur konstanter', () => {
    expect(buildStreakRows(alive, NOW, ladder)).toEqual([
      { label: 'Current', value: '8 days', tone: 'default' },
      { label: 'Best', value: '31 days', tone: 'default' },
      { label: 'Multiplier', value: '1.5×', tone: 'gold' },
      { label: 'Next tier at', value: '14 days · 1.8×', tone: 'muted' },
    ]);
  });

  it('en bruten streak (senaste rundan för två dagar sedan) visas som 0 dagar och 1.0×', () => {
    const broken = { ...alive, runs: [run({ date: '2026-10-02' })] };
    const rows = buildStreakRows(broken, NOW, ladder);
    expect(rows[0].value).toBe('0 days');
    expect(rows[2].value).toBe('1.0×');
    expect(rows[3].value).toBe('3 days · 1.3×');
    // Bästa streaken påverkas inte av att den nuvarande brutits.
    expect(rows[1].value).toBe('31 days');
  });

  it('på toppen av trappan: "Top tier reached"', () => {
    const top = { ...alive, current_streak: 20 };
    expect(buildStreakRows(top, NOW, ladder)[3]).toEqual({ label: 'Next tier at', value: 'Top tier reached', tone: 'muted' });
  });

  it('singular: "1 day"', () => {
    const one = { ...alive, current_streak: 1, longest_streak: 1 };
    const rows = buildStreakRows(one, NOW, ladder);
    expect([rows[0].value, rows[1].value]).toEqual(['1 day', '1 day']);
  });
});

describe('fun facts', () => {
  it('marathon-ekvivalenter: hela maror (golvat), 42.195 km', () => {
    expect(marathonEquivalents(988.4)).toBe(23);
    expect(marathonEquivalents(42.194)).toBe(0);
    expect(marathonEquivalents(42.195)).toBe(1);
    expect(marathonEquivalents(0)).toBe(0);
  });

  describe('countDoubleRunDays (4 h-regeln)', () => {
    const at = (date: string, time: string) => run({ date, start_time: `${date}T${time}:00Z` });

    it('två rundor ≥ 4 h isär samma dag = ett dubbelpass-dygn', () => {
      expect(countDoubleRunDays([at('2026-10-01', '06:00'), at('2026-10-01', '10:00')])).toBe(1);
    });

    it('gränsen är inklusive: exakt 4 h räknas, 3 h 59 min räknas inte', () => {
      expect(DOUBLE_RUN_MIN_GAP_MS).toBe(4 * 3600 * 1000);
      expect(countDoubleRunDays([at('2026-10-01', '06:00'), at('2026-10-01', '10:00')])).toBe(1);
      expect(countDoubleRunDays([at('2026-10-01', '06:00'), at('2026-10-01', '09:59')])).toBe(0);
    });

    it('tre pass samma dag är fortfarande EN dag; olika dagar räknas var för sig', () => {
      const runs = [
        at('2026-10-01', '05:00'), at('2026-10-01', '09:30'), at('2026-10-01', '18:00'),
        at('2026-10-02', '06:00'), at('2026-10-02', '12:00'),
        at('2026-10-03', '06:00'),
      ];
      expect(countDoubleRunDays(runs)).toBe(2);
    });

    it('rundor utan starttid (manuell loggning) kan inte bevisa 4 h och räknas inte', () => {
      expect(countDoubleRunDays([run({ date: '2026-10-01' }), run({ date: '2026-10-01', distance: 8 })])).toBe(0);
      expect(countDoubleRunDays([at('2026-10-01', '06:00'), run({ date: '2026-10-01', distance: 8 })])).toBe(0);
    });

    it('en runda ensam på en dag, tom lista och ogiltig starttid ger 0', () => {
      expect(countDoubleRunDays([])).toBe(0);
      expect(countDoubleRunDays([at('2026-10-01', '06:00')])).toBe(0);
      expect(countDoubleRunDays([run({ date: '2026-10-01', start_time: 'inte-ett-datum' }), at('2026-10-01', '10:00')])).toBe(0);
    });
  });

  describe('favouriteWeekday', () => {
    // 2026-10-04 är en söndag, 2026-10-03 lördag, 2026-10-05 måndag.
    it('veckodagen med flest rundor, med engelskt dagnamn', () => {
      const runs = [run({ date: '2026-10-04' }), run({ date: '2026-09-27' }), run({ date: '2026-10-03' })];
      expect(favouriteWeekday(runs)).toBe('Sunday');
    });

    it('lika många rundor → mest km vinner', () => {
      const runs = [run({ date: '2026-10-03', distance: 5 }), run({ date: '2026-10-04', distance: 12 })];
      expect(favouriteWeekday(runs)).toBe('Sunday');
    });

    it('helt lika → tidigast i veckan (måndag före söndag)', () => {
      const runs = [run({ date: '2026-10-04', distance: 5 }), run({ date: '2026-10-05', distance: 5 })];
      expect(favouriteWeekday(runs)).toBe('Monday');
    });

    it('datum med klockslag tolkas som kalenderdagen, och inga rundor ger null', () => {
      expect(favouriteWeekday([run({ date: '2026-10-04T23:30:00Z' })])).toBe('Sunday');
      expect(favouriteWeekday([])).toBeNull();
    });
  });

  it('buildFunRows: marathon total + i år (kalenderår, Stockholm), dubbelpass och favoritdag', () => {
    const runs = [
      run({ date: '2026-10-04', distance: 30, start_time: '2026-10-04T05:00:00Z' }),
      run({ date: '2026-10-04', distance: 60, start_time: '2026-10-04T10:00:00Z' }),
      run({ date: '2025-10-04', distance: 90 }),
    ];
    const rows = buildFunRows(user({ id: 'k', name: 'Karl', total_xp: 1, total_km: 180, runs }), NOW);
    expect(rows).toEqual([
      { label: 'Marathon equivalents total', value: '4', tone: 'default' },
      { label: 'Marathon equivalents 2026', value: '2', tone: 'default' },
      { label: 'Double-run days', value: '1', tone: 'gold' },
      { label: 'Favourite day to run', value: 'Sunday', tone: 'gold' },
    ]);
  });

  it('inga rundor: nollor och — (inga undefined)', () => {
    const rows = buildFunRows(user({ id: 'n', name: 'Ny', total_xp: 0, total_km: 0 }), NOW);
    expect(rows.map((row) => row.value)).toEqual(['0', '0', '0', '—']);
  });
});

describe('titlar', () => {
  const ut = (over: Partial<UserTitle> & Pick<UserTitle, 'title_id' | 'title_name'>): UserTitle => ({
    title_description: '', position: 1, value: 0, earned_at: '', is_current_holder: true, status: 'holder', ...over,
  });
  const entry = (id: string, metric: string | undefined, holder?: { name: string; value: number }): TitleLeaderboard => ({
    id, name: id, description: '', unlock_requirement: 0, metric_key: metric,
    holder: holder ? { user_id: 'h', user_name: holder.name, value: holder.value, earned_at: '' } : null,
    runners_up: [],
  });

  const board = [
    entry('t-rooster', 'earlyRunCount', { name: 'Karl', value: 56 }),
    entry('t-long', 'longestRun', { name: 'Karl', value: 32.8 }),
    entry('t-double', 'bestDoubleDayKm', { name: 'Karl', value: 14 }),
    entry('t-fast', 'fastest5km', { name: 'Adam', value: 40 }),
    entry('t-nokey', undefined, { name: 'Adam', value: 7 }),
  ];

  it('titleValueText: enhet per mått, mellanslag före km, och bara talet när måttet är okänt', () => {
    expect(titleValueText('earlyRunCount', 56)).toBe('56 runs');
    expect(titleValueText('longestStreak', 14)).toBe('14 days');
    expect(titleValueText('longestRun', 32.8)).toBe('32.8 km');
    expect(titleValueText('totalElevationGain', 180)).toBe('180m');
    expect(titleValueText(undefined, 7.4)).toBe('7');
  });

  it('innehavda titlar (position 1) med värde i rätt enhet, i den ordning backend ger dem', () => {
    const rows = buildTitleRows(
      [ut({ title_id: 't-rooster', title_name: 'The Rooster', value: 56 }), ut({ title_id: 't-long', title_name: 'The Longest Run', value: 32.8 })],
      board,
      null,
    );
    expect(rows.held).toEqual([
      { id: 't-rooster', name: 'The Rooster', value: '56 runs' },
      { id: 't-long', name: 'The Longest Run', value: '32.8 km' },
    ]);
    expect(rows.runnersUp).toEqual([]);
  });

  it('runner-up: bara position 2–3, sorterade, med innehavare och differens', () => {
    const rows = buildTitleRows(
      [
        ut({ title_id: 't-rooster', title_name: 'The Rooster', value: 51, position: 3, is_current_holder: false, status: 'runner_up' }),
        ut({ title_id: 't-long', title_name: 'The Longest Run', value: 28.3, position: 2, is_current_holder: false, status: 'runner_up' }),
        ut({ title_id: 't-nokey', title_name: 'The Ten', value: 3, position: 4, is_current_holder: false, status: 'top_10' }),
        ut({ title_id: 't-nopos', title_name: 'The Participant', value: 1, position: null as unknown as number, is_current_holder: false, status: 'participant' as UserTitle['status'] }),
      ],
      board,
      null,
    );
    expect(rows.held).toEqual([]);
    expect(rows.runnersUp).toEqual([
      { id: 't-long', name: 'The Longest Run', position: 2, holder: 'Karl', gap: '4.5 km', value: '28.3 km' },
      { id: 't-rooster', name: 'The Rooster', position: 3, holder: 'Karl', gap: '5 runs', value: '51 runs' },
    ]);
  });

  it('differens utelämnas för kodade mått (tider) och när innehavaren eller måttet saknas', () => {
    const rows = buildTitleRows(
      [
        ut({ title_id: 't-fast', title_name: 'The Kipchoge', value: 38, position: 2, is_current_holder: false }),
        ut({ title_id: 't-unknown', title_name: 'The Ghost', value: 3, position: 2, is_current_holder: false }),
      ],
      board,
      null,
    );
    expect(rows.runnersUp[0]).toMatchObject({ name: 'The Kipchoge', holder: 'Adam', gap: null });
    expect(rows.runnersUp[1]).toMatchObject({ name: 'The Ghost', holder: null, gap: null, value: '3' });
  });

  it('en löpare som är före innehavaren i data (race mellan uppdateringar) ger differens 0, aldrig negativ', () => {
    const rows = buildTitleRows(
      [ut({ title_id: 't-long', title_name: 'The Longest Run', value: 40, position: 2, is_current_holder: false })],
      board,
      null,
    );
    expect(rows.runnersUp[0].gap).toBe('0.0 km');
  });

  it('King/Queen följer löparens kön', () => {
    const titles = [ut({ title_id: 't-k', title_name: 'The Consistent King/Queen', value: 21 })];
    expect(buildTitleRows(titles, [], 'female').held[0].name).toBe('The Consistent Queen');
    expect(buildTitleRows(titles, [], 'male').held[0].name).toBe('The Consistent King');
    expect(buildTitleRows(titles, [], null).held[0].name).toBe('The Consistent King/Queen');
  });
});

describe('head to head', () => {
  const ME = 'u-me';
  const party = (id: string, name: string) => ({ id, name, profile_picture: null, level: 20 });
  const boost = { type: 'multiplier_days', delta: 0.2, duration: 4 };
  const item = (over: Partial<ChallengeHistoryItem>): ChallengeHistoryItem => ({
    id: 'c1', tier: 'minor', metric: 'km', duration_days: 7, start_date: '2026-09-20', end_date: '2026-09-27', ended_at: '2026-09-27T21:00:00Z',
    outcome: 'challenger_wins', winner_id: ME, challenger: party(ME, 'Joel'), opponent: party('u-karl', 'Karl'),
    challenger_value: 42.1, opponent_value: 37, winner_boost: boost, loser_boost: boost, ...over,
  });

  describe('buildMeeting (perspektivet är den inloggades)', () => {
    it('jag utmanade och vann', () => {
      expect(buildMeeting(item({}), ME)).toEqual({
        id: 'c1', result: 'won', resultLabel: 'Won', what: 'Most km · 7 days', score: '42.1 km – 37.0 km', date: '27 Sep',
      });
    });

    it('jag blev utmanad och förlorade: värdena byter plats så att mitt står först', () => {
      const m = buildMeeting(
        item({ challenger: party('u-karl', 'Karl'), opponent: party(ME, 'Joel'), outcome: 'challenger_wins', winner_id: 'u-karl', challenger_value: 50, opponent_value: 31 }),
        ME,
      );
      expect(m).toMatchObject({ result: 'lost', resultLabel: 'Lost', score: '31.0 km – 50.0 km' });
    });

    it('jag blev utmanad och vann (opponent_wins)', () => {
      const m = buildMeeting(item({ challenger: party('u-karl', 'Karl'), opponent: party(ME, 'Joel'), outcome: 'opponent_wins' }), ME);
      expect(m.result).toBe('won');
    });

    it('jag utmanade och förlorade (opponent_wins)', () => {
      expect(buildMeeting(item({ outcome: 'opponent_wins', winner_id: 'u-karl' }), ME).result).toBe('lost');
    });

    it('oavgjort', () => {
      expect(buildMeeting(item({ outcome: 'draw', winner_id: null, challenger_value: 10, opponent_value: 10 }), ME)).toMatchObject({ result: 'draw', resultLabel: 'Draw' });
    });

    it('mått och enheter: runs (singular/plural), XP med tusentalsmellanrum, saknat värde som —', () => {
      expect(buildMeeting(item({ metric: 'runs', duration_days: 1, challenger_value: 1, opponent_value: 5 }), ME)).toMatchObject({
        what: 'Most runs · 1 day', score: '1 run – 5 runs',
      });
      const xp = buildMeeting(item({ metric: 'total_xp', challenger_value: 1234, opponent_value: null }), ME);
      expect(xp.what).toBe('Most XP · 7 days');
      expect(xp.score.replace(/\s/g, '')).toBe('1234XP–—');
    });

    it('avslutstid saknas → inget datum', () => {
      expect(buildMeeting(item({ ended_at: null }), ME).date).toBeNull();
    });

    it('datum visas i Stockholm-tid: 23:30 UTC är redan nästa dag lokalt', () => {
      expect(buildMeeting(item({ ended_at: '2026-10-03T23:30:00Z' }), ME).date).toBe('4 Oct');
    });
  });

  describe('buildHeadToHead', () => {
    const response = (over: Partial<HeadToHeadResponse> = {}): HeadToHeadResponse => ({
      opponent: { id: 'u-karl', name: 'Karl', profile_picture: null },
      record: { wins: 2, draws: 0, losses: 1, total: 3 },
      history: [item({ id: 'a' }), item({ id: 'b', outcome: 'opponent_wins', winner_id: 'u-karl' })],
      active: null,
      ...over,
    });

    it('rekordet som tre celler i designens ordning och ton: you won (grön) · drawn · you lost (röd)', () => {
      const view = buildHeadToHead(response(), ME);
      expect(view.cells).toEqual([
        { key: 'won', value: 2, label: 'you won', tone: 'up' },
        { key: 'drawn', value: 0, label: 'drawn', tone: 'muted' },
        { key: 'lost', value: 1, label: 'you lost', tone: 'down' },
      ]);
      expect(view.total).toBe(3);
    });

    it('senaste mötena behåller backends ordning (nyast först)', () => {
      expect(buildHeadToHead(response(), ME).meetings.map((m) => [m.id, m.result])).toEqual([['a', 'won'], ['b', 'lost']]);
    });

    it('active: pending/active vidareförs, ingen aktiv → null', () => {
      expect(buildHeadToHead(response(), ME).active).toBeNull();
      expect(buildHeadToHead(response({ active: { id: 'x', status: 'pending', challenger_id: ME } }), ME).active).toBe('pending');
      expect(buildHeadToHead(response({ active: { id: 'x', status: 'active', challenger_id: 'u-karl' } }), ME).active).toBe('active');
    });

    it('inga möten ännu: nollor och tom lista', () => {
      const view = buildHeadToHead(response({ record: { wins: 0, draws: 0, losses: 0, total: 0 }, history: [] }), ME);
      expect(view.cells.map((cell) => cell.value)).toEqual([0, 0, 0]);
      expect(view.meetings).toEqual([]);
    });
  });
});
