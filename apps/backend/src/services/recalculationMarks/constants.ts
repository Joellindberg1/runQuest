// The recalculation recovery job (RUN-322): the numbers in one place.

/**
 * 04:05 every night, Europe/Stockholm: ten minutes before the nightly reconcile (04:15), so a recalculation the last night left
 * behind is finished before the reconcile looks at the same user again. Free of the other jobs (streak 03:00, webhook retention 03:30).
 * The job also runs once at start, so a restart after a crash does not wait for the night.
 */
export const RECOVERY_CRON = '5 4 * * *';

/**
 * Most marks one run takes care of. A recalculation is a reprocess of every run from the date on plus the user's totals, so a run
 * is bounded: with a handful of users the cap is never reached, and if it ever is (a fault that marks everyone) the rest waits for
 * the next run instead of one run holding the database busy for minutes. The marks are taken oldest first, so none starves.
 */
export const RECOVERY_MAX_PER_RUN = 20;
