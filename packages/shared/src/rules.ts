import { MS_HOUR, addDays, stockholmClock, stockholmWallClockToInstant } from './calendar.js';

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

/** The earliest calendar day a run can be logged (the project start). The backend refuses earlier dates; the forms and Playbook say the same. */
export const MIN_RUN_DATE = '2025-06-01';

/** MIN_RUN_DATE as the backend's error message writes it. rules.test.ts checks that the two name the same day. */
export const MIN_RUN_DATE_LABEL = 'June 1, 2025';

/** How many titles a user can show on the leaderboard card. */
export const MAX_DISPLAYED_TITLES = 3;

/** A password needs at least this many characters (new user, password change and admin reset). */
export const PASSWORD_MIN_LENGTH = 6;

/** The largest profile picture, in bytes. The storage bucket's limit (migration 051) is the same value. */
export const PROFILE_PICTURE_MAX_BYTES = 5 * 1024 * 1024;

/** The image types a profile picture can have, each with the file extension it is stored under. The bucket's allowed types (migration 051) match. */
export const PROFILE_PICTURE_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export const PROFILE_PICTURE_MIME_TYPES: readonly string[] = Object.keys(PROFILE_PICTURE_EXTENSIONS);

/**
 * Two storm thresholds, deliberately different. The Stormborn title counts a run as a storm run from wind gusts of this many m/s
 * (the title engine stormRunCount). The value is the title's; the event below has its own.
 */
export const STORM_GUST_MS = 12;

/** The Storm Chaser event counts a forecast hour as gusty from this many m/s (four such daytime hours trigger the event). */
export const STORM_EVENT_GUST_MS = 15;

/** A legendary challenge nobody answers starts on its own this many days after it was sent (challengeScheduler). */
export const LEGENDARY_AUTO_START_DAYS = 4;

/** An unanswered minor or major challenge lapses this many days after it was created, and the token goes back to the challenger. */
export const UNANSWERED_CHALLENGE_LAPSE_DAYS = 3;

/** A streak multiplier is stored as numeric(3,2): 1 to 9.99 with at most two decimals. */
export const MULTIPLIER_MIN = 1;
export const MULTIPLIER_MAX = 9.99;

/** 'range' = not a finite number, below MULTIPLIER_MIN or above MULTIPLIER_MAX; 'decimals' = in range but with more than two decimals. */
export type MultiplierProblem = 'range' | 'decimals';

/** What is wrong with a streak multiplier, or null when the database takes it. Anything that is not a number is a range problem. */
export function multiplierProblem(value: unknown): MultiplierProblem | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < MULTIPLIER_MIN || value > MULTIPLIER_MAX) return 'range';
  // numeric(3,2) rounds extra decimals silently, so they are refused instead.
  if (Math.round(value * 100) / 100 !== value) return 'decimals';
  return null;
}

export function isValidMultiplier(value: unknown): value is number {
  return multiplierProblem(value) === null;
}

const HOURS_PER_DAY = 24;

// Below three hours the cron and the slot computation disagree on the daylight saving night (a 02:00 slot that does not exist in
// spring, or exists twice in autumn), so only intervals that are verified against both are accepted.
const MIN_POLL_INTERVAL_HOURS = 3;

function assertDividesDay(hours: number): void {
  if (!Number.isInteger(hours) || hours < MIN_POLL_INTERVAL_HOURS || hours > HOURS_PER_DAY || HOURS_PER_DAY % hours !== 0) {
    throw new RangeError(`The Strava poll interval must be 3, 4, 6, 8, 12 or 24 hours (a whole number from 3 that divides 24 evenly), got ${hours}`);
  }
}

/** "12 hours": the interval as the texts name it. RangeError for a value that is not 3, 4, 6, 8, 12 or 24. */
export function stravaPollIntervalLabel(hours: number = STRAVA_POLL_INTERVAL_HOURS): string {
  assertDividesDay(hours);
  return `${hours} hours`;
}

/**
 * The cron expression the scheduler runs on: minute 0 of every `hours`th hour. The scheduler runs it with timezone Europe/Stockholm,
 * so the slots are wall-clock times (00:00 and 12:00 for 12 hours). RangeError for a value that is not 3, 4, 6, 8, 12 or 24.
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
  const nextSlotHour = (Math.floor(msIntoDay / (hours * MS_HOUR)) + 1) * hours;
  return nextSlotHour < HOURS_PER_DAY
    ? stockholmWallClockToInstant(date, nextSlotHour)
    : stockholmWallClockToInstant(addDays(date, 1), 0);
}
