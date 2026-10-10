import { describe, it, expect } from 'vitest';
import {
  BADGE_METRICS,
  BADGE_SERIES,
  MAX_TIER,
  TIER_NAMES,
  computeBadgeTiers,
  evaluateSeries,
  requirementText,
  type BadgeRun,
  type BadgeSeriesDef,
  type BadgeSeriesKey,
  type BadgeStats,
} from '../badges.js';

let seq = 0;
function run(over: Partial<BadgeRun> = {}): BadgeRun {
  seq += 1;
  return {
    id: `run-${seq}`,
    date: '2026-10-01',
    distance_km: 5,
    start_time: null,
    moving_time: null,
    total_elevation_gain: null,
    is_treadmill: false,
    ...over,
  };
}

const NO_STREAK: BadgeStats = { longest_streak: 0 };

function tier(seriesKey: BadgeSeriesKey, runs: BadgeRun[], stats: BadgeStats = NO_STREAK): number {
  return computeBadgeTiers(runs, stats)[seriesKey].tier;
}

describe('badge-registret (kontraktstest)', () => {
  it('MAX_TIER är 6 och TIER_NAMES täcker alla tiers i stigande ordning', () => {
    expect(MAX_TIER).toBe(6);
    expect(TIER_NAMES).toEqual(['Common', 'Uncommon', 'Rare', 'Heroic', 'Epic', 'Legendary']);
    expect(TIER_NAMES).toHaveLength(MAX_TIER);
  });

  it('serienycklarna är unika och icke-tomma, med visningsnamn och ikonnyckel', () => {
    const keys = BADGE_SERIES.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const s of BADGE_SERIES) {
      expect(s.key).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(s.name.length).toBeGreaterThan(0);
      expect(s.icon.length).toBeGreaterThan(0);
    }
  });

  it('registret innehåller exakt de fyra serierna i RUN-115', () => {
    expect(BADGE_SERIES.map((s) => s.key)).toEqual([
      'milestoner',
      'earth_trotter',
      'climber',
      'streak_keeper',
    ]);
  });

  it('varje serie har exakt 6 ändliga trösklar, strikt stigande i svårighetsriktningen', () => {
    for (const s of BADGE_SERIES) {
      expect(s.rule.thresholds).toHaveLength(MAX_TIER);
      for (const t of s.rule.thresholds) expect(Number.isFinite(t)).toBe(true);
      for (let i = 1; i < MAX_TIER; i++) {
        const prev = s.rule.thresholds[i - 1];
        const next = s.rule.thresholds[i];
        if (s.rule.direction === 'below') expect(next).toBeLessThan(prev);
        else expect(next).toBeGreaterThan(prev);
      }
    }
  });

  it('varje regel pekar på ett registrerat mått', () => {
    for (const s of BADGE_SERIES) {
      expect(Object.keys(BADGE_METRICS)).toContain(s.rule.metric);
    }
  });

  it('computeBadgeTiers returnerar en post per serie i registret', () => {
    const result = computeBadgeTiers([], NO_STREAK);
    expect(Object.keys(result).sort()).toEqual(BADGE_SERIES.map((s) => s.key).sort());
  });
});

describe('milestoner (längsta enskilda runda)', () => {
  const cases: Array<[number, number]> = [
    [4.99, 0],
    [5, 1],
    [9.99, 1],
    [10, 2],
    [21.09, 2],
    [21.1, 3],
    [29.99, 3],
    [30, 4],
    [42.19, 4],
    [42.2, 5],
    [49.99, 5],
    [50, 6],
    [120, 6],
  ];
  it.each(cases)('en runda på %s km ger tier %s', (km, expected) => {
    expect(tier('milestoner', [run({ distance_km: km })])).toBe(expected);
  });

  it('räknar längsta enskilda runda, inte summan', () => {
    const runs = [run({ distance_km: 4 }), run({ distance_km: 4 }), run({ distance_km: 4 })];
    expect(tier('milestoner', runs)).toBe(0);
  });

  it('source_run_id är den längsta rundan', () => {
    const longest = run({ id: 'long', distance_km: 21.1 });
    const result = computeBadgeTiers([run({ distance_km: 6 }), longest, run({ distance_km: 12 })], NO_STREAK);
    expect(result.milestoner).toEqual({ tier: 3, source_run_id: 'long' });
  });

  it('vid lika längd vinner den först angivna rundan (deterministiskt)', () => {
    const result = computeBadgeTiers(
      [run({ id: 'a', distance_km: 10 }), run({ id: 'b', distance_km: 10 })],
      NO_STREAK
    );
    expect(result.milestoner.source_run_id).toBe('a');
  });

  it('tier 0 har inget source_run_id', () => {
    const result = computeBadgeTiers([run({ distance_km: 3 })], NO_STREAK);
    expect(result.milestoner).toEqual({ tier: 0 });
    expect('source_run_id' in result.milestoner).toBe(false);
  });

  it('löpband räknas som för XP', () => {
    expect(tier('milestoner', [run({ distance_km: 10, is_treadmill: true })])).toBe(2);
  });
});

