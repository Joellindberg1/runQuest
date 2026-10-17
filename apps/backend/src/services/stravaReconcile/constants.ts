// The nightly reconcile of Strava runs against Strava (ADR 010 decision 13, D12): the numbers in one place.

/**
 * 04:15 every night, Europe/Stockholm. Free of the other jobs: the streak job runs at 03:00, the webhook retention and the
 * subscription check at 03:30, and the weather backfill ticks on :00 and :30 (04:15 is neither).
 */
export const RECONCILE_CRON = '15 4 * * *';

/**
 * How far back the activity list reaches each night, in days. The list answers "which of these runs still exist and are unchanged?"
 * for every run in the window with one request (one page holds 200 activities of any sport). 30 days = the polling's own fallback
 * lookback, and far more than the 48 h Strava allows a deletion to take: a webhook that was missed is caught the first night, and
 * a run that failed to be confirmed for a few nights (Strava down, the user's token broken) is still inside the window when it
 * works again. Runs older than the window are checked by the rotation instead (RECONCILE_OLD_RUNS_PER_USER).
 */
export const RECONCILE_WINDOW_DAYS = 30;

/**
 * Every Strava request one night may spend, the list pages, the checks of single activities and a token renewal together
 * (ADR 010 decision 9). 400 is 13 % of the 3 000 reads a day and well under the webhook soft limit of 2 100, so the webhooks and
 * the 12 h polling keep their room; with 6 users the night needs about 130 (a list and the rotation for each), so there is room for
 * three times as many users before the budget starts to cut the rotation down.
 */
export const RECONCILE_NIGHTLY_REQUEST_BUDGET = 400;

/**
 * How many runs older than the window one user has checked a night (one `GET /activities/:id` each). The rotation moves on by this
 * many every night through the user's old runs, so a user with 300 old runs has all of them checked within 15 nights, with 1 000
 * within 50. The count shrinks when the budget is short (fairly over the users), never grows.
 */
export const RECONCILE_OLD_RUNS_PER_USER = 20;

/**
 * How many runs in doubt (missing from the list, or changed) one user may have looked at beyond their even share of what is left of the
 * night's budget. A user whose list comes back empty by a Strava fault has all runs of the window "missing"; without a bound they would
 * spend the whole night's requests on 404-checks before the others have even been listed. What is cut waits for the next nights.
 */
export const RECONCILE_IN_DOUBT_MARGIN = 5;

/**
 * The most runs one user loses to one night. Every deletion is confirmed by a 404 from Strava, but the night deletes without a person
 * looking, so a wrong 404 on a user's activities (a Strava fault, a token that suddenly cannot see what it saw) must not be able to
 * empty a history in one go. Past the cap the night leaves the rest for the next one and says so in the log; a user who really did
 * delete more than this on Strava gets the rest removed the following nights, well inside what the webhooks do not cover anyway.
 */
export const RECONCILE_MAX_REMOVALS_PER_USER = 10;

/** Strava's page size for the activity list (its maximum). */
export const RECONCILE_LIST_PAGE_SIZE = 200;

/**
 * How many pages of the list one user may take. A list that is still full after this many is treated as cut short and the user is
 * left alone that night: what is missing from a cut list proves nothing. 1 000 activities in 30 days is far from any runner.
 */
export const RECONCILE_MAX_LIST_PAGES = 5;

/**
 * What the budget share of a user sets aside for each user still to come: their list (almost always one page). The first users
 * cannot spend the budget the last ones need to even list.
 */
export const RECONCILE_LIST_RESERVE_PER_USER = 1;

/** Why a night ended before every user was done: its own request budget is spent, or Strava's read budget is over its soft limit (or answered 429). */
export type ReconcileStopReason = 'budget' | 'rate_limit';
