import { addDays, stockholmDay, stockholmMidnightIso, STRAVA_LOOKBACK_BUFFER_DAYS } from '@runquest/shared';

export type LookbackMethod = 'recent-run' | 'connection-date' | 'fallback-30-days';

export interface StravaLookback {
  /** Unix-sekunder för Strava-anropets `after`: Stockholm-midnatt på `anchorDay`. */
  after: number;
  /** Kalenderdagen (YYYY-MM-DD) som fönstret börjar på. */
  anchorDay: string;
  method: LookbackMethod;
  /** Senaste importerade rundans dag, när fönstret räknas från den. */
  mostRecentRunDay?: string;
}

const FALLBACK_DAYS = 30;
const DAY_PREFIX = /^\d{4}-\d{2}-\d{2}/;

/**
 * Anslutningsdagen: Stockholm-kalenderdagen för `strava_tokens.connection_date`, eller null när värdet saknas eller inte går att
 * läsa. ENDA omvandlingen: hämtningsfönstret nedan och webhook-reglerna (decideAction) använder den.
 */
export function connectionDay(connectionDate: string | null | undefined): string | null {
  if (!connectionDate) return null;
  const connected = new Date(connectionDate);
  return Number.isNaN(connected.getTime()) ? null : stockholmDay(connected);
}

const midnightSeconds = (day: string): number => Math.floor(Date.parse(stockholmMidnightIso(day)) / 1000);

/**
 * Var Strava-hämtningen ska börja: 7 dagar före senaste importerade rundan, annars anslutningsdagen, annars 30 dagar före
 * `now`. Alla gränser är Stockholm-kalenderdagar (kl 00:00 lokal tid), inte serverprocessens tidszon — `runs.date` är en
 * kalenderdag och användarna bor i Stockholm. Ren funktion: "nu" kommer utifrån.
 */
export function stravaLookback(
  runDates: readonly string[],
  connectionDate: string | null | undefined,
  now: Date,
): StravaLookback {
  const days = runDates.filter(d => typeof d === 'string' && DAY_PREFIX.test(d)).map(d => d.slice(0, 10));
  if (days.length > 0) {
    const mostRecentRunDay = days.reduce((latest, d) => (d > latest ? d : latest));
    const anchorDay = addDays(mostRecentRunDay, -STRAVA_LOOKBACK_BUFFER_DAYS);
    return { after: midnightSeconds(anchorDay), anchorDay, method: 'recent-run', mostRecentRunDay };
  }

  const connectedOn = connectionDay(connectionDate);
  if (connectedOn) return { after: midnightSeconds(connectedOn), anchorDay: connectedOn, method: 'connection-date' };

  const anchorDay = addDays(stockholmDay(now), -FALLBACK_DAYS);
  return { after: midnightSeconds(anchorDay), anchorDay, method: 'fallback-30-days' };
}
