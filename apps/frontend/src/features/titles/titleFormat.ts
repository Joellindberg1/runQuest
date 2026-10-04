// Titelvärden och titelnamn som text. Ren logik — delas av Titles, Runner card och Profile.
// Måttnyckeln (`metric_key`, ur title-motorerna i backend) avgör enheten; värdena från backend är
// kodade för sortering (högre = bättre), så tider och spridning avkodas här.

/** Replace "King/Queen" in a title name based on the holder's gender. */
export function resolveGenderedTitle(name: string, gender?: string | null): string {
  if (!name.includes('King/Queen')) return name;
  if (gender === 'female') return name.replace('King/Queen', 'Queen');
  if (gender === 'male') return name.replace('King/Queen', 'King');
  return name;
}

/** Format a title value for display given its metric_key (km-måtten har egna rader; okänt mått → bara talet). */
export function formatTitleValue(metricKey: string | undefined, value: number): string {
  switch (metricKey) {
    case 'nightRunCount':
    case 'earlyRunCount':
    case 'lunchRunCount':
      return `${Math.round(value)} runs`;
    case 'maxRunsOneWeek':
      return `${Math.round(value)} runs/wk`;
    case 'maxWeekdayStreak':
      return `${Math.round(value)} weekdays`;
    case 'longestStreak':
      return `${Math.round(value)} days`;
    case 'totalElevationGain':
    case 'bestSingleRunElevation':
      return `${Math.round(value)}m`;
    case 'fastestMarathon': {
      if (value < -100) return '—';
      const mins = Math.round(720 - value);
      return `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}m`;
    }
    case 'fastestHalfMarathon': {
      if (value < -100) return '—';
      const mins = Math.round(360 - value);
      return `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}m`;
    }
    case 'lowestPaceStdDev':
    case 'avgPaceStdDev': {
      if (value <= 0) return '—';
      const stdDev = (10000 / value).toFixed(1);
      return `${stdDev}s/km std`;
    }
    case 'lastRunOfWeek': {
      const d = new Date(value * 1000);
      return d.toLocaleDateString('sv-SE', { month: 'short', day: 'numeric' });
    }
    case 'fastest5km': {
      if (value < -100) return '—';
      const totalSeconds = Math.round((60 - value) * 60);
      const mins = Math.floor(totalSeconds / 60);
      const secs = totalSeconds % 60;
      return `${mins}:${String(secs).padStart(2, '0')}`;
    }
    case 'longestRun':
    case 'totalKm':
    case 'weekendAvg':
    case 'maxKmRolling30':
    case 'bestDoubleDayKm':
    case 'longestRunAfterBreak14':
    case 'longestRunAfterBreak30':
      return `${value.toFixed(1)}km`;
    // Ett mått utan känd enhet (en ny motor som inte lagts till här): hellre bara talet än en påhittad enhet.
    default:
      return String(Math.round(value * 10) / 10);
  }
}

/** Mått där värdet är kodat för sortering (tid, spridning, datum) — en differens vore meningslös. */
const NON_LINEAR_METRICS = new Set([
  'fastestMarathon', 'fastestHalfMarathon', 'fastest5km', 'lowestPaceStdDev', 'avgPaceStdDev', 'lastRunOfWeek',
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