describe('earth_trotter (total distans, heltals-hundradelar)', () => {
  it.each([
    [99.99, 0],
    [100, 1],
    [499.99, 1],
    [500, 2],
    [999.99, 2],
    [1000, 3],
    [1999.99, 3],
    [2000, 4],
    [4014.99, 4],
    [4015, 5],
    [9999.99, 5],
    [10000, 6],
  ])('en total på %s km ger tier %s', (km, expected) => {
    expect(tier('earth_trotter', [run({ distance_km: km })])).toBe(expected);
  });

  it('summerar över många rundor utan flyttalsdrift: 0,1 + 0,2 räknas som 0,30', () => {
    // 0.1 + 0.2 === 0.30000000000000004 i flyttal; hundradelar ger exakt 30.
    const runs = [run({ distance_km: 0.1 }), run({ distance_km: 0.2 })];
    expect(BADGE_METRICS.total_distance_km.measure(runs)).toEqual({ value: 30 });
  });

  it('1000 rundor på 0,1 km blir exakt 100 km => tier 1 (flyttalssumman vore 99.9999…)', () => {
    const runs = Array.from({ length: 1000 }, () => run({ distance_km: 0.1 }));
    expect(runs.reduce((s, r) => s + r.distance_km, 0)).not.toBe(100); // bevisar att naiv summering driver
    expect(tier('earth_trotter', runs)).toBe(1);
  });

  it('99,99 km uppdelat på 3 rundor à 33,33 ger fortfarande tier 0', () => {
    const runs = [33.33, 33.33, 33.33].map((d) => run({ distance_km: d }));
    expect(tier('earth_trotter', runs)).toBe(0);
  });

  it('100 km uppdelat på 10 rundor ger tier 1', () => {
    const runs = Array.from({ length: 10 }, () => run({ distance_km: 10 }));
    expect(tier('earth_trotter', runs)).toBe(1);
  });

  it('flera serier kan nås av samma rundor: 10 000 km i en runda ger milestoner 6 och earth_trotter 6', () => {
    const result = computeBadgeTiers([run({ distance_km: 10000 })], NO_STREAK);
    expect(result.milestoner.tier).toBe(6);
    expect(result.earth_trotter).toEqual({ tier: 6 });
  });

  it('earth_trotter har inget source_run_id (summaserie)', () => {
    const result = computeBadgeTiers([run({ distance_km: 150 })], NO_STREAK);
    expect(result.earth_trotter).toEqual({ tier: 1 });
  });
});

describe('climber (summa höjdmeter)', () => {
  const withElevation = (m: number | null) => [run({ total_elevation_gain: m })];

  it('null räknas som 0', () => {
    expect(tier('climber', withElevation(null))).toBe(0);
    expect(tier('climber', [run(), run({ total_elevation_gain: null })])).toBe(0);
  });

  it.each([
    [499, 0],
    [500, 1],
    [1344, 1],
    [1345, 2],
    [4799, 2],
    [4800, 3],
    [5894, 3],
    [5895, 4],
    [8847, 4],
    [8848, 5],
    [17695, 5],
    [17696, 6],
  ])('%s m ger tier %s', (m, expected) => {
    expect(tier('climber', withElevation(m))).toBe(expected);
  });

  it('summerar över rundor och blandar null med värden', () => {
    const runs = [
      run({ total_elevation_gain: 4000 }),
      run({ total_elevation_gain: null }),
      run({ total_elevation_gain: 4847.5 }),
    ];
    expect(tier('climber', runs)).toBe(4); // 8847,5 < 8848
    runs.push(run({ total_elevation_gain: 0.5 }));
    expect(tier('climber', runs)).toBe(5); // exakt 8848
  });

  it('ignorerar negativa och icke-ändliga värden i stället för att förgifta summan', () => {
    const runs = [
      run({ total_elevation_gain: 600 }),
      run({ total_elevation_gain: -300 }),
      run({ total_elevation_gain: Number.NaN }),
    ];
    expect(tier('climber', runs)).toBe(1);
  });
});

