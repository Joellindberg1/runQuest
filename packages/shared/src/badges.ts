// Badgereglerna (ADR 009 beslut 1–3) — SSOT för serier, tiers, trösklar och kravtexter.
// Ren funktion: ingen I/O, ingen import från backend. Backend (evaluateBadges) och frontend
// (kravtexter) delar den. Trösklarna är startvärden som justeras efter dry-run (RUN-125).
//
// Att lägga till en serie = en post i BADGE_SERIES (och en post i BADGE_METRICS om måttet är nytt).
// Reglerna är PER TIER: olika tiers i samma serie kan ha olika mått och icke-monotona trösklar
// (Early Bird, Night Owl, Precisionist i RUN-116). Motorn (evaluateSeries) ändras inte.

/** Antal nivåer per serie. */
export const MAX_TIER = 6;

/** Visningsnamn per tier; index 0 = tier 1. */
export const TIER_NAMES = ['Common', 'Uncommon', 'Rare', 'Heroic', 'Epic', 'Legendary'] as const;

// ─── Indata ─────────────────────────────────────────────────────────────────────────────────────

/** Det motorn behöver veta om en runda. Fälten följer runs-tabellen (snake_case). */
export interface BadgeRun {
  id: string;
  /** Kalenderdag YYYY-MM-DD. */
  date: string;
  distance_km: number;
  /** Väggklocka som ISO-sträng; null för manuella rundor. Läses av Early Bird och Night Owl (wallClockMinutes). */
  start_time: string | null;
  /** Sekunder; null när okänt. Läses av Speedster. */
  moving_time: number | null;
  /** Meter; null när okänt (bara Strava-rundor har höjd). */
  total_elevation_gain: number | null;
  is_treadmill: boolean | null;
}

/** Värden som inte kan räknas ur rundorna (samma källa som users.longest_streak). */
export interface BadgeStats {
  longest_streak: number;
}

// ─── Mått ───────────────────────────────────────────────────────────────────────────────────────

export interface BadgeMeasurement {
  /** Mätvärdet i måttets skala (se BadgeMetricDef.scale). */
  value: number;
  /** Rundan som ensam gav värdet; bara för enrundsmått. */
  source_run_id?: string;
}

export interface BadgeMetricDef {
  /**
   * Tröskeln i serien anges i naturlig enhet (km, m, dagar); den multipliceras med `scale` och
   * avrundas innan jämförelsen. Distans och höjd mäts i hundradelar (scale 100) så att
   * flyttalssummor aldrig driver över en tröskel.
   */
  scale: number;
  /** null = inget att mäta (t.ex. inga rundor) och ger tier 0. */
  measure(runs: readonly BadgeRun[], stats: BadgeStats): BadgeMeasurement | null;
}

/** Hundradelar som heltal; ogiltiga (NaN, oändliga, negativa) värden räknas som 0. */
function toHundredths(value: number | null): number {
  if (value == null || !Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 100);
}

/**
 * Minuter sedan midnatt i löparens lokala väggklocka, ur `start_time`.
 * `start_time` är Strava `start_date_local` lagrad med falskt 'Z' (ADR 009 beslut 2): siffrorna ÄR
 * väggklockan. Klockslaget läses direkt ur strängen — ingen Date, alltså ingen konvertering till
 * någon tidszon (processens, DST, en angiven offset eller löparens). Null, rent datum utan klockslag
 * eller ogiltigt klockslag (manuella rundor) => null = ingen räkning.
 */
