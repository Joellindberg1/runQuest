// The pure part of the nightly reconcile (ADR 010 decision 13): from what the database holds and what Strava's activity list shows,
// which runs need a look at the single activity. No database, no network, no clock of its own ("now" comes from outside).
//
// The list is the cheap check: one request covers every run in the window. It only ever DECIDES WHAT TO LOOK AT; whether a run
// goes or is changed is decided by the activity update handler from the single activity (decideAction), never from the list.
import { addDays, daysBetween, stockholmDay, stockholmMidnightIso } from '@runquest/shared';
import { stravaDayIfValid } from '../../utils/stravaActivity.js';
import { exceedsImportDistance, isRunningActivity } from '../stravaImport.js';
import { sameStoredDistance } from '../stravaWebhook/decideAction.js';

/** The part of a stored Strava run the comparison reads. `distance` is km as the numeric(6,2) column holds it. */
export interface StoredRun {
  externalId: string;
  /** 'YYYY-MM-DD' */
  date: string;
  distance: number;
}

/** An element of the athlete's activity list (a summary), as far as the comparison reads it. Every field may be missing or wrong. */
export interface ListedActivity {
  id?: unknown;
  start_date_local?: unknown;
  distance?: unknown;
  sport_type?: unknown;
  type?: unknown;
}

export interface UserPlan {
  /** Listed, but not as stored: another date or distance, no longer a run, or not readable. The single activity says what that means. */
  changed: string[];
  /** Inside the checked part of the window and not in the list: deleted, private, or the list is wrong. The single activity says which. */
  missing: string[];
  /** Not covered by the list this night (older than the checked part of the window and not listed): the pool the rotation picks from. */
  older: StoredRun[];
}

/** Where the list starts: Stockholm midnight `windowDays` before today, as epoch seconds for the request and as a calendar day. */
export function reconcileWindow(now: Date, windowDays: number): { afterSeconds: number; startDay: string } {
  const startDay = addDays(stockholmDay(now), -windowDays);
  return { afterSeconds: Math.floor(Date.parse(stockholmMidnightIso(startDay)) / 1000), startDay };
}

/** The number of the Stockholm day, counting from the epoch day: what moves the rotation on, and the order of the users, one step a night. */
export function nightIndex(now: Date): number {
  return daysBetween('1970-01-01', stockholmDay(now));
}

function listedDate(activity: ListedActivity): string | null {
  return stravaDayIfValid(activity.start_date_local);
}

/**
 * Does the listed activity differ from the stored run, or can it not be read well enough to say it does not? Either way the single
 * activity is looked at: a wrong "same" would leave a changed run unnoticed, a wrong "differs" costs one request.
 */
function differs(run: StoredRun, activity: ListedActivity): boolean {
  const date = listedDate(activity);
  const metres = activity.distance;
  if (date === null || typeof metres !== 'number' || !Number.isFinite(metres)) return true;
  if (!isRunningActivity(activity) || !exceedsImportDistance({ distance: metres })) return true;
  return run.date !== date || !sameStoredDistance(run.distance, metres);
}

/**
 * Sorts the user's stored Strava runs against the list. The list was asked for from the start of the window, and a run on the
 * window's first calendar day is left out of "missing" (a day of margin): an activity started in another time zone can fall on that
 * day and still start before Stockholm midnight, and so not be in the list.
 */
export function planUser(runs: readonly StoredRun[], activities: readonly ListedActivity[], startDay: string): UserPlan {
  const listed = new Map<string, ListedActivity>();
  for (const activity of activities) {
    if (typeof activity.id === 'number' || typeof activity.id === 'string') listed.set(String(activity.id), activity);
  }
  const firstCheckedDay = addDays(startDay, 1);

  const plan: UserPlan = { changed: [], missing: [], older: [] };
  for (const run of runs) {
    const activity = listed.get(run.externalId);
    if (activity) {
      if (differs(run, activity)) plan.changed.push(run.externalId);
    } else if (run.date >= firstCheckedDay) {
      plan.missing.push(run.externalId);
    } else {
      plan.older.push(run);
    }
  }
  return plan;
}

/**
 * The runs of the older pool this night looks at: `count` of them, from a point that moves on by `count` every night and wraps
 * around the end of the pool (sorted by date, then id, so the same pool gives the same order). Nothing is stored between nights; the
 * night number is the position. A pool that grows or shrinks shifts the point a little, which costs nothing but an uneven turn.
 */
export function rotationSlice(pool: readonly StoredRun[], night: number, count: number): StoredRun[] {
  const size = pool.length;
  if (size === 0 || count <= 0) return [];
  const sorted = [...pool].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.externalId < b.externalId ? -1 : a.externalId > b.externalId ? 1 : 0));
  if (count >= size) return sorted;
  const start = ((night * count) % size + size) % size;
  return Array.from({ length: count }, (_, i) => sorted[(start + i) % size]);
}
