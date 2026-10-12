import { afterEach, describe, it, expect } from 'vitest';
import {
  BADGE_METRICS,
  BADGE_SERIES,
  MAX_TIER,
  TIER_NAMES,
  computeBadgeTiers,
  computeSeriesTiers,
  evaluateSeries,
  badgeMetricLabel,
  requirementText,
  tierFlavor,
  uniformTiers,
  type BadgeMetricRegistry,
  type BadgeRun,
  type BadgeSeriesDef,
  type BadgeSeriesKey,
  type BadgeStats,
} from '../badges.js';
import { wallClockMinutes } from '../calendar.js';

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
    source: 'manual',
    ...over,
  };
}

const NO_STREAK: BadgeStats = { longest_streak: 0 };

function tier(seriesKey: BadgeSeriesKey, runs: BadgeRun[], stats: BadgeStats = NO_STREAK): number {
  return computeBadgeTiers(runs, stats)[seriesKey].tier;
}

describe('badge-registret (kontraktstest, T1)', () => {
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

  it('registret innehåller exakt de åtta serierna i v0.6.0', () => {
    expect(BADGE_SERIES.map((s) => s.key)).toEqual([
      'milestoner',
      'earth_trotter',
      'climber',
      'streak_keeper',
      'early_bird',
      'night_owl',
      'speedster',
      'precisionist',
    ]);
  });

  it('ikonnycklarna för Early Bird, Night Owl, Speedster och Precisionist är sun, moon, zap, target', () => {
    const icon = (key: string) => BADGE_SERIES.find((s) => s.key === key)!.icon;
    expect([icon('early_bird'), icon('night_owl'), icon('speedster'), icon('precisionist')]).toEqual([
      'sun',
      'moon',
      'zap',
      'target',
    ]);
  });

  it('varje serie har exakt 6 tier-regler med ändlig tröskel och registrerat mått per tier', () => {
    for (const s of BADGE_SERIES) {
      expect(s.tiers).toHaveLength(MAX_TIER);
      for (const rule of s.tiers) {
        expect(Number.isFinite(rule.threshold)).toBe(true);
        expect(Object.keys(BADGE_METRICS)).toContain(rule.metric);
      }
    }
  });

  it('varje serie har EN mätning i alla sex nivåer och strikt stigande (Speedster: fallande) trösklar', () => {
    for (const s of BADGE_SERIES) {
      expect(new Set(s.tiers.map((r) => r.metric)).size, `${s.key} mått`).toBe(1);
      expect(new Set(s.tiers.map((r) => r.direction)).size, `${s.key} riktning`).toBe(1);
      for (let i = 1; i < MAX_TIER; i++) {
        const prev = s.tiers[i - 1].threshold;
        const next = s.tiers[i].threshold;
        if (s.tiers[0].direction === 'below') expect(next, `${s.key} tier ${i + 1}`).toBeLessThan(prev);
        else expect(next, `${s.key} tier ${i + 1}`).toBeGreaterThan(prev);
      }
    }
  });

  it('trösklarna är ägarbeslutets', () => {
    const thresholds = (key: string) => BADGE_SERIES.find((s) => s.key === key)!.tiers.map((r) => r.threshold);
    expect(thresholds('milestoner')).toEqual([5, 10, 21.1, 30, 42.2, 50]);
    expect(thresholds('earth_trotter')).toEqual([100, 300, 1000, 2000, 3000, 5000]);
    expect(thresholds('climber')).toEqual([500, 1345, 4808, 8848, 17696, 26544]);
    expect(thresholds('streak_keeper')).toEqual([7, 14, 50, 100, 365, 730]);
    expect(thresholds('early_bird')).toEqual([5, 20, 50, 100, 200, 300]);
    expect(thresholds('night_owl')).toEqual([5, 20, 50, 100, 200, 300]);
    expect(thresholds('speedster')).toEqual([35, 30, 25, 22, 20, 18]);
    expect(thresholds('precisionist')).toEqual([5, 20, 50, 100, 200, 300]);
  });

  it('serierna använder rätt mått', () => {
    const metric = (key: string) => BADGE_SERIES.find((s) => s.key === key)!.tiers[0].metric;
    expect(BADGE_SERIES.map((s) => metric(s.key))).toEqual([
      'longest_run_km',
      'total_distance_km',
      'total_elevation_m',
      'longest_streak_days',
      'early_bird_runs',
      'night_owl_runs',
      'best_5k_time',
      'exact_km_strava_runs',
    ]);
  });

  it('mått som inte längre används är borttagna ur registret, och alla kvarvarande används', () => {
    const keys = Object.keys(BADGE_METRICS);
    for (const gone of [
      'early_bird_deep_runs',
      'night_owl_late_runs',
      'midnight_runs',
      'exact_half_marathon_runs',
      'exact_classic_distances',
      'exact_km_runs',
    ]) {
      expect(keys).not.toContain(gone);
    }
    const used = new Set<string>(BADGE_SERIES.flatMap((s) => s.tiers.map((r) => r.metric)));
    for (const key of keys) expect(used.has(key), key).toBe(true);
  });

  it('Speedster är en "below"-serie med fallande minuttrösklar 35/30/25/22/20/18', () => {
    const s = BADGE_SERIES.find((x) => x.key === 'speedster')!;
    expect(s.tiers.map((r) => r.threshold)).toEqual([35, 30, 25, 22, 20, 18]);
    expect(s.tiers.every((r) => r.direction === 'below')).toBe(true);
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
    [299.99, 1],
    [300, 2],
    [999.99, 2],
    [1000, 3],
    [1999.99, 3],
    [2000, 4],
    [2999.99, 4],
    [3000, 5],
    [4999.99, 5],
    [5000, 6],
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

  it('flera serier kan nås av samma rundor: 5 000 km i en runda ger milestoner 6 och earth_trotter 6', () => {
    const result = computeBadgeTiers([run({ distance_km: 5000 })], NO_STREAK);
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
    [4807, 2],
    [4808, 3],
    [8847, 3],
    [8848, 4],
    [17695, 4],
    [17696, 5],
    [26543, 5],
    [26544, 6],
  ])('%s m ger tier %s', (m, expected) => {
    expect(tier('climber', withElevation(m))).toBe(expected);
  });

  it('summerar över rundor och blandar null med värden', () => {
    const runs = [
      run({ total_elevation_gain: 4000 }),
      run({ total_elevation_gain: null }),
      run({ total_elevation_gain: 4847.5 }),
    ];
    expect(tier('climber', runs)).toBe(3); // 8847,5 < 8848
    runs.push(run({ total_elevation_gain: 0.5 }));
    expect(tier('climber', runs)).toBe(4); // exakt 8848
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
    [6, 0],
    [7, 1],
    [13, 1],
    [14, 2],
    [49, 2],
    [50, 3],
    [99, 3],
    [100, 4],
    [364, 4],
    [365, 5],
    [729, 5],
    [730, 6],
    [2000, 6],
  ])('longest_streak %s ger tier %s', (streak, expected) => {
    expect(tier('streak_keeper', [], { longest_streak: streak })).toBe(expected);
  });

  it('icke-ändligt eller negativt streak-värde ger tier 0', () => {
    expect(tier('streak_keeper', [], { longest_streak: Number.NaN })).toBe(0);
    expect(tier('streak_keeper', [], { longest_streak: -5 })).toBe(0);
  });
});

// ─── RUN-116 ─────────────────────────────────────────────────────────────────────────────────────

/** Runda vars väggklocka är `hhmm` (start_time lagras med falskt 'Z', ADR 009 beslut 2). */
const at = (hhmm: string, over: Partial<BadgeRun> = {}) =>
  run({ start_time: `2026-10-01T${hhmm}:00Z`, ...over });
const many = (n: number, make: () => BadgeRun) => Array.from({ length: n }, make);

describe('wallClockMinutes (väggklocka, ingen tidszonskonvertering)', () => {
  it('05:30 räknas som 05:30 både sommar och vinter (ingen DST-konvertering)', () => {
    expect(wallClockMinutes('2026-07-01T05:30:00Z')).toBe(5 * 60 + 30);
    expect(wallClockMinutes('2026-01-15T05:30:00Z')).toBe(5 * 60 + 30);
  });

  it('utomlands: 06:10 Tokyo-tid lagrad som …T06:10:00Z räknas som 06:10', () => {
    expect(wallClockMinutes('2026-07-01T06:10:00Z')).toBe(6 * 60 + 10);
  });

  it('Supabase-formatet med +00:00 och millisekunder läses likadant', () => {
    expect(wallClockMinutes('2026-07-01T05:30:00+00:00')).toBe(330);
    expect(wallClockMinutes('2026-07-01T05:30:00.000Z')).toBe(330);
  });

  it('en sträng utan zonangivelse läses som väggklocka, inte som processens lokala tid', () => {
    expect(wallClockMinutes('2026-07-01T05:30:00')).toBe(330);
  });

  it('en icke-UTC-offset konverteras aldrig: klockslaget läses som skrivet', () => {
    expect(wallClockMinutes('2026-07-01T05:30:00+09:00')).toBe(330);
    expect(wallClockMinutes('2026-07-01T05:30:00-07:00')).toBe(330);
  });

  it('rent datum utan klockslag och omöjliga klockslag ger null', () => {
    expect(wallClockMinutes('2026-07-01')).toBeNull();
    expect(wallClockMinutes('2026-07-01T25:00:00Z')).toBeNull();
    expect(wallClockMinutes('2026-07-01T10:61:00Z')).toBeNull();
  });

  it('00:00 => 0 och 23:59 => 1439', () => {
    expect(wallClockMinutes('2026-10-01T00:00:00Z')).toBe(0);
    expect(wallClockMinutes('2026-10-01T23:59:00Z')).toBe(1439);
  });

  it('null, tom och ogiltig sträng ger null (ingen räkning)', () => {
    expect(wallClockMinutes(null)).toBeNull();
    expect(wallClockMinutes('')).toBeNull();
    expect(wallClockMinutes('inte ett datum')).toBeNull();
  });

  describe('samma resultat oavsett process.env.TZ', () => {
    const original = process.env.TZ;
    afterEach(() => {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    });

    const offsets: Record<string, number> = {
      'Asia/Tokyo': -540,
      'America/Los_Angeles': 420,
      'Europe/Stockholm': -120,
      UTC: 0,
    };

    it.each(Object.keys(offsets))('TZ=%s', (tz) => {
      process.env.TZ = tz;
      // Förutsättning: zonbytet har slagit igenom (annars bevisar testet ingenting).
      expect(new Date('2026-07-01T05:30:00Z').getTimezoneOffset()).toBe(offsets[tz]);

      expect(wallClockMinutes('2026-07-01T05:30:00Z')).toBe(330);
      expect(wallClockMinutes('2026-01-15T05:30:00Z')).toBe(330);
      expect(wallClockMinutes('2026-07-01T05:30:00')).toBe(330);
      expect(tier('early_bird', many(5, () => at('05:30')))).toBe(1);
    });
  });
});

describe('early_bird (rundor med start i [04:00, 07:00), väggklocka)', () => {
  it.each([
    ['03:59', 0],
    ['04:00', 1],
    ['06:59', 1],
    ['07:00', 0],
    ['12:00', 0],
    ['00:00', 0],
  ])('5 rundor kl %s ger tier %s (fönstret är [04:00, 07:00))', (time, expected) => {
    expect(tier('early_bird', many(5, () => at(time)))).toBe(expected);
  });

  it.each([
    [4, 0],
    [5, 1],
    [19, 1],
    [20, 2],
    [49, 2],
    [50, 3],
    [99, 3],
    [100, 4],
    [199, 4],
    [200, 5],
    [299, 5],
    [300, 6],
    [500, 6],
  ])('%s rundor kl 06:59 ger tier %s (samma fönster i alla sex nivåer)', (n, expected) => {
    expect(tier('early_bird', many(n, () => at('06:59')))).toBe(expected);
  });

  it('06:59 räknas överallt, 07:00 räknas aldrig: 300 rundor kl 07:00 ger tier 0', () => {
    expect(tier('early_bird', many(300, () => at('07:00')))).toBe(0);
    expect(tier('early_bird', many(300, () => at('06:59')))).toBe(6);
  });

  it('rundor från olika delar av fönstret räknas ihop: 150 kl 04:00 + 150 kl 06:59 ger tier 6', () => {
    const runs = [...many(150, () => at('04:00')), ...many(150, () => at('06:59'))];
    expect(tier('early_bird', runs)).toBe(6);
  });

  it('manuell runda utan start_time räknas inte', () => {
    expect(tier('early_bird', many(5, () => run({ start_time: null })))).toBe(0);
    expect(tier('early_bird', [...many(4, () => at('05:00')), run({ start_time: null })])).toBe(0);
    expect(tier('early_bird', [...many(4, () => at('05:00')), at('05:00')])).toBe(1);
  });

  it('en runda med ogiltig start_time räknas inte och kastar inte', () => {
    expect(tier('early_bird', [...many(4, () => at('05:00')), run({ start_time: 'skräp' })])).toBe(0);
  });

  it('early_bird har inget source_run_id (räknemått)', () => {
    expect(computeBadgeTiers(many(5, () => at('05:00')), NO_STREAK).early_bird).toEqual({ tier: 1 });
  });
});

describe('night_owl (fönster [21:00, 04:00) över midnatt, väggklocka)', () => {
  it.each([
    ['20:59', 0],
    ['21:00', 1],
    ['23:59', 1],
    ['00:00', 1],
    ['03:59', 1],
    ['04:00', 0],
    ['12:00', 0],
  ])('5 rundor kl %s ger tier %s (fönstret är [21:00, 04:00))', (time, expected) => {
    expect(tier('night_owl', many(5, () => at(time)))).toBe(expected);
  });

  it.each([
    [4, 0],
    [5, 1],
    [19, 1],
    [20, 2],
    [49, 2],
    [50, 3],
    [99, 3],
    [100, 4],
    [199, 4],
    [200, 5],
    [299, 5],
    [300, 6],
    [500, 6],
  ])('%s rundor kl 03:59 ger tier %s (samma fönster i alla sex nivåer)', (n, expected) => {
    expect(tier('night_owl', many(n, () => at('03:59')))).toBe(expected);
  });

  it('03:59 räknas överallt, 04:00 räknas aldrig: 300 rundor kl 04:00 ger tier 0', () => {
    expect(tier('night_owl', many(300, () => at('04:00')))).toBe(0);
    expect(tier('night_owl', many(300, () => at('03:59')))).toBe(6);
  });

  it('rundor på båda sidor om midnatt räknas ihop: 150 kl 23:45 + 150 kl 00:15 ger tier 6', () => {
    const runs = [...many(150, () => at('23:45')), ...many(150, () => at('00:15'))];
    expect(tier('night_owl', runs)).toBe(6);
  });

  it('manuell runda utan start_time räknas inte', () => {
    expect(tier('night_owl', many(5, () => run({ start_time: null })))).toBe(0);
  });

  it('en natt-runda utomlands räknas i sin lokala tid: 5 rundor lagrade som …T23:40:00Z ger tier 1', () => {
    expect(tier('night_owl', many(5, () => at('23:40')))).toBe(1);
  });
});

describe('speedster (bästa tid på runda 4,9 <= km < 10,0, råa sekunder, strikt under)', () => {
  const timed = (km: number, seconds: number | null, over: Partial<BadgeRun> = {}) =>
    run({ distance_km: km, moving_time: seconds, ...over });

  it.each([
    [4.89, 0],
    [4.9, 1],
    [5, 1],
    [9.99, 1],
    [10, 0],
    [10.01, 0],
  ])('en runda på %s km på 30:00 ger tier %s (kvalificeringsspannet är [4,90, 10,00))', (km, expected) => {
    // 1800 s är inte under 30 min men under 35 min => tier 1 om rundan kvalificerar.
    expect(tier('speedster', [timed(km, 1800)])).toBe(expected);
  });

  it.each([
    [35 * 60 - 1, 1],
    [35 * 60, 0],
    [30 * 60 - 1, 2],
    [30 * 60, 1],
    [25 * 60 - 1, 3],
    [25 * 60, 2],
    [22 * 60 - 1, 4],
    [22 * 60, 3],
    [20 * 60 - 1, 5],
    [20 * 60, 4],
    [18 * 60 - 1, 6],
    [18 * 60, 5],
    [10 * 60, 6],
  ])('en 5 km-runda på %s s ger tier %s', (seconds, expected) => {
    expect(tier('speedster', [timed(5, seconds)])).toBe(expected);
  });

  it('34:59 => tier 1 och 35:00 => tier 0', () => {
    expect(tier('speedster', [timed(5, 2099)])).toBe(1);
    expect(tier('speedster', [timed(5, 2100)])).toBe(0);
  });

  it('moving_time 0, null, negativ och NaN ignoreras (blir inte "snabbast")', () => {
    expect(tier('speedster', [timed(5, 0)])).toBe(0);
    expect(tier('speedster', [timed(5, null)])).toBe(0);
    expect(tier('speedster', [timed(5, -30)])).toBe(0);
    expect(tier('speedster', [timed(5, Number.NaN)])).toBe(0);
    // ...och stör inte en riktig tid:
    expect(tier('speedster', [timed(5, 0), timed(5, null), timed(5, 1700)])).toBe(2);
  });

  it('rundor utanför 4,9–<10,0 km räknas inte även om de är snabbare', () => {
    expect(tier('speedster', [timed(3, 600), timed(12, 1500), timed(5, 1700)])).toBe(2);
    expect(tier('speedster', [timed(3, 600), timed(12, 1500)])).toBe(0);
  });

  it('bästa tiden vinner och source_run_id är den snabbaste rundan', () => {
    const result = computeBadgeTiers(
      [timed(5, 1700, { id: 'slow' }), timed(6, 1490, { id: 'fast' }), timed(7, 1600, { id: 'mid' })],
      NO_STREAK
    );
    expect(result.speedster).toEqual({ tier: 3, source_run_id: 'fast' });
  });

  it('vid lika tid vinner den först angivna rundan (deterministiskt)', () => {
    const result = computeBadgeTiers([timed(5, 1500, { id: 'a' }), timed(5, 1500, { id: 'b' })], NO_STREAK);
    expect(result.speedster.source_run_id).toBe('a');
  });

  it('tier 0 har inget source_run_id; inga rundor ger tier 0', () => {
    expect(computeBadgeTiers([timed(5, 2400)], NO_STREAK).speedster).toEqual({ tier: 0 });
    expect(computeBadgeTiers([], NO_STREAK).speedster).toEqual({ tier: 0 });
  });

  it('råa sekunder, ingen avrundning till minuter: 2099,9 s är under 35:00, 2100 s är det inte', () => {
    expect(tier('speedster', [timed(5, 2099.9)])).toBe(1);
    expect(tier('speedster', [timed(5, 2100)])).toBe(0);
  });
});

describe('precisionist (STRAVA-rundor på exakt hel km, heltals-hundradelar; T2, T3)', () => {
  const dist = (km: number, over: Partial<BadgeRun> = {}) => run({ distance_km: km, source: 'strava', ...over });
  const exact = (n: number) => many(n, () => dist(5));

  it('10,00 räknas som exakt hel km, 10,01 inte, 0,00 inte', () => {
    expect(tier('precisionist', many(5, () => dist(10)))).toBe(1);
    expect(tier('precisionist', many(5, () => dist(10.01)))).toBe(0);
    expect(tier('precisionist', many(5, () => dist(0)))).toBe(0);
    expect(tier('precisionist', [...many(4, () => dist(10)), dist(10.01)])).toBe(0);
  });

  it('under 1 km räknas inte (0,50 är inte en hel km), 1,00 räknas', () => {
    expect(tier('precisionist', many(5, () => dist(0.5)))).toBe(0);
    expect(tier('precisionist', many(5, () => dist(1)))).toBe(1);
  });

  it('flyttalsrester ger inget falskt utfall: 8,2, 2,3 och 0,7+0,1 är inte hela km, 7,0 och 3,00 är', () => {
    expect(tier('precisionist', [dist(8.2), dist(2.3), dist(0.7 + 0.1), dist(8.2), dist(2.3)])).toBe(0);
    expect(tier('precisionist', [dist(7), dist(3.0), dist(1), dist(2), dist(4)])).toBe(1);
  });

  it('5/20/50/100/200/300 Strava-rundor på hel km ger tier 1–6, med gränsfall', () => {
    const cases: Array<[number, number]> = [
      [4, 0],
      [5, 1],
      [19, 1],
      [20, 2],
      [49, 2],
      [50, 3],
      [99, 3],
      [100, 4],
      [199, 4],
      [200, 5],
      [299, 5],
      [300, 6],
      [450, 6],
    ];
    for (const [n, expected] of cases) expect(tier('precisionist', exact(n)), `${n} rundor`).toBe(expected);
  });

  it('manuell runda på exakt hel km räknas inte i Precisionist', () => {
    const manual = many(5, () => run({ distance_km: 5, source: 'manual' }));
    expect(tier('precisionist', manual)).toBe(0);
  });

  it('bara Strava-rundorna räknas i en blandad mängd: 4 Strava + 100 manuella ger tier 0, 5 Strava + 100 manuella ger tier 1', () => {
    const manual = many(100, () => run({ distance_km: 5, source: 'manual' }));
    expect(tier('precisionist', [...exact(4), ...manual])).toBe(0);
    expect(tier('precisionist', [...exact(5), ...manual])).toBe(1);
  });

  it('manuella rundor påverkar inte andra serier negativt (Milestoner räknar dem fortfarande)', () => {
    expect(tier('milestoner', [run({ distance_km: 10, source: 'manual' })])).toBe(2);
  });

  it('en runda utan känd source (saknat fält) räknas inte', () => {
    const unknown = many(5, () => run({ distance_km: 5, source: undefined as never }));
    expect(tier('precisionist', unknown)).toBe(0);
  });

  it('precisionist har inget source_run_id (räknemått)', () => {
    expect(computeBadgeTiers(exact(5), NO_STREAK).precisionist).toEqual({ tier: 1 });
  });

  it('löpband räknas som för XP', () => {
    expect(tier('precisionist', many(5, () => dist(5, { is_treadmill: true })))).toBe(1);
  });

  it('ogiltiga distanser (NaN, negativ) räknas inte', () => {
    expect(tier('precisionist', [dist(Number.NaN), dist(-10), dist(-1), dist(Number.NaN), dist(-5)])).toBe(0);
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

describe('evaluateSeries — registret är utbyggbart med nya poster', () => {
  it('ett nytt mått + en ny serie fungerar utan ändring av motorn, även "below"-riktning', () => {
    const fastest: BadgeSeriesDef = {
      key: 'fake_speed',
      name: 'Fake Speed',
      icon: 'bolt',
      tiers: uniformTiers('fake_fastest', [35, 30, 25, 22, 20, 18], 'below'),
      flavors: ['a', 'b', 'c', 'd', 'e', 'f'],
      metricLabel: 'Fake fastest',
      requirement: (t) => `Run faster than ${t}`,
    };
    const metrics = {
      fake_fastest: {
        scale: 1,
        measure: (runs: readonly BadgeRun[]) => {
          const times = runs.filter((r) => r.moving_time != null);
          if (times.length === 0) return null;
          const best = times.reduce((a, b) => (b.moving_time! < a.moving_time! ? b : a));
          return { value: best.moving_time!, source_run_id: best.id };
        },
      },
    };
    const at = (minutes: number) => [run({ id: 'x', moving_time: minutes })];
    expect(evaluateSeries(fastest, metrics, [], NO_STREAK)).toEqual({ tier: 0 });
    expect(evaluateSeries(fastest, metrics, at(35), NO_STREAK)).toEqual({ tier: 0 }); // "under" = strikt
    expect(evaluateSeries(fastest, metrics, at(34), NO_STREAK)).toEqual({ tier: 1, source_run_id: 'x' });
    expect(evaluateSeries(fastest, metrics, at(17), NO_STREAK)).toEqual({ tier: 6, source_run_id: 'x' });
  });

  describe('serie med olika mått per tier och icke-monotona trösklar (Early Bird-formen)', () => {
    // Registreras som riktiga serier: ett måttregister + en serie-post, körda genom computeSeriesTiers.
    const hour = (r: BadgeRun) => (r.start_time ? new Date(r.start_time).getUTCHours() : null);
    const metrics: BadgeMetricRegistry = {
      early_count: {
        scale: 1,
        measure: (runs) => ({ value: runs.filter((r) => (hour(r) ?? 99) < 7).length }),
      },
      very_early_count: {
        scale: 1,
        measure: (runs) => ({ value: runs.filter((r) => (hour(r) ?? 99) < 6).length }),
      },
      longest_run: {
        scale: 100,
        measure: (runs) => {
          if (runs.length === 0) return null;
          const best = runs.reduce((a, b) => (b.distance_km > a.distance_km ? b : a));
          return { value: Math.round(best.distance_km * 100), source_run_id: best.id };
        },
      },
    };
    const fakeEarly: BadgeSeriesDef = {
      key: 'fake_early',
      name: 'Fake Early',
      icon: 'sun',
      // Trösklarna 5,15,50,100,25,10 är icke-monotona och tier 4/5/6 byter mått; tier 5 är ett enrundsmått.
      tiers: [
        { metric: 'early_count', threshold: 5 },
        { metric: 'early_count', threshold: 15 },
        { metric: 'early_count', threshold: 50 },
        { metric: 'early_count', threshold: 100 },
        { metric: 'longest_run', threshold: 21.1 },
        { metric: 'very_early_count', threshold: 10 },
      ],
      flavors: ['a', 'b', 'c', 'd', 'e', 'f'],
      metricLabel: 'Fake early',
      requirement: (t, tier) => `tier ${tier} needs ${t}`,
    };
    const evaluate = (runs: BadgeRun[]) =>
      computeSeriesTiers([fakeEarly], metrics, runs, NO_STREAK).fake_early;
    const early = (n: number, startTime: string, over: Partial<BadgeRun> = {}) =>
      Array.from({ length: n }, () => run({ start_time: startTime, ...over }));

    it('inga rundor => tier 0', () => {
      expect(evaluate([])).toEqual({ tier: 0 });
    });

    it('tier = högsta tier vars EGNA regel är uppfylld, inte nästlat: 10 rundor före 06:00 => tier 6 trots att tier 2–5 inte nåtts', () => {
      expect(evaluate(early(10, '2026-10-01T05:00:00Z'))).toEqual({ tier: 6 });
    });

    it('10 rundor 06:00–06:59 uppfyller bara tier 1 (tier 6 mäter före 06:00)', () => {
      expect(evaluate(early(10, '2026-10-01T06:30:00Z'))).toEqual({ tier: 1 });
    });

    it('15 rundor 06:30 => tier 2 (tröskelföljden 5 < 15 gäller bara inom samma mått)', () => {
      expect(evaluate(early(15, '2026-10-01T06:30:00Z'))).toEqual({ tier: 2 });
    });

    it('source_run_id kommer från den högsta uppfyllda tierns mått när det är ett enrundsmått', () => {
      const half = run({ id: 'half', distance_km: 21.1, start_time: '2026-10-01T12:00:00Z' });
      expect(evaluate([half])).toEqual({ tier: 5, source_run_id: 'half' });
    });

    it('source_run_id utelämnas när den högsta tierns mått saknar run (tier 6 slår tier 5:s run)', () => {
      const half = run({ id: 'half', distance_km: 21.1, start_time: '2026-10-01T05:00:00Z' });
      const result = evaluate([half, ...early(9, '2026-10-02T05:00:00Z')]);
      expect(result).toEqual({ tier: 6 });
      expect('source_run_id' in result).toBe(false);
    });

    it('ett mått som saknas i registret kastar ett tydligt fel', () => {
      const broken: BadgeSeriesDef = { ...fakeEarly, key: 'broken', tiers: uniformTiers('nope', [1, 2, 3, 4, 5, 6]) };
      expect(() => computeSeriesTiers([broken], metrics, [], NO_STREAK)).toThrow(/unknown metric "nope"/);
    });
  });
});

const EN = '–'; // tankstreck som i designen (runquest-badges.js)

// Facit: designens format (docs/design/badges/spec.md §6) med ägarbeslutet 2026-10-11 (RUN-135) för trösklar och
// flavors. Ordagrant — en ändrad text ska synas här.
const COPY: Record<string, { name: string; metricLabel: string; tiers: [string, string][] }> = {
  milestoner: {
    name: 'Milestoner',
    metricLabel: 'Longest single run',
    tiers: [
      ['A single run of 5 km', 'First Five'],
      ['A single run of 10 km', 'Double Digits'],
      ['A single run of 21.1 km', 'Half Marathon'],
      ['A single run of 30 km', 'The Long Haul'],
      ['A single run of 42.2 km', 'Marathon'],
      ['A single run of 50 km', 'Ultra'],
    ],
  },
  earth_trotter: {
    name: 'Earth Trotter',
    metricLabel: 'Total distance',
    tiers: [
      ['100 km total distance', 'Off the Mark'],
      ['300 km total distance', 'Road Worn'],
      ['1,000 km total distance', 'Four Figures'],
      ['2,000 km total distance', 'The Long Way'],
      ['3,000 km total distance', 'Coast to Coast to Coast'],
      ['5,000 km total distance', 'Five Thousand'],
    ],
  },
  climber: {
    name: 'Climber',
    metricLabel: 'Total elevation gain',
    tiers: [
      ['500 m of elevation gain', 'Foothills'],
      ['1,345 m of elevation gain', 'Ben Nevis'],
      ['4,808 m of elevation gain', 'Mont Blanc'],
      ['8,848 m of elevation gain', 'Everest'],
      ['17,696 m of elevation gain', 'Everest, Twice'],
      ['26,544 m of elevation gain', 'Everest, Thrice'],
    ],
  },
  streak_keeper: {
    name: 'Streak Keeper',
    metricLabel: 'Longest run streak',
    tiers: [
      ['7 days in a row', 'Full Week'],
      ['14 days in a row', 'Fortnight'],
      ['50 days in a row', 'Fifty Straight'],
      ['100 days in a row', 'The Hundred'],
      ['365 days in a row', 'A Full Year'],
      ['730 days in a row', 'Two Full Years'],
    ],
  },
  early_bird: {
    name: 'Early Bird',
    metricLabel: 'Early starts',
    tiers: [
      [`5 runs started 04:00${EN}06:59`, 'First Light'],
      [`20 runs started 04:00${EN}06:59`, 'Dawn Patrol'],
      [`50 runs started 04:00${EN}06:59`, 'Sunrise Regular'],
      [`100 runs started 04:00${EN}06:59`, 'Morning Fixture'],
      [`200 runs started 04:00${EN}06:59`, 'Before the Birds'],
      [`300 runs started 04:00${EN}06:59`, 'The Dark Hours'],
    ],
  },
  night_owl: {
    name: 'Night Owl',
    metricLabel: 'Late starts',
    tiers: [
      [`5 runs started 21:00${EN}03:59`, 'Lights Out'],
      [`20 runs started 21:00${EN}03:59`, 'Street-lamp Pace'],
      [`50 runs started 21:00${EN}03:59`, 'Closing Time'],
      [`100 runs started 21:00${EN}03:59`, 'Nocturnal'],
      [`200 runs started 21:00${EN}03:59`, 'Past Midnight'],
      [`300 runs started 21:00${EN}03:59`, 'The Midnight Run'],
    ],
  },
  speedster: {
    name: 'Speedster',
    metricLabel: 'Fastest 5 km',
    tiers: [
      ['A 5 km run under 35:00', 'Moving'],
      ['A 5 km run under 30:00', 'Brisk'],
      ['A 5 km run under 25:00', 'Quick'],
      ['A 5 km run under 22:00', 'Fast'],
      ['A 5 km run under 20:00', 'Sub-20'],
      ['A 5 km run under 18:00', 'Flying'],
    ],
  },
  precisionist: {
    name: 'Precisionist',
    metricLabel: 'Exact finishes',
    tiers: [
      ['5 runs on an exact whole km', 'On the Nose'],
      ['20 runs on an exact whole km', 'Measured'],
      ['50 runs on an exact whole km', 'Calibrated'],
      ['100 runs on an exact whole km', 'Clockwork'],
      ['200 runs on an exact whole km', 'Surgical'],
      ['300 runs on an exact whole km', 'Atomic Clock'],
    ],
  },
};

describe('badgetexter enligt designen (T1, T2, T3, T4)', () => {
  const find = (key: string) => BADGE_SERIES.find((s) => s.key === key)!;
  const keys = Object.keys(COPY);

  it('tabellen täcker exakt registrets åtta serier i registrets ordning', () => {
    expect(BADGE_SERIES.map((s) => s.key)).toEqual(keys);
  });

  it('alla 48 kravtexter är ordagranna mot designen', () => {
    for (const key of keys) {
      const actual = Array.from({ length: MAX_TIER }, (_, i) => requirementText(find(key), i + 1));
      expect(actual, key).toEqual(COPY[key].tiers.map(([req]) => req));
    }
  });

  it('fönstertexterna är samma i alla nivåer (Early Bird 04:00–06:59, Night Owl 21:00–03:59)', () => {
    for (let t = 1; t <= MAX_TIER; t++) {
      expect(requirementText(find('early_bird'), t)).toMatch(new RegExp(`runs started 04:00${EN}06:59$`));
      expect(requirementText(find('night_owl'), t)).toMatch(new RegExp(`runs started 21:00${EN}03:59$`));
    }
  });

  it('tusenavgränsare som i designen, inga gamla formuleringar kvar', () => {
    expect(requirementText(find('earth_trotter'), 3)).toBe('1,000 km total distance');
    expect(requirementText(find('earth_trotter'), 6)).toBe('5,000 km total distance');
    expect(requirementText(find('climber'), 2)).toBe('1,345 m of elevation gain');
    for (const s of BADGE_SERIES) {
      for (let t = 1; t <= MAX_TIER; t++) {
        expect(requirementText(s, t)).not.toMatch(/^(Run|Climb|Reach|Start|Finish) |\bin under\b|between/);
      }
    }
  });

  it('visningsnamnen är designens (Climber, inte The Climber); serienycklarna är oförändrade', () => {
    expect(BADGE_SERIES.map((s) => s.name)).toEqual(keys.map((k) => COPY[k].name));
    expect(find('climber').name).toBe('Climber');
    expect(find('climber').key).toBe('climber');
  });

  it('alla 48 flavor-namn är designens, via både flavors och tierFlavor', () => {
    for (const key of keys) {
      const expected = COPY[key].tiers.map(([, fl]) => fl);
      expect([...find(key).flavors], key).toEqual(expected);
      const viaFn = Array.from({ length: MAX_TIER }, (_, i) => tierFlavor(find(key), i + 1));
      expect(viaFn, key).toEqual(expected);
    }
  });

  it('de åtta måttetiketterna är designens, via både metricLabel och badgeMetricLabel', () => {
    for (const key of keys) {
      expect(find(key).metricLabel, key).toBe(COPY[key].metricLabel);
      expect(badgeMetricLabel(find(key)), key).toBe(COPY[key].metricLabel);
    }
  });

  it('kontraktstest: varje serie har exakt 6 icke-tomma flavors (unika inom serien) och en icke-tom metricLabel', () => {
    for (const s of BADGE_SERIES) {
      expect(s.flavors, s.key).toHaveLength(MAX_TIER);
      for (const fl of s.flavors) expect(fl.trim().length, s.key).toBeGreaterThan(0);
      expect(new Set(s.flavors).size, s.key).toBe(MAX_TIER);
      expect(s.metricLabel.trim().length, s.key).toBeGreaterThan(0);
    }
    expect(new Set(BADGE_SERIES.map((s) => s.metricLabel)).size).toBe(BADGE_SERIES.length);
  });

  it('tierFlavor kastar RangeError för tier utanför 1..MAX_TIER och för icke-heltal', () => {
    const s = find('milestoner');
    expect(() => tierFlavor(s, 0)).toThrow(RangeError);
    expect(() => tierFlavor(s, 7)).toThrow(RangeError);
    expect(() => tierFlavor(s, 1.5)).toThrow(RangeError);
    expect(() => tierFlavor(s, Number.NaN)).toThrow(RangeError);
    expect(() => tierFlavor(s, -1)).toThrow(RangeError);
  });
});

describe('requirementText', () => {
  const find = (key: string) => BADGE_SERIES.find((s) => s.key === key)!;

  it('ger en icke-tom text för varje serie och tier', () => {
    for (const s of BADGE_SERIES) {
      for (let t = 1; t <= MAX_TIER; t++) {
        expect(requirementText(s, t).length).toBeGreaterThan(0);
      }
    }
  });

  it('Speedster-texten lovar inte en splittid (en hel runda i kvalificeringsspannet räknas)', () => {
    for (let t = 1; t <= MAX_TIER; t++) expect(requirementText(find('speedster'), t)).not.toMatch(/split|first/i);
  });

  it('kastar RangeError för tier utanför 1..MAX_TIER', () => {
    const s = find('milestoner');
    expect(() => requirementText(s, 0)).toThrow(RangeError);
    expect(() => requirementText(s, 7)).toThrow(RangeError);
    expect(() => requirementText(s, 1.5)).toThrow(RangeError);
  });
});