export function wallClockMinutes(startTime: string | null): number | null {
  if (!startTime) return null;
  const match = /T(\d{2}):(\d{2})/.exec(startTime);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Halvöppet fönster [start, slut) i minuter på dygnet. start > slut betyder att fönstret korsar
 * midnatt (t.ex. 23:30–00:30), då är rundan med om den ligger efter start ELLER före slut.
 */
function inWindow(minute: number, start: number, end: number): boolean {
  return start <= end ? minute >= start && minute < end : minute >= start || minute < end;
}

const hhmm = (h: number, m = 0): number => h * 60 + m;

/** Antal rundor vars väggklocka ligger i [start, slut); rundor utan start_time räknas inte. */
function countStartsInWindow(runs: readonly BadgeRun[], start: number, end: number): BadgeMeasurement {
  let count = 0;
  for (const run of runs) {
    const minute = wallClockMinutes(run.start_time);
    if (minute !== null && inWindow(minute, start, end)) count += 1;
  }
  return { value: count };
}

/** Hundradelar per hel km; "exakt hel km" avgörs med heltalsaritmetik, inte flyttal. */
const HUNDREDTHS_PER_KM = 100;

/** Antal rundor på exakt `hundredths` hundradelar (21,10 km = 2110). */
function exactDistanceRuns(runs: readonly BadgeRun[], hundredths: number): BadgeRun[] {
  return runs.filter((run) => toHundredths(run.distance_km) === hundredths);
}

export const BADGE_METRICS = {
  /** Längsta enskilda runda, hundradelar av km. */
  longest_run_km: {
    scale: 100,
    measure(runs) {
      let best: BadgeRun | null = null;
      let bestValue = -1;
      for (const run of runs) {
        const value = toHundredths(run.distance_km);
        // Strikt större: vid lika längd vinner den först angivna rundan.
        if (value > bestValue) {
          best = run;
          bestValue = value;
        }
      }
      return best ? { value: bestValue, source_run_id: best.id } : null;
    },
  },
  /** Summa distans, hundradelar av km. */
  total_distance_km: {
    scale: 100,
    measure(runs) {
      let sum = 0;
      for (const run of runs) sum += toHundredths(run.distance_km);
      return { value: sum };
    },
  },
  /** Summa höjdmeter, hundradelar av m; null räknas som 0. */
  total_elevation_m: {
    scale: 100,
    measure(runs) {
      let sum = 0;
      for (const run of runs) sum += toHundredths(run.total_elevation_gain);
      return { value: sum };
    },
  },
  /** Längsta svit i dagar. */
  longest_streak_days: {
    scale: 1,
    measure(_runs, stats) {
      const days = Number.isFinite(stats.longest_streak) ? Math.floor(stats.longest_streak) : 0;
      return { value: Math.max(0, days) };
    },
  },
  /** Early Bird tier 1–4: rundor med start [04:00, 07:00). */
  early_bird_runs: {
    scale: 1,
    measure: (runs) => countStartsInWindow(runs, hhmm(4), hhmm(7)),
  },
  /** Early Bird tier 5–6: rundor med start [04:00, 06:00). */
  early_bird_deep_runs: {
    scale: 1,
    measure: (runs) => countStartsInWindow(runs, hhmm(4), hhmm(6)),
  },
  /** Night Owl tier 1–4: rundor med start [21:00, 04:00), över midnatt. */
  night_owl_runs: {
    scale: 1,
    measure: (runs) => countStartsInWindow(runs, hhmm(21), hhmm(4)),
  },
  /** Night Owl tier 5: rundor med start [22:30, 04:00), över midnatt. */
  night_owl_late_runs: {
    scale: 1,
    measure: (runs) => countStartsInWindow(runs, hhmm(22, 30), hhmm(4)),
  },
  /** Night Owl tier 6: rundor med start [23:30, 00:30), över midnatt. */
  midnight_runs: {
    scale: 1,
    measure: (runs) => countStartsInWindow(runs, hhmm(23, 30), hhmm(0, 30)),
  },
  /**
   * Speedster: bästa moving_time (råa sekunder) bland rundor 4,90 <= km < 10,00. Samma kvalificering
   * som titeln fastest5km; en hel runda räknas, ingen splittid. moving_time <= 0/null/NaN ignoreras.
   * Skalan 60 gör att tröskeln i minuter jämförs mot sekunder.
   */
  best_5k_time: {
    scale: 60,
    measure(runs) {
      let best: BadgeRun | null = null;
      for (const run of runs) {
        const hundredths = toHundredths(run.distance_km);
        if (hundredths < 490 || hundredths >= 1000) continue;
        const seconds = run.moving_time;
        if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) continue;
        // Strikt snabbare: vid lika tid vinner den först angivna rundan.
        if (best === null || seconds < (best.moving_time as number)) best = run;
      }
      return best ? { value: best.moving_time as number, source_run_id: best.id } : null;
    },
  },
  /** Precisionist tier 1–4: rundor på exakt hel km, minst 1 km (distance % 100 === 0 i hundradelar). */
  exact_km_runs: {
    scale: 1,
    measure(runs) {
      let count = 0;
      for (const run of runs) {
        const hundredths = toHundredths(run.distance_km);
        if (hundredths >= HUNDREDTHS_PER_KM && hundredths % HUNDREDTHS_PER_KM === 0) count += 1;
      }
      return { value: count };
    },
  },
  /** Precisionist tier 5: rundor på exakt 21,10 km; tröskeln är 1, så första träffen ensam ger tiern. */
  exact_half_marathon_runs: {
    scale: 1,
    measure(runs) {
      const hits = exactDistanceRuns(runs, 2110);
      return hits.length > 0 ? { value: hits.length, source_run_id: hits[0].id } : { value: 0 };
    },
  },
  /** Precisionist tier 6: hur många av 10,00 / 21,10 / 42,20 km som träffats exakt (distinkta, max 3). */
  exact_classic_distances: {
    scale: 1,
    measure: (runs) => ({
      value: [1000, 2110, 4220].filter((hundredths) => exactDistanceRuns(runs, hundredths).length > 0).length,
    }),
  },
} satisfies Record<string, BadgeMetricDef>;

