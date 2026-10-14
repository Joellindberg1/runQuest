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
 * How often the scheduler syncs Strava, in minutes. The name carries the unit and the scheduler builds its cron expression from it.
 * RUN-265 (S29) moves to hours: rename this to STRAVA_POLL_INTERVAL_HOURS = 12, change stravaPollCron below
 * to run at minute 0 of every 12th hour, redo the next-sync estimate in scheduler/stravaSync.ts, and update the texts that say
 * "every 30 minutes" (playbookFacts.ts and the landing text). The privacy text already says "at least every 12 hours" (true before and
 * after) and is checked against this constant in rules.test.ts.
 */
export const STRAVA_POLL_INTERVAL_MINUTES = 30;

/**
 * How long the journal of Strava webhook events (strava_webhook_events) keeps a row, in days (ADR 010 decision 11): handled events
 * (`done`) and events that failed (`dead`). The privacy text (retention section) is built from these, and the nightly retention job
 * for the journal must use the same values.
 */
export const WEBHOOK_RETENTION_DONE_DAYS = 30;
export const WEBHOOK_RETENTION_FAILED_DAYS = 90;

/**
 * The cron expression the scheduler runs on: every `minutes` minutes (default STRAVA_POLL_INTERVAL_MINUTES). The scheduler takes its
 * schedule from here, not from its own string.
 *
 * TODO(RUN-265): this, and scheduler/stravaSync.ts computeNextSync (now plus N minutes), only fit an interval in minutes. When the
 * interval is in hours, redo both: the cron fires at fixed clock times, so the next slot has to be computed from the cron expression,
 * not as now plus the interval.
 */
export function stravaPollCron(minutes: number = STRAVA_POLL_INTERVAL_MINUTES): string {
  return `*/${minutes} * * * *`;
}
