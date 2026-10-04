import { describe, expect, it } from 'vitest';
import { HEAT_MONTHS_DESKTOP, HEAT_MONTHS_MOBILE, buildHeatStats, buildHeatmap, heatLevel } from './heatmapModel';
import { run, user } from './profile.fixture';

// Idag = söndag 2026-10-04 (Stockholm). Oktobers första måndag, 5/10, ligger efter idag.
const TODAY = '2026-10-04';
const NOW = new Date('2026-10-04T10:00:00Z');

const cellsOf = (heat: ReturnType<typeof buildHeatmap>) => heat.months.flatMap((month) => month.weeks).flatMap((week) => week.cells);

describe('heatLevel — dagens km → intensitet', () => {
  it.each([
    [0, 0], [0.4, 1], [4.9, 1], [5, 2], [9.9, 2], [10, 3], [14.9, 3], [15, 4], [32.8, 4],
  ])('%s km → nivå %s', (km, level) => {
    expect(heatLevel(km)).toBe(level);
  });
});

describe('buildHeatmap — fönstret', () => {
  it('12 månader (desktop) och 6 (mobil), äldst först; månaden där idag ligger är markerad', () => {
    // 4 okt: oktobers första måndag (5/10) har inte hänt, så oktober har inga veckor — 1–4 okt ligger i september-blocket.
    const wide = buildHeatmap([], TODAY, HEAT_MONTHS_DESKTOP);
    expect(wide.months.map((month) => month.key)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
    expect(wide.months.map((month) => month.label).slice(-3)).toEqual(['Jul', 'Aug', 'Sep']);
    expect(wide.months.filter((month) => month.current).map((month) => month.key)).toEqual(['2026-09']);

    const narrow = buildHeatmap([], TODAY, HEAT_MONTHS_MOBILE);
    expect(narrow.months.map((month) => month.key)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);

    // 11 okt: nu har oktober en vecka och blir innevarande block.
    const later = buildHeatmap([], '2026-10-11', 3);
    expect(later.months.filter((month) => month.current).map((month) => month.key)).toEqual(['2026-10']);
  });

  it('en vecka tillhör månaden där dess måndag ligger: 4 eller 5 veckor per månad', () => {
    const heat = buildHeatmap([], TODAY, 3);
    // Aug 2026 har fem måndagar (3, 10, 17, 24, 31), sep fyra (7, 14, 21, 28), och okt ingen före idag (ritas inte).
    expect(heat.months.map((month) => [month.key, month.weeks.length])).toEqual([['2026-08', 5], ['2026-09', 4]]);
  });

  it('veckor är mån–sön och datumen löper obrutet över månadsgränserna', () => {
    const heat = buildHeatmap([], '2026-10-11', 2);
    const weeks = heat.months.flatMap((month) => month.weeks);
    expect(weeks.every((week) => week.cells.length === 7)).toBe(true);
    const dates = weeks.flatMap((week) => week.cells.map((cell) => cell.date));
    for (let i = 1; i < dates.length; i += 1) expect(new Date(dates[i]).getTime() - new Date(dates[i - 1]).getTime()).toBe(86_400_000);
    expect(new Date(`${weeks[0].cells[0].date}T00:00:00Z`).getUTCDay()).toBe(1);
    expect(weeks.map((week) => week.index)).toEqual(weeks.map((_, i) => i));
  });

  it('dagar efter idag är "inte hänt än" och idag är markerad', () => {
    const heat = buildHeatmap([], '2026-10-01', 2);
    const cells = cellsOf(heat);
    expect(cells.filter((cell) => cell.today).map((cell) => cell.date)).toEqual(['2026-10-01']);
    expect(cells.filter((cell) => cell.level === null).map((cell) => cell.date)).toEqual(['2026-10-02', '2026-10-03', '2026-10-04']);
  });

  it('intensitet ur dagens km (flera rundor samma dag summeras) och rundor räknas', () => {
    const heat = buildHeatmap(
      [run({ date: '2026-10-03', distance: 4 }), run({ date: '2026-10-03', distance: 7 }), run({ date: '2026-10-01', distance: 3 }), run({ date: '2026-09-29T08:00:00Z', distance: 16 })],
      TODAY, 2,
    );
    const byDate = Object.fromEntries(cellsOf(heat).map((cell) => [cell.date, cell]));
    expect(byDate['2026-10-03']).toMatchObject({ level: 3, runs: 2, km: 11 });
    expect(byDate['2026-10-01']).toMatchObject({ level: 1, runs: 1 });
    expect(byDate['2026-09-29']).toMatchObject({ level: 4 });
    expect(byDate['2026-10-02']).toMatchObject({ level: 0, runs: 0 });
    expect(heat.runs).toBe(4);
    expect(heat.activeDays).toBe(3);
  });

  it('rundor utanför fönstret räknas inte', () => {
    const heat = buildHeatmap([run({ date: '2025-01-05' }), run({ date: '2026-10-02' })], TODAY, 6);
    expect(heat.runs).toBe(1);
  });

  it('dagar som hunnit hända = fönstrets längd till och med idag', () => {
    const heat = buildHeatmap([], '2026-02-10', 1); // första måndagen i feb är 2/2 → 2–10 feb = 9 dagar
    expect(heat.elapsedDays).toBe(9);
    expect(heat.todayLabel).toBe('Today · 10 Feb');
  });

  it('en tom historik ger ett tomt men fullt ritat rutnät och en ärlig sammanfattning', () => {
    const heat = buildHeatmap([], TODAY, 6);
    expect(heat.runs).toBe(0);
    expect(cellsOf(heat).every((cell) => cell.level === 0 || cell.level === null)).toBe(true);
    expect(heat.summary).toMatch(/^0 runs on 0 of \d+ days$/);
  });
});

describe('buildHeatStats', () => {
  const heatOf = (runs: ReturnType<typeof run>[]) => buildHeatmap(runs, TODAY, 6);

  it('nuvarande streak (effektiv), längsta (rekordet) och dagar aktiva', () => {
    const runs = [run({ date: '2026-10-04' }), run({ date: '2026-10-03' }), run({ date: '2026-10-02' }), run({ date: '2026-08-01' })];
    const me = user({ id: 'u-me', name: 'Joel', total_xp: 1, current_streak: 3, longest_streak: 44, runs });
    const heat = heatOf(runs);
    expect(buildHeatStats(me, heat, NOW).map((stat) => [stat.key, stat.value, stat.label])).toEqual([
      ['streak', '3', 'current streak'],
      ['longest', '44', 'longest streak'],
      ['active', `${Math.round((4 / heat.elapsedDays) * 100)}%`, 'days active'],
    ]);
  });

  it('en bruten streak visas som 0 även om databasraden inte nollställts än', () => {
    const runs = [run({ date: '2026-10-01' })];
    const me = user({ id: 'u-me', name: 'Joel', total_xp: 1, current_streak: 5, longest_streak: 5, runs });
    expect(buildHeatStats(me, heatOf(runs), NOW)[0].value).toBe('0');
  });

  it('rekordet är aldrig lägre än nuvarande streak', () => {
    const runs = [run({ date: '2026-10-04' })];
    const me = user({ id: 'u-me', name: 'Joel', total_xp: 1, current_streak: 2, longest_streak: 0, runs });
    expect(buildHeatStats(me, heatOf(runs), NOW)[1].value).toBe('2');
  });

  it('inga rundor: nollor, aldrig NaN', () => {
    const me = user({ id: 'u-me', name: 'Joel', total_xp: 1 });
    expect(buildHeatStats(me, heatOf([]), NOW).map((stat) => stat.value)).toEqual(['0', '0', '0%']);
  });
});