export type BadgeMetricKey = keyof typeof BADGE_METRICS;

// ─── Serier ─────────────────────────────────────────────────────────────────────────────────────

export type BadgeDirection = 'atLeast' | 'below';

/** Regeln för EN tier. Olika tiers i samma serie får ha olika mått och icke-monotona trösklar. */
export interface BadgeTierRule<M extends string = string> {
  /** Nyckel i måttregistret (BADGE_METRICS för de riktiga serierna). */
  metric: M;
  /** Tröskel i naturlig enhet (km, m, dagar, st …); multipliceras med måttets scale. */
  threshold: number;
  /** 'atLeast' (standard): mätvärde ≥ tröskel. 'below': mätvärde < tröskel (t.ex. bästa tid). */
  direction?: BadgeDirection;
}

/** Exakt en regel per tier, tier 1 först. */
export type BadgeTierRules<M extends string = string> = readonly [
  BadgeTierRule<M>,
  BadgeTierRule<M>,
  BadgeTierRule<M>,
  BadgeTierRule<M>,
  BadgeTierRule<M>,
  BadgeTierRule<M>,
];

export type BadgeThresholds = readonly [number, number, number, number, number, number];

/** Alla sex tiers delar mått och riktning; bara trösklarna skiljer (de flesta serier). */
export function uniformTiers<M extends string>(
  metric: M,
  thresholds: BadgeThresholds,
  direction?: BadgeDirection
): BadgeTierRules<M> {
  const rule = (threshold: number): BadgeTierRule<M> =>
    direction ? { metric, threshold, direction } : { metric, threshold };
  return [
    rule(thresholds[0]),
    rule(thresholds[1]),
    rule(thresholds[2]),
    rule(thresholds[3]),
    rule(thresholds[4]),
    rule(thresholds[5]),
  ];
}

export interface BadgeSeriesDef<K extends string = string, M extends string = string> {
  /** Lagras i user_badges.series — ändra aldrig i efterhand. */
  key: K;
  name: string;
  /** Nyckel till RQIcon (frontend); shared känner inte till ikonerna. */
  icon: string;
  tiers: BadgeTierRules<M>;
  /** Engelsk kravtext för en tier; får skilja sig åt mellan tiers med olika mått. */
  requirement: (threshold: number, tier: number) => string;
}

/** Registrerar en serie; `metric` typas mot BADGE_METRICS så att stavfel fångas av tsc. */
function defineBadgeSeries<K extends string>(
  def: BadgeSeriesDef<K, BadgeMetricKey>
): BadgeSeriesDef<K, BadgeMetricKey> {
  return def;
}

const formatNumber = (n: number): string => n.toLocaleString('en-US');

