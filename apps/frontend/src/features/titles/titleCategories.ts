import type { RQIconName } from '@/shared/components/icons';

// Kategorierna är en frontend-mappning metric_key → grupp. Titelnamn och regler kommer ur databasen
// (ägarbeslut 3), men databasen har ingen kategori — mappningen lever här och en ny titel utan rad faller
// i 'other' i stället för att försvinna ur vyn. titleCategories.test.ts vaktar att alla motorer är mappade.

export type TitleCategoryId = 'time' | 'distance' | 'pace' | 'volume' | 'elevation' | 'consistency' | 'comeback' | 'other';

interface CategoryDef {
  id: TitleCategoryId;
  label: string;
  icon: RQIconName;
}

/** Ordningen är gruppernas ordning på skärmen; 'other' ligger sist. */
export const TITLE_CATEGORIES: readonly CategoryDef[] = [
  { id: 'time', label: 'Time of day', icon: 'clock' },
  { id: 'distance', label: 'Distance', icon: 'list' },
  { id: 'pace', label: 'Pace', icon: 'zap' },
  { id: 'volume', label: 'Volume', icon: 'sparkles' },
  { id: 'elevation', label: 'Elevation', icon: 'mountain' },
  { id: 'consistency', label: 'Consistency', icon: 'flame' },
  { id: 'comeback', label: 'Comeback', icon: 'sync' },
  { id: 'other', label: 'Other', icon: 'trophy' },
];

interface MetricDef {
  category: Exclude<TitleCategoryId, 'other'>;
  /** Titelns egen ikon (designen ritar en per titel); saknas den används kategorins. */
  icon?: RQIconName;
}

const METRICS: Record<string, MetricDef> = {
  nightRunCount: { category: 'time', icon: 'moon' },
  earlyRunCount: { category: 'time', icon: 'sun' },
  lunchRunCount: { category: 'time', icon: 'sun' },
  lastRunOfWeek: { category: 'time', icon: 'clock' },

  longestRun: { category: 'distance', icon: 'flag' },
  totalKm: { category: 'distance', icon: 'globe' },
  weekendAvg: { category: 'distance', icon: 'calendar' },
  maxKmRolling30: { category: 'distance', icon: 'trophy' },
  bestDoubleDayKm: { category: 'distance', icon: 'swords' },

  fastest5km: { category: 'pace', icon: 'zap' },
  fastestHalfMarathon: { category: 'pace', icon: 'zap' },
  fastestMarathon: { category: 'pace', icon: 'zap' },
  lowestPaceStdDev: { category: 'pace', icon: 'target' },
  avgPaceStdDev: { category: 'pace', icon: 'target' },

  maxRunsOneWeek: { category: 'volume', icon: 'sync' },

  totalElevationGain: { category: 'elevation', icon: 'mountain' },
  bestSingleRunElevation: { category: 'elevation', icon: 'mountain' },

  longestStreak: { category: 'consistency', icon: 'flame' },
  maxWeekdayStreak: { category: 'consistency', icon: 'calendar' },

  longestRunAfterBreak14: { category: 'comeback', icon: 'sparkles' },
  longestRunAfterBreak30: { category: 'comeback', icon: 'sparkles' },
};

/** Måttnycklarna som har en egen rad i mappningen (testet jämför dem mot motorregistret). */
export const MAPPED_METRIC_KEYS: readonly string[] = Object.keys(METRICS);

export function categoryOf(metricKey: string | undefined): TitleCategoryId {
  return (metricKey && METRICS[metricKey]?.category) || 'other';
}

export function iconOf(metricKey: string | undefined): RQIconName {
  const own = metricKey ? METRICS[metricKey]?.icon : undefined;
  if (own) return own;
  const category = TITLE_CATEGORIES.find((def) => def.id === categoryOf(metricKey));
  return category?.icon ?? 'trophy';
}
