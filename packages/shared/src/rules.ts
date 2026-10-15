import { addDays, stockholmClock, stockholmWallClockToInstant } from './calendar.js';

// Game rules that several places state or enforce. One definition here: the backend imports the values, Playbook and the privacy text
// are tested against them (packages/shared/src/__tests__/rules.test.ts, apps/frontend/src/features/playbook/playbookFacts.test.ts).
// Change a value here and the tests name the texts that have to follow.

/** Strava sport types that are imported as runs. Treadmill runs are among them and are marked via STRAVA_TREADMILL_FLAG. */
export const STRAVA_RUN_SPORT_TYPES = ['Run', 'TrailRun', 'VirtualRun'] as const;

/** Old Strava activities have no sport_type; they count as runs only when their `type` is this. */
export const STRAVA_LEGACY_RUN_TYPE = 'Run';

/** A Strava activity is imported only when its distance in km is greater than this. There is no other distance limit on Strava runs. */
export const STRAVA_DISTANCE_MUST_EXCEED_KM = 0;

/** Minimum distance in km for a run logged by hand (inclusive). Strava runs are not held to it. */
export const MANUAL_RUN_MIN_DISTANCE_KM = 1.0;

/** The Strava activity field that is `true` for a treadmill run. */
export const STRAVA_TREADMILL_FLAG = 'trainer';

/** Each sync looks back this many calendar days before the most recent imported run, so a missed activity is picked up. */
export const STRAVA_LOOKBACK_BUFFER_DAYS = 7;

/**
 * How often the scheduler checks Strava as a backup to the webhooks, in hours (ADR 010 decision 6). The name carries the unit. It has to
 * divide 24 evenly: the cron fires at fixed clock times (minute 0 of every Nth hour, Europe/Stockholm), so any other value would
 * give slots that differ from day to day. The scheduler, the next-sync estimate, Playbook, Settings and the landing text are all
 * built from this constant; the privacy text says "at least every 12 hours" and is checked against it in rules.test.ts.
 */
export const STRAVA_POLL_INTERVAL_HOURS = 12;

/**
 * How long the journal of Strava webhook events (strava_webhook_events) keeps a row, in days (ADR 010 decision 11): handled events
 * (`done`) and events that failed (`dead`). The privacy text (retention section) is built from these, and the nightly retention job
 * for the journal must use the same values.
 */
export const WEBHOOK_RETENTION_DONE_DAYS = 30;
export const WEBHOOK_RETENTION_FAILED_DAYS = 90;

const HOURS_PER_DAY = 24;
const MS_PER_HOUR = 3_600_000;

function assertDividesDay(hours: number): void {
  if (!Number.isInteger(hours) || hours < 1 || hours > HOURS_PER_DAY || HOURS_PER_DAY % hours !== 0) {
    throw new RangeError(`The Strava poll interval must be a whole number of hours that divides 24 evenly, got ${hours}`);
  }
}

/** "12 hours" (or "1 hour"): the interval as the texts name it. RangeError for a value that does not divide 24. */
export function stravaPollIntervalLabel(hours: number = STRAVA_POLL_INTERVAL_HOURS): string {
  assertDividesDay(hours);
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

/**
 * The cron expression the scheduler runs on: minute 0 of every `hours`th hour. The scheduler runs it with timezone Europe/Stockholm,
 * so the slots are wall-clock times (00:00 and 12:00 for 12 hours). RangeError for a value that does not divide 24.
 */
export function stravaPollCron(hours: number = STRAVA_POLL_INTERVAL_HOURS): string {
  assertDividesDay(hours);
  return hours === HOURS_PER_DAY ? '0 0 * * *' : `0 */${hours} * * *`;
}

/**
 * The next moment the poll cron fires, strictly after `from`. The slots are Stockholm wall-clock times (stravaPollCron), so this is
 * not `from` plus the interval: after a restart at 14:37 the next slot is 00:00. A moment exactly on a slot gives the slot one
 * interval later. Daylight saving nights keep the wall-clock time (13 h or 11 h between 00:00 and 12:00).
 */
export function nextStravaPollSlot(from: Date, hours: number = STRAVA_POLL_INTERVAL_HOURS): Date {
  assertDividesDay(hours);
  const { date, msIntoDay } = stockholmClock(from);
  const nextSlotHour = (Math.floor(msIntoDay / (hours * MS_PER_HOUR)) + 1) * hours;
  return nextSlotHour < HOURS_PER_DAY
    ? stockholmWallClockToInstant(date, nextSlotHour)
    : stockholmWallClockToInstant(addDays(date, 1), 0);
}