export const BADGE_SERIES = [
  defineBadgeSeries({
    key: 'milestoner',
    name: 'Milestoner',
    icon: 'flag',
    tiers: uniformTiers('longest_run_km', [5, 10, 21.1, 30, 42.2, 50]),
    requirement: (km) => `Run ${formatNumber(km)} km in a single run`,
  }),
  defineBadgeSeries({
    key: 'earth_trotter',
    name: 'Earth Trotter',
    icon: 'globe',
    tiers: uniformTiers('total_distance_km', [100, 500, 1000, 2000, 4015, 10000]),
    requirement: (km) => `Run ${formatNumber(km)} km in total`,
  }),
  defineBadgeSeries({
    key: 'climber',
    name: 'The Climber',
    icon: 'mountain',
    tiers: uniformTiers('total_elevation_m', [500, 1345, 4800, 5895, 8848, 17696]),
    requirement: (m) => `Climb ${formatNumber(m)} m in total`,
  }),
  defineBadgeSeries({
    key: 'streak_keeper',
    name: 'Streak Keeper',
    icon: 'flame',
    tiers: uniformTiers('longest_streak_days', [3, 7, 14, 30, 60, 100]),
    requirement: (days) => `Reach a ${formatNumber(days)}-day streak`,
  }),
  defineBadgeSeries({
    key: 'early_bird',
    name: 'Early Bird',
    icon: 'sun',
    // Tier 5–6 byter till det smalare fönstret 04:00–06:00 med tröskel 50/100 (icke-monotont mot tier 4).
    tiers: [
      { metric: 'early_bird_runs', threshold: 5 },
      { metric: 'early_bird_runs', threshold: 15 },
      { metric: 'early_bird_runs', threshold: 50 },
      { metric: 'early_bird_runs', threshold: 100 },
      { metric: 'early_bird_deep_runs', threshold: 50 },
      { metric: 'early_bird_deep_runs', threshold: 100 },
    ],
    // Slutminuten visas inklusive så att texten matchar det halvöppna fönstret [start, slut).
    requirement: (count, tier) =>
      `Start ${formatNumber(count)} runs between 04:00 and ${tier <= 4 ? '06:59' : '05:59'}`,
  }),
  defineBadgeSeries({
    key: 'night_owl',
    name: 'Night Owl',
    icon: 'moon',
    tiers: [
      { metric: 'night_owl_runs', threshold: 5 },
      { metric: 'night_owl_runs', threshold: 15 },
      { metric: 'night_owl_runs', threshold: 50 },
      { metric: 'night_owl_runs', threshold: 100 },
      { metric: 'night_owl_late_runs', threshold: 25 },
      { metric: 'midnight_runs', threshold: 10 },
    ],
    requirement: (count, tier) => {
      const window = tier <= 4 ? '21:00 and 03:59' : tier === 5 ? '22:30 and 03:59' : '23:30 and 00:29';
      return `Start ${formatNumber(count)} runs between ${window}`;
    },
  }),
  defineBadgeSeries({
    key: 'speedster',
    name: 'Speedster',
    icon: 'zap',
    tiers: uniformTiers('best_5k_time', [35, 30, 25, 22, 20, 18], 'below'),
    requirement: (minutes) => `A 5 km run in under ${minutes}:00`,
  }),
  defineBadgeSeries({
    key: 'precisionist',
    name: 'Precisionist',
    icon: 'target',
    tiers: [
      { metric: 'exact_km_runs', threshold: 3 },
      { metric: 'exact_km_runs', threshold: 10 },
      { metric: 'exact_km_runs', threshold: 25 },
      { metric: 'exact_km_runs', threshold: 50 },
      { metric: 'exact_half_marathon_runs', threshold: 1 },
      { metric: 'exact_classic_distances', threshold: 3 },
    ],
    requirement: (count, tier) => {
      if (tier === 5) return 'Run exactly 21.10 km in a single run';
      if (tier === 6) return 'Run exactly 10.00 km, 21.10 km and 42.20 km (one run each)';
      return `Finish ${formatNumber(count)} runs on an exact whole km`;
    },
  }),
];

export type BadgeSeriesKey = (typeof BADGE_SERIES)[number]['key'];

// ─── Utdata och motor ───────────────────────────────────────────────────────────────────────────

export interface BadgeTierResult {
  /** 0 = ej upplåst, annars 1..MAX_TIER. */
  tier: number;
  /** Rundan som gav tiern; bara när den högsta uppfyllda tierns mått är ett enrundsmått. */
  source_run_id?: string;
}

export type BadgeTiers = Record<BadgeSeriesKey, BadgeTierResult>;

export type BadgeMetricRegistry = Readonly<Record<string, BadgeMetricDef>>;

/**
 * Tier = högsta tier vars EGEN regel är uppfylld (reglerna är inte nästlade, ADR 009 beslut 2).
 * `metrics` är registret som reglernas `metric` slås upp i.
 */
export function evaluateSeries(
  series: BadgeSeriesDef,
  metrics: BadgeMetricRegistry,
  runs: readonly BadgeRun[],
  stats: BadgeStats
): BadgeTierResult {
  const measured = new Map<string, BadgeMeasurement | null>();
  let tier = 0;
  let sourceRunId: string | undefined;

  series.tiers.forEach((rule, index) => {
    const metric = metrics[rule.metric];
    if (!metric) {
      throw new Error(`Badge series "${series.key}" tier ${index + 1} refers to unknown metric "${rule.metric}"`);
    }
    if (!measured.has(rule.metric)) measured.set(rule.metric, metric.measure(runs, stats));
    const measurement = measured.get(rule.metric);
    if (!measurement || !Number.isFinite(measurement.value)) return;

    const scaled = Math.round(rule.threshold * metric.scale);
    const reached = rule.direction === 'below' ? measurement.value < scaled : measurement.value >= scaled;
    if (reached) {
      tier = index + 1;
      sourceRunId = measurement.source_run_id;
    }
  });

  if (tier === 0) return { tier: 0 };
  return sourceRunId === undefined ? { tier } : { tier, source_run_id: sourceRunId };
}