describe('streak_keeper (längsta svit)', () => {
  it.each([
    [0, 0],
    [2, 0],
    [3, 1],
    [6, 1],
    [7, 2],
    [13, 2],
    [14, 3],
    [29, 3],
    [30, 4],
    [59, 4],
    [60, 5],
    [99, 5],
    [100, 6],
    [365, 6],
  ])('longest_streak %s ger tier %s', (streak, expected) => {
    expect(tier('streak_keeper', [], { longest_streak: streak })).toBe(expected);
  });

  it('icke-ändligt eller negativt streak-värde ger tier 0', () => {
    expect(tier('streak_keeper', [], { longest_streak: Number.NaN })).toBe(0);
    expect(tier('streak_keeper', [], { longest_streak: -5 })).toBe(0);
  });
});

describe('tomma indata', () => {
  it('tomma rundor ger tier 0 i alla serier utan NaN', () => {
    const result = computeBadgeTiers([], NO_STREAK);
    for (const s of BADGE_SERIES) {
      expect(result[s.key]).toEqual({ tier: 0 });
      expect(Number.isNaN(result[s.key].tier)).toBe(false);
    }
  });

  it('rundor med ogiltig distans (NaN, negativ) räknas som 0 km', () => {
    const runs = [run({ distance_km: Number.NaN }), run({ distance_km: -10 })];
    const result = computeBadgeTiers(runs, NO_STREAK);
    expect(result.milestoner.tier).toBe(0);
    expect(result.earth_trotter.tier).toBe(0);
  });

  it('muterar inte indata', () => {
    const runs = [run({ distance_km: 12 })];
    const snapshot = JSON.stringify(runs);
    computeBadgeTiers(runs, { longest_streak: 4 });
    expect(JSON.stringify(runs)).toBe(snapshot);
  });
});

describe('evaluateSeries — registret är utbyggbart med nya poster (RUN-116)', () => {
  it('ett nytt mått + en ny serie fungerar utan ändring av motorn, även "below"-riktning', () => {
    const fastest: BadgeSeriesDef = {
      key: 'fake_speed',
      name: 'Fake Speed',
      icon: 'bolt',
      rule: { metric: 'fake_fastest', direction: 'below', thresholds: [35, 30, 25, 22, 20, 18] },
      requirement: (t) => `Run faster than ${t}`,
    };
    const metric = {
      scale: 1,
      measure: (runs: readonly BadgeRun[]) => {
        const times = runs.filter((r) => r.moving_time != null);
        if (times.length === 0) return null;
        const best = times.reduce((a, b) => (b.moving_time! < a.moving_time! ? b : a));
        return { value: best.moving_time!, source_run_id: best.id };
      },
    };
    const at = (minutes: number) => [run({ id: 'x', moving_time: minutes })];
    expect(evaluateSeries(fastest, metric, [], NO_STREAK)).toEqual({ tier: 0 });
    expect(evaluateSeries(fastest, metric, at(35), NO_STREAK)).toEqual({ tier: 0 }); // "under" = strikt
    expect(evaluateSeries(fastest, metric, at(34), NO_STREAK)).toEqual({ tier: 1, source_run_id: 'x' });
    expect(evaluateSeries(fastest, metric, at(17), NO_STREAK)).toEqual({ tier: 6, source_run_id: 'x' });
  });
});

describe('requirementText (engelska kravtexter)', () => {
  const find = (key: string) => BADGE_SERIES.find((s) => s.key === key)!;

  it('ger en icke-tom text för varje serie och tier', () => {
    for (const s of BADGE_SERIES) {
      for (let t = 1; t <= MAX_TIER; t++) {
        expect(requirementText(s, t).length).toBeGreaterThan(0);
      }
    }
  });

  it('texterna innehåller tröskeln för just den tiern', () => {
    expect(requirementText(find('milestoner'), 3)).toBe('Run 21.1 km in a single run');
    expect(requirementText(find('earth_trotter'), 6)).toBe('Run 10,000 km in total');
    expect(requirementText(find('climber'), 5)).toBe('Climb 8,848 m in total');
    expect(requirementText(find('streak_keeper'), 1)).toBe('Reach a 3-day streak');
  });

  it('kastar RangeError för tier utanför 1..MAX_TIER', () => {
    const s = find('milestoner');
    expect(() => requirementText(s, 0)).toThrow(RangeError);
    expect(() => requirementText(s, 7)).toThrow(RangeError);
    expect(() => requirementText(s, 1.5)).toThrow(RangeError);
  });
});
