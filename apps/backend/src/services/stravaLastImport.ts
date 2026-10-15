// When the user's newest Strava run came in, for GET /strava/status (`last_import_at`). Per user, whether the run arrived by webhook or by
// polling, and always true even after a deploy (it is read from the runs, not from the scheduler's memory).
import { getSupabaseClient } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { errorCode } from '../utils/errorCode.js';

/**
 * The newest `runs.created_at` among the user's Strava runs as an ISO string, or null when there is none. created_at is the import
 * time (the column defaults to now() and buildStravaRunRow sets it when the run is inserted; nothing rewrites it), never the activity's
 * `date`, so a late-arriving old activity counts as a fresh import. A failed read never throws: the status as a whole is still worth
 * answering, so the value is null and the warning carries the error code only.
 */
export async function getLastStravaImportAt(userId: string): Promise<string | null> {
  try {
    const { data, error } = await getSupabaseClient()
      .from('runs')
      .select('created_at')
      .eq('user_id', userId)
      .eq('source', 'strava')
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) {
      logger.warn(`⚠️ Could not read the time of the last Strava import (${errorCode(error)})`);
      return null;
    }
    const createdAt: unknown = data?.[0]?.created_at;
    return typeof createdAt === 'string' ? createdAt : null;
  } catch (error) {
    logger.warn(`⚠️ Could not read the time of the last Strava import (${errorCode(error)})`);
    return null;
  }
}