/** Motorn mot ett valfritt serie- och måttregister (computeBadgeTiers använder de riktiga). */
export function computeSeriesTiers(
  seriesList: readonly BadgeSeriesDef[],
  metrics: BadgeMetricRegistry,
  runs: readonly BadgeRun[],
  stats: BadgeStats
): Record<string, BadgeTierResult> {
  const result: Record<string, BadgeTierResult> = {};
  for (const series of seriesList) result[series.key] = evaluateSeries(series, metrics, runs, stats);
  return result;
}

export function computeBadgeTiers(runs: readonly BadgeRun[], stats: BadgeStats): BadgeTiers {
  return computeSeriesTiers(BADGE_SERIES, BADGE_METRICS, runs, stats) as BadgeTiers;
}

/** Engelsk kravtext för att nå `tier` (1..MAX_TIER) i serien. */
export function requirementText(series: BadgeSeriesDef, tier: number): string {
  if (!Number.isInteger(tier) || tier < 1 || tier > MAX_TIER) {
    throw new RangeError(`tier must be an integer 1..${MAX_TIER}, got ${tier}`);
  }
  return series.requirement(series.tiers[tier - 1].threshold, tier);
}

// ─── Läsvägen (GET /api/badges/*, ADR 009 beslut 4 och 7) ───────────────────────────────────────

/** Antal i gruppen per serie och tier: `holders[serie][t]` = medlemmar med tier ≥ t. */
export type BadgeHolders = Record<string, Record<number, number>>;

/** Det en lagrad user_badges-rad måste uppge för att räknas. */
export interface HeldBadge {
  series: string;
  tier: number;
}

/**
 * "Hålls av n i din pack" (ADR 009 beslut 7): per serie och tier t antalet rader med tier ≥ t, så att
 * en medlem på tier 3 räknas i 1–3. Svaret är ett fullständigt rutnät (alla kända serier x 1..MAX_TIER,
 * nollor inkluderade) så att klienten aldrig behöver gissa. Indata är en rad per (användare, serie);
 * okända serier och tier utanför 1..MAX_TIER ignoreras. Gruppavgränsningen sker av anroparen.
 */
export function countHolders(
  rows: readonly HeldBadge[],
  seriesKeys: readonly string[] = BADGE_SERIES.map((s) => s.key)
): BadgeHolders {
  const holders: BadgeHolders = {};
  for (const key of seriesKeys) {
    holders[key] = {};
    for (let tier = 1; tier <= MAX_TIER; tier += 1) holders[key][tier] = 0;
  }
  for (const row of rows) {
    const bySeries = holders[row.series];
    if (!bySeries || !Number.isInteger(row.tier) || row.tier < 1 || row.tier > MAX_TIER) continue;
    for (let tier = 1; tier <= row.tier; tier += 1) bySeries[tier] += 1;
  }
  return holders;
}

/** Högst så många badges visas på spelarkort och Board-rader (users_displayed_badge_series_max3). */
export const MAX_SHOWCASE = 3;

/**
 * Sparade `displayed_badge_series` skurna mot det användaren äger just nu (en serie kan ha återkallats
 * innan evaluateBadges hunnit rensa arrayen). Sparad ordning behålls; okända serier, dubbletter och
 * ägd tier 0 släpps; högst MAX_SHOWCASE.
 */
export function resolveShowcase(
  displayed: readonly string[] | null | undefined,
  ownedTiers: ReadonlyMap<string, number>
): HeldBadge[] {
  const known = new Set<string>(BADGE_SERIES.map((s) => s.key));
  const result: HeldBadge[] = [];
  for (const series of displayed ?? []) {
    const tier = ownedTiers.get(series) ?? 0;
    if (!known.has(series) || tier < 1 || result.some((r) => r.series === series)) continue;
    result.push({ series, tier });
    if (result.length === MAX_SHOWCASE) break;
  }
  return result;
}
