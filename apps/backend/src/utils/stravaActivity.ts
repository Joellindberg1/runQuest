import { STRAVA_TREADMILL_FLAG } from '@runquest/shared';

/**
 * Is this Strava activity a treadmill run? The one place that reads the flag (STRAVA_TREADMILL_FLAG in shared/rules.ts): the import,
 * event qualification and the treadmill backfill all ask here. Only a real `true` counts; a missing field or the string 'true' does not.
 * Lives in backend rather than shared so the single-source tests can swap the flag name.
 */
export function isTreadmillActivity(activity: Record<string, unknown> | null | undefined): boolean {
  return activity?.[STRAVA_TREADMILL_FLAG] === true;
}
