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
  /** Väggklocka som ISO-sträng; null för manuella rundor. Används inte av serierna i RUN-115. */
  start_time: string | null;
  /** Sekunder; null när okänt. Används inte av serierna i RUN-115. */
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
