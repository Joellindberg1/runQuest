// Titelvärden och titelnamn som text. Ren logik — delas av Titles, Runner card och Profile.
// Måttnyckeln (`metric_key`, ur title-motorerna i backend) avgör enheten; värdena från backend är
// kodade för sortering (högre = bättre); kodningen och avkodningen ligger i @runquest/shared (titleMetrics), delad med backend.
import { MINUTES_PER_HOUR, SECONDS_PER_MINUTE, decodeTitleMetric, zoneDay } from '@runquest/shared';
import { formatDayMonth, formatKm } from '@/shared/utils/format';

/** Replace "King/Queen" in a title name based on the holder's gender. */
export function resolveGenderedTitle(name: string, gender?: string | null): string {
  if (!name.includes('King/Queen')) return name;
  if (gender === 'female') return name.replace('King/Queen', 'Queen');
  if (gender === 'male') return name.replace('King/Queen', 'King');
  return name;
}

/** Räknemått: singular vid exakt 1 ("1 run"), annars plural. */
function countText(value: number, singular: string, plural: string): string {
  const n = Math.round(value);
  return `${n} ${n === 1 ? singular : plural}`;
}

/** Format a title value for display given its metric_key (km-måtten har egna rader; okänt mått → bara talet). */
export function formatTitleValue(metricKey: string | undefined, value: number): string {
  switch (metricKey) {
    case 'nightRunCount':
    case 'earlyRunCount':
    case 'lunchRunCount':
    case 'stormRunCount':
    case 'coldRunCount':
      return countText(value, 'run', 'runs');
    case 'maxRunsOneWeek':
      return `${countText(value, 'run', 'runs')}/wk`;
    case 'maxWeekdayStreak':
      return countText(value, 'weekday', 'weekdays');
    case 'longestStreak':
      return countText(value, 'day', 'days');
    case 'totalElevationGain':
    case 'bestSingleRunElevation':
      return `${Math.round(value)}m`;
    case 'fastestMarathon':
    case 'fastestHalfMarathon': {
      const seconds = decodeTitleMetric(metricKey, value);
      if (seconds === null) return '—';
      const mins = Math.round(seconds / SECONDS_PER_MINUTE);
      return `${Math.floor(mins / MINUTES_PER_HOUR)}h${String(mins % MINUTES_PER_HOUR).padStart(2, '0')}m`;
    }
    case 'avgPaceStdDev': {
      const stdDev = decodeTitleMetric(metricKey, value);
      return stdDev === null ? '—' : `${stdDev.toFixed(1)}s/km std`;
    }
    case 'lastRunOfWeek': {
      const encoded = new Date(decodeTitleMetric(metricKey, value));
      // Ett värde som inte är ett datum (NaN, oändligt, utanför datumintervallet) får inte kasta i render: tankstreck som övriga saknade värden.
      if (Number.isNaN(encoded.getTime())) return '—';
      // Värdet är väggklockan kodad som UTC-sekunder (se calendar.ts): läs dagen i UTC, annars glider
      // sena kvällsrundor till nästa dag i zoner öster om UTC.
      return formatDayMonth(zoneDay(encoded, 'UTC'));
    }
    case 'fastest5km': {
      const totalSeconds = decodeTitleMetric(metricKey, value);
      if (totalSeconds === null) return '—';
      const mins = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
      const secs = totalSeconds % SECONDS_PER_MINUTE;
      return `${mins}:${String(secs).padStart(2, '0')}`;
    }
    case 'longestRun':
    case 'totalKm':
    case 'weekendAvg':
    case 'maxKmRolling30':
    case 'bestDoubleDayKm':
    case 'winterKm':
    case 'longestRunAfterBreak14':
    case 'longestRunAfterBreak30':
      return `${formatKm(value)}km`;
    // Ett mått utan känd enhet (en ny motor som inte lagts till här): hellre bara talet än en påhittad enhet.
    default:
      return String(Math.round(value * 10) / 10);
  }
}

/** Mått där värdet är kodat för sortering (tid, spridning, datum) — en differens vore meningslös. */
const NON_LINEAR_METRICS = new Set([
  'fastestMarathon', 'fastestHalfMarathon', 'fastest5km', 'avgPaceStdDev', 'lastRunOfWeek',
]);

/** Går skillnaden mellan två värden att läsa som ett tal i måttets enhet ("4 runs")? */
export function hasLinearGap(metricKey: string | undefined): boolean {
  return !!metricKey && !NON_LINEAR_METRICS.has(metricKey);
}

/** "32.8km" → "32.8 km" som i designen; saknas måttnyckeln visas bara talet (hellre ingen enhet än fel enhet). */
export function titleValueText(metricKey: string | undefined, value: number): string {
  if (!metricKey) return String(Math.round(value));
  return formatTitleValue(metricKey, value).replace(/(\d)km$/, '$1 km');
}

/** Tröskeln som ett lås-krav ("7 runs"). null när kravet inte går att uttrycka (inget krav, eller ett datum-kodat mått). */
export function unlockText(metricKey: string | undefined, requirement: number): string | null {
  if (!(requirement > 0) || metricKey === 'lastRunOfWeek') return null;
  return titleValueText(metricKey, requirement);
}
