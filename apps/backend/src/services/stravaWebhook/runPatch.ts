// What a Strava update may write to a run, and the guard that enforces it in every RunStore (ports.ts updateStravaRun).
//
// An update writes Strava's data only: the date, the distance and the extended fields (extractExtendedFields). The XP and streak
// columns (xp_gained, base_xp, km_xp, distance_bonus, streak_bonus, multiplier, streak_day) belong to the recalculation
// (reprocessRunsFromDate), which is the only writer of them. decideAction never puts one into its changes; this guard is the second
// line: a patch with any column outside the list is refused as a whole, before anything is read or written, so even a decision that
// went wrong cannot touch the XP. An allow-list, not a block-list: a column added to `runs` later is not writable by default.
import { extractExtendedFields } from '../stravaImport.js';

/** date and distance, plus every column extractExtendedFields returns (it follows that function, so a new extended column is covered). */
export const UPDATABLE_RUN_COLUMNS: readonly string[] = ['date', 'distance', ...Object.keys(extractExtendedFields({}))];

const UPDATABLE = new Set(UPDATABLE_RUN_COLUMNS);

/**
 * Returns the patch if every column is writable by an update; throws (code `run_patch_forbidden_column`) otherwise. The message
 * names the columns, never a value.
 */
export function assertUpdatableRunPatch(patch: object): Record<string, unknown> {
  const columns = Object.keys(patch);
  const forbidden = columns.filter((column) => !UPDATABLE.has(column));
  if (forbidden.length > 0) {
    throw Object.assign(new Error(`a Strava update may not write ${forbidden.join(', ')}`), { code: 'run_patch_forbidden_column' });
  }
  return { ...(patch as Record<string, unknown>) };
}
