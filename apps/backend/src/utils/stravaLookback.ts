import { addDays, stockholmDay, stockholmMidnightIso } from '@runquest/shared';

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

const RECENT_RUN_BUFFER_DAYS = 7;
const FALLBACK_DAYS = 30;
const DAY_PREFIX = /^\d{4}-\d{2}-\d{2}/;

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
    const anchorDay = addDays(mostRecentRunDay, -RECENT_RUN_BUFFER_DAYS);
    return { after: midnightSeconds(anchorDay), anchorDay, method: 'recent-run', mostRecentRunDay };
  }

  if (connectionDate) {
    const connected = new Date(connectionDate);
    if (!Number.isNaN(connected.getTime())) {
      const anchorDay = stockholmDay(connected);
      return { after: midnightSeconds(anchorDay), anchorDay, method: 'connection-date' };
    }
  }

  const anchorDay = addDays(stockholmDay(now), -FALLBACK_DAYS);
  return { after: midnightSeconds(anchorDay), anchorDay, method: 'fallback-30-days' };
}
