// Badgereglerna (ADR 009 beslut 1–3) — SSOT för serier, tiers, trösklar och kravtexter.
// Ren funktion: ingen I/O, ingen import från backend. Backend (evaluateBadges) och frontend
// (kravtexter) delar den. Trösklarna är startvärden som justeras efter dry-run (RUN-125).
//
// Att lägga till en serie = en post i BADGE_SERIES (och en post i BADGE_METRICS om måttet är nytt).
// Motorn (evaluateSeries/computeBadgeTiers) ändras inte.

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

export type BadgeThresholds = readonly [number, number, number, number, number, number];

export interface BadgeRule {
  /** Nyckel i BADGE_METRICS. */
  metric: string;
  /** 'atLeast' (standard): mätvärde ≥ tröskel. 'below': mätvärde < tröskel (t.ex. bästa tid). */
  direction?: 'atLeast' | 'below';
  /** Tröskel för tier 1–6 i naturlig enhet; stigande för 'atLeast', fallande för 'below'. */
  thresholds: BadgeThresholds;
}

export interface BadgeSeriesDef<K extends string = string> {
  /** Lagras i user_badges.series — ändra aldrig i efterhand. */
  key: K;
  name: string;
  /** Nyckel till RQIcon (frontend); shared känner inte till ikonerna. */
  icon: string;
  rule: BadgeRule;
  /** Engelsk kravtext för en tröskel. */
  requirement: (threshold: number) => string;
}

function defineBadgeSeries<K extends string>(def: BadgeSeriesDef<K>): BadgeSeriesDef<K> {
  return def;
}

const formatNumber = (n: number): string => n.toLocaleString('en-US');

export const BADGE_SERIES = [
  defineBadgeSeries({
    key: 'milestoner',
    name: 'Milestoner',
    icon: 'flag',
    rule: { metric: 'longest_run_km', thresholds: [5, 10, 21.1, 30, 42.2, 50] },
    requirement: (km) => `Run ${formatNumber(km)} km in a single run`,
  }),
  defineBadgeSeries({
    key: 'earth_trotter',
    name: 'Earth Trotter',
    icon: 'globe',
    rule: { metric: 'total_distance_km', thresholds: [100, 500, 1000, 2000, 4015, 10000] },
    requirement: (km) => `Run ${formatNumber(km)} km in total`,
  }),
  defineBadgeSeries({
    key: 'climber',
    name: 'The Climber',
    icon: 'mountain',
    rule: { metric: 'total_elevation_m', thresholds: [500, 1345, 4800, 5895, 8848, 17696] },
    requirement: (m) => `Climb ${formatNumber(m)} m in total`,
  }),
  defineBadgeSeries({
    key: 'streak_keeper',
    name: 'Streak Keeper',
    icon: 'flame',
    rule: { metric: 'longest_streak_days', thresholds: [3, 7, 14, 30, 60, 100] },
    requirement: (days) => `Reach a ${formatNumber(days)}-day streak`,
  }),
];

export type BadgeSeriesKey = (typeof BADGE_SERIES)[number]['key'];

// ─── Utdata och motor ───────────────────────────────────────────────────────────────────────────

export interface BadgeTierResult {
  /** 0 = ej upplåst, annars 1..MAX_TIER. */
  tier: number;
  /** Rundan som gav tiern; bara för enrundsserier och bara när tier > 0. */
  source_run_id?: string;
}

export type BadgeTiers = Record<BadgeSeriesKey, BadgeTierResult>;

/** Tier = högsta tier vars regel är uppfylld (reglerna behöver inte vara nästlade). */
export function evaluateSeries(
  series: BadgeSeriesDef,
  metric: BadgeMetricDef,
  runs: readonly BadgeRun[],
  stats: BadgeStats
): BadgeTierResult {
  const measurement = metric.measure(runs, stats);
  if (!measurement || !Number.isFinite(measurement.value)) return { tier: 0 };

  const below = series.rule.direction === 'below';
  let tier = 0;
  series.rule.thresholds.forEach((threshold, index) => {
    const scaled = Math.round(threshold * metric.scale);
    const reached = below ? measurement.value < scaled : measurement.value >= scaled;
    if (reached) tier = index + 1;
  });

  if (tier === 0) return { tier: 0 };
  return measurement.source_run_id === undefined
    ? { tier }
    : { tier, source_run_id: measurement.source_run_id };
}

export function computeBadgeTiers(runs: readonly BadgeRun[], stats: BadgeStats): BadgeTiers {
  const metrics: Record<string, BadgeMetricDef> = BADGE_METRICS;
  const result: Record<string, BadgeTierResult> = {};
  for (const series of BADGE_SERIES) {
    const metric = metrics[series.rule.metric];
    if (!metric) throw new Error(`Badge series "${series.key}" refers to unknown metric "${series.rule.metric}"`);
    result[series.key] = evaluateSeries(series, metric, runs, stats);
  }
  return result as BadgeTiers;
}

/** Engelsk kravtext för att nå `tier` (1..MAX_TIER) i serien. */
export function requirementText(series: BadgeSeriesDef, tier: number): string {
  if (!Number.isInteger(tier) || tier < 1 || tier > MAX_TIER) {
    throw new RangeError(`tier must be an integer 1..${MAX_TIER}, got ${tier}`);
  }
  return series.requirement(series.rule.thresholds[tier - 1]);
}
