/**
 * The Strava webhook worker (ADR 010 decisions 6, 9 and 11): pure orchestration over the ports in stravaWebhook/ports.ts.
 * The POST route only stores an event; this worker processes it afterwards, once in effect, with retry, without colliding with
 * the polling (the per-user lock) or with itself (claim + lease in the database).
 *
 * ── HANDLER CONTRACT (what the create, update, delete and deauthorize handlers plug into) ───────────────────────────────────
 * A handler is registered in stravaWebhook/handlers.ts under webhookHandlerKey(object_type, aspect_type) and is
 *   (ctx: WebhookHandlerContext) => Promise<WebhookHandlerResult>
 * It gets the event row, the user id stored at receipt (never look the athlete up again), `attempts` (failed attempts BEFORE this
 * try, an expired lease counted as one: pass it to decideAction), and the ports it may use: `strava` (token, activity, athlete)
 * and `runs` (findRun, earliestRunDate). It does its writes to `runs` itself. It gets NO event store: it never sets a status.
 * It returns one of
 *   { status: 'done',  outcome, recalculateFrom, recalculateUnknown? }  the event is finished with this outcome (WEBHOOK_OUTCOMES);
 *        `recalculateFrom` is the earliest date ('YYYY-MM-DD') whose runs changed, or null; `recalculateUnknown` is decideAction's
 *        flag for "a run may have changed but I cannot tell the date".
 *   { status: 'retry', error }  a failed attempt; `error` is a short CODE (never a token, a body or a message).
 *   { status: 'wait', kind: 'rate_limit' | 'daily_limit' }  Strava said wait (429, or the budget): not a failure.
 * A handler that throws is a failed attempt with the error's code (never its message). Handlers must not call
 * syncUserStravaActivities (it takes the user lock itself; the worker already holds it: ReentrantLockError) and must not wake
 * the worker. The worker owns status, attempts, backoff, the lease, the lock and the recalculation.
 *
 * ── WHAT THE WORKER DOES ────────────────────────────────────────────────────────────────────────────────────────────────────
 * drain(): claim (LEASE_SECONDS, WEBHOOK_CLAIM_BATCH) -> process the batch -> claim again, until the queue has nothing due.
 * Sequential (concurrency 1); a `running` flag makes a second drain() join the loop that is running, and a wake-up that arrives
 * while it runs makes it look once more, so an event stored just after the last claim is not left to the next sweep.
 *
 * A claimed batch belongs to one owner. For each event, oldest first:
 *   - older than WEBHOOK_DEAD_AFTER_HOURS counted from received_at  -> dead, one 🚨 KRITISKT line, no handler;
 *   - no user_id (the user was deleted)                              -> done / ignored_unknown_owner, no lock, no retry;
 *   - otherwise the events of one user run inside ONE withUserLock(userId): handlers, then the recalculation, then the status
 *     writes. The lock is taken once, outermost; nothing inside takes it again, and nothing inside wakes the loop.
 * Recalculation: ONE reprocessRunsFromDate from the earliest affected date and ONE calculateUserTotals per user and batch (a
 * burst of more than 25 events gives several batches and so several, accepted). An event needs it when its result has a
 * `recalculateFrom`, when `recalculateUnknown` is set, or when attempts >= 1 (an earlier try may have written or deleted the run
 * and died before it): a retry always recalculates. noop and ignored_* on a first try need none. `recalculateUnknown`, and an
 * attempts >= 1 result without a date, fall back to the user's EARLIEST run (RunStore.earliestRunDate): always correct,
 * because reprocessing is idempotent and a deleted run can be older than any lookback window. A user with no runs gets
 * only calculateUserTotals (totals must still be zeroed). An event is `done` only after the recalculation ran; if it throws,
 * the events that needed it are retried and the others still finish.
 *
 * Retry: attempts + 1, last_error = a short code, pending, next_attempt_at = now + WEBHOOK_BACKOFF_MINUTES[min(attempts, 3)] min.
 * A wait is not a failure: attempts is untouched, next_attempt_at is the next whole quarter hour + 30 s (rate_limit) or the next
 * UTC midnight + 1 min (daily_limit); when the rate budget is over its soft limit before an event, its own resume time is used.
 * THE WORKER NEVER SLEEPS WHILE HOLDING CLAIMED ROWS: a wait outlasts the lease (300 s), so on the signal every unfinished row
 * of the batch (this user's and the other users') is put back to pending at once and the batch ends. Otherwise the lease would
 * run out and the claim would count the wait as a failed attempt.
 *
 * Errors: a failing claim is logged (code only) and the loop ends; the next sweep tries again. A failing status write is logged;
 * the row stays `processing`, its lease runs out and the next claim counts that as one attempt (the handlers are idempotent and a
 * retry recalculates). Nothing here throws out of drain() or runRetention().
 *
 * Logging: ids, the object/aspect type and error CODES only. Never a token, a title, a body, an error message or `updates`.
 */
import { MS_DAY } from '@runquest/shared';
import { logger } from '../utils/logger.js';
import { withUserLock } from '../utils/keyedMutex.js';
import {
  LEASE_SECONDS,
  WEBHOOK_BACKOFF_MINUTES,
  WEBHOOK_CLAIM_BATCH,
  WEBHOOK_DAILY_WAIT_MARGIN_MS,
  WEBHOOK_DEAD_AFTER_HOURS,
  WEBHOOK_LAST_ERROR_MAX_LENGTH,
  WEBHOOK_OUTCOMES,
  WEBHOOK_QUARTER_WAIT_MARGIN_MS,
  WEBHOOK_RETENTION_DONE_DAYS,
  WEBHOOK_RETENTION_FAILED_DAYS,
  type WebhookAspectType,
  type WebhookObjectType,
  type WebhookOutcome,
} from './stravaWebhook/constants.js';
import type { RateBudget, Recompute, RunStore, StravaApi, WebhookEventRow, WebhookEventStore } from './stravaWebhook/ports.js';

const QUARTER_HOUR_MS = 15 * 60_000;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

// ─── The handler contract ──────────────────────────────────────────────────────

export type HandlerKey = `${WebhookObjectType}:${WebhookAspectType}`;

export const webhookHandlerKey = (objectType: WebhookObjectType, aspectType: WebhookAspectType): HandlerKey => `${objectType}:${aspectType}`;

export interface WebhookHandlerContext {
  event: WebhookEventRow;
  /** The user stored on the event at receipt. */
  userId: string;
  /** Failed attempts before this try (an expired lease counts as one). Pass it to decideAction. */
  attempts: number;
  strava: StravaApi;
  runs: RunStore;
  now: () => Date;
}

export type WebhookHandlerResult =
  | {
      status: 'done';
      outcome: WebhookOutcome;
      /** The earliest date ('YYYY-MM-DD') whose runs changed; null = no recalculation needed by this event. */
      recalculateFrom: string | null;
      /** decideAction's flag: a run may have changed but its date is unknown. The worker falls back to the user's earliest run. */
      recalculateUnknown?: boolean;
    }
  | { status: 'retry'; error: string }
  | { status: 'wait'; kind: 'rate_limit' | 'daily_limit' };

export type WebhookHandler = (ctx: WebhookHandlerContext) => Promise<WebhookHandlerResult>;

export type HandlerRegistry = Partial<Record<HandlerKey, WebhookHandler>>;

/**
 * What a handler returns when getValidAccessToken did not give a token. A user without a Strava connection is an unknown owner
 * (done / ignored_unknown_owner, no new outcome: the disconnect already deleted their Strava runs). A refresh that failed, or a
 * stored connection without a refresh token, is a failed attempt; the deauthorize handler reads these two as "Strava refused".
 */
export function resultForTokenFailure(reason: 'not_connected' | 'refresh_failed' | 'no_refresh_token'): WebhookHandlerResult {
  if (reason === 'not_connected') return { status: 'done', outcome: 'ignored_unknown_owner', recalculateFrom: null };
  return { status: 'retry', error: reason === 'refresh_failed' ? 'token_refresh_failed' : 'no_refresh_token' };
}

// ─── The worker ────────────────────────────────────────────────────────────────

export interface WorkerDeps {
  store: WebhookEventStore;
  strava: StravaApi;
  runs: RunStore;
  recompute: Recompute;
  handlers: HandlerRegistry;
  /** Injectable clock. */
  now?: () => Date;
  /** The rate budget: over its soft limit, the batch waits until it says it is open again. Absent = no budget check. */
  budget?: RateBudget;
}

export interface StravaWebhookWorker {
  /** Processes everything that is due, then returns. Joins a loop that is already running. Never rejects. */
  drain(): Promise<void>;
  /** Deletes old done and dead events. Returns the counts, or null if it failed (logged). Never rejects. */
  runRetention(): Promise<{ done: number; dead: number } | null>;
}

/** What a finished event needs from the recalculation. */
interface Finished {
  row: WebhookEventRow;
  outcome: WebhookOutcome;
  /** A valid date, or null. */
  from: string | null;
  unknown: boolean;
  needsRecompute: boolean;
}

const isCalendarDay = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
const isOutcome = (value: unknown): value is WebhookOutcome => (WEBHOOK_OUTCOMES as readonly unknown[]).includes(value);

/** A short, safe label for an error: its code or its name, characters limited. Never the message (it can carry values). */
function errorCode(error: unknown): string {
  const raw = (error as { code?: unknown } | null)?.code ?? (error as { name?: unknown } | null)?.name ?? 'unknown';
  return String(raw).replace(/[^\w.:-]/g, '').slice(0, 40) || 'unknown';
}

const shortError = (value: string): string => value.slice(0, WEBHOOK_LAST_ERROR_MAX_LENGTH);

const byEventOrder = (a: WebhookEventRow, b: WebhookEventRow): number => Date.parse(a.event_time) - Date.parse(b.event_time) || a.id - b.id;

const label = (row: WebhookEventRow): string => `${row.object_type} ${row.aspect_type} object_id=${row.object_id} owner_id=${row.owner_id}`;

/** Validates what a handler returned; a handler bug becomes a failed attempt instead of a wrong status. */
function readResult(result: unknown): WebhookHandlerResult {
  const invalid: WebhookHandlerResult = { status: 'retry', error: 'invalid_handler_result' };
  if (typeof result !== 'object' || result === null) return invalid;
  const value = result as Record<string, unknown>;
  if (value.status === 'done') {
    if (!isOutcome(value.outcome)) return invalid;
    const from = value.recalculateFrom ?? null;
    if (from !== null && typeof from !== 'string') return invalid;
    return { status: 'done', outcome: value.outcome, recalculateFrom: from, recalculateUnknown: value.recalculateUnknown === true };
  }
  if (value.status === 'retry' && typeof value.error === 'string') return { status: 'retry', error: shortError(value.error) };
  if (value.status === 'wait' && (value.kind === 'rate_limit' || value.kind === 'daily_limit')) return { status: 'wait', kind: value.kind };
  return invalid;
}

export function createStravaWebhookWorker(deps: WorkerDeps): StravaWebhookWorker {
  const { store, strava, runs, recompute, handlers, budget } = deps;
  const now = deps.now ?? (() => new Date());

  // A write to the queue. Marks the row as written-to even when the write fails: the lease then decides (see the header).
  async function write(row: WebhookEventRow, settled: Set<number>, what: string, action: () => Promise<boolean>): Promise<boolean> {
    settled.add(row.id);
    try {
      const applied = await action();
      if (!applied) logger.warn(`⚠️ Strava webhook: the lease of event ${row.id} was lost, the ${what} write was dropped`);
      return applied;
    } catch (error) {
      logger.error(`❌ Strava webhook: could not write ${what} for event ${row.id} (${errorCode(error)}); the lease expires and counts the attempt`);
      return false;
    }
  }

  const markDone = (row: WebhookEventRow, outcome: WebhookOutcome, settled: Set<number>) =>
    write(row, settled, 'done', () => store.markDone(row.id, outcome, now()));

  function retryRow(row: WebhookEventRow, error: string, settled: Set<number>): Promise<boolean> {
    const before = Math.max(0, Math.floor(row.attempts));
    const minutes = WEBHOOK_BACKOFF_MINUTES[Math.min(before, WEBHOOK_BACKOFF_MINUTES.length - 1)];
    return write(row, settled, 'retry', () =>
      store.release(row.id, { attempts: before + 1, nextAttemptAt: new Date(now().getTime() + minutes * MINUTE_MS), lastError: shortError(error) }),
    );
  }

  // A wait: back to pending at `until`, attempts untouched.
  function postpone(rows: WebhookEventRow[], until: Date, settled: Set<number>): Promise<boolean[]> {
    return Promise.all(
      rows.map((row) => write(row, settled, 'wait', () => store.release(row.id, { attempts: row.attempts, nextAttemptAt: until, lastError: 'rate_limit_wait' }))),
    );
  }

  /** The end of a wait. At least a second ahead, so a resume time in the past can never make the loop claim the same rows again. */
  function resumeFor(kind: 'rate_limit' | 'daily_limit'): Date {
    const t = now().getTime();
    return kind === 'daily_limit'
      ? new Date((Math.floor(t / MS_DAY) + 1) * MS_DAY + WEBHOOK_DAILY_WAIT_MARGIN_MS)
      : new Date((Math.floor(t / QUARTER_HOUR_MS) + 1) * QUARTER_HOUR_MS + WEBHOOK_QUARTER_WAIT_MARGIN_MS);
  }
  function budgetResume(): Date {
    const floor = now().getTime() + 1000;
    const at = budget!.nextResumeAt().getTime();
    return new Date(Number.isFinite(at) ? Math.max(at, floor) : floor);
  }

  async function declareDead(row: WebhookEventRow, settled: Set<number>): Promise<void> {
    const at = now();
    // Written first, alarmed after: the alarm is "once, at the transition", so it is only given when the transition happened.
    const applied = await write(row, settled, 'dead', () => store.markDead(row.id, `dead_after_${WEBHOOK_DEAD_AFTER_HOURS}h`, at));
    if (!applied) return;
    const subject = `${label(row)} attempts=${row.attempts}`;
    const isDeletion = row.aspect_type === 'delete' || row.object_type === 'athlete';
    logger.error(
      isDeletion
        ? `🚨 KRITISKT: Strava-webhook deletion not completed within Strava's ${WEBHOOK_DEAD_AFTER_HOURS} h deadline: ${subject}. The event is dead and nothing retries it; the data must be removed by hand.`
        : `🚨 KRITISKT: Strava-webhook event dead after ${WEBHOOK_DEAD_AFTER_HOURS} h without being processed: ${subject}.`,
    );
  }

  async function runHandler(handler: WebhookHandler, row: WebhookEventRow, userId: string): Promise<WebhookHandlerResult> {
    try {
      return readResult(await handler({ event: row, userId, attempts: row.attempts, strava, runs, now }));
    } catch (error) {
      logger.warn(`⚠️ Strava webhook: the handler failed for ${label(row)} (${errorCode(error)})`);
      return { status: 'retry', error: `handler_error:${errorCode(error)}` };
    }
  }

  function toFinished(row: WebhookEventRow, result: Extract<WebhookHandlerResult, { status: 'done' }>): Finished {
    const from = isCalendarDay(result.recalculateFrom) ? result.recalculateFrom : null;
    // A date the reprocess could not use is the same as no date. An earlier try (attempts >= 1) may have changed data on its own.
    const unknown = result.recalculateUnknown === true || (result.recalculateFrom != null && from === null) || (from === null && row.attempts >= 1);
    return { row, outcome: result.outcome, from, unknown, needsRecompute: from !== null || unknown };
  }

  /** One reprocess from the earliest affected date and one totals run for the user. Throws if either does. */
  async function recalculate(userId: string, needing: Finished[]): Promise<void> {
    let from: string | null;
    if (needing.some((item) => item.unknown)) {
      from = await runs.earliestRunDate(userId);
    } else {
      from = needing.map((item) => item.from!).reduce((earliest, date) => (date < earliest ? date : earliest));
    }
    if (from !== null) await recompute.reprocessFrom(userId, from);
    await recompute.recalculateTotals(userId);
  }

  /** All of one user's events in the batch, inside the user lock. Returns the time a wait ends, or null. */
  async function processUser(userId: string, rows: WebhookEventRow[], settled: Set<number>): Promise<Date | null> {
    const finished: Finished[] = [];
    const failed: Array<{ row: WebhookEventRow; error: string }> = [];
    const unfinished: WebhookEventRow[] = [];
    let holdUntil: Date | null = null;

    for (const row of rows) {
      if (holdUntil) {
        unfinished.push(row);
        continue;
      }
      const handler = handlers[webhookHandlerKey(row.object_type, row.aspect_type)];
      if (!handler) {
        logger.warn(`⚠️ Strava webhook: no handler for ${label(row)}, finished as noop`);
        finished.push({ row, outcome: 'noop', from: null, unknown: false, needsRecompute: false });
        continue;
      }
      if (budget?.isOverSoftLimit()) {
        holdUntil = budgetResume();
        unfinished.push(row);
        continue;
      }

      const result = await runHandler(handler, row, userId);
      if (result.status === 'done') finished.push(toFinished(row, result));
      else if (result.status === 'retry') failed.push({ row, error: result.error });
      else {
        holdUntil = resumeFor(result.kind);
        unfinished.push(row);
      }
    }

    // Before the recalculation: no row is left claimed longer than the work that is actually going on.
    if (unfinished.length > 0 && holdUntil) await postpone(unfinished, holdUntil, settled);

    const needing = finished.filter((item) => item.needsRecompute);
    let recomputeFailed = false;
    if (needing.length > 0) {
      try {
        await recalculate(userId, needing);
      } catch (error) {
        recomputeFailed = true;
        logger.error(`❌ Strava webhook: the recalculation for user ${userId} failed (${errorCode(error)}); its events are retried`);
      }
    }

    for (const item of finished) {
      if (item.needsRecompute && recomputeFailed) failed.push({ row: item.row, error: 'recompute_failed' });
      else await markDone(item.row, item.outcome, settled);
    }
    for (const { row, error } of failed) await retryRow(row, error, settled);
    return holdUntil;
  }

  async function runBatch(claimed: WebhookEventRow[], settled: Set<number>): Promise<void> {
    const deadline = now().getTime() - WEBHOOK_DEAD_AFTER_HOURS * HOUR_MS;
    const byUser = new Map<string, WebhookEventRow[]>();

    for (const row of [...claimed].sort(byEventOrder)) {
      if (Date.parse(row.received_at) < deadline) {
        await declareDead(row, settled);
      } else if (row.user_id === null) {
        await markDone(row, 'ignored_unknown_owner', settled);
      } else {
        byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), row]);
      }
    }

    let holdUntil: Date | null = null;
    for (const [userId, rows] of byUser) {
      if (holdUntil) {
        await postpone(rows, holdUntil, settled);
        continue;
      }
      holdUntil = await withUserLock(userId, () => processUser(userId, rows, settled));
    }
  }

  async function processBatch(claimed: WebhookEventRow[]): Promise<void> {
    const settled = new Set<number>();
    try {
      await runBatch(claimed, settled);
    } catch (error) {
      logger.error(`❌ Strava webhook: a batch failed unexpectedly (${errorCode(error)})`);
    }
    // Whatever was not reached goes back as a failed attempt instead of waiting for its lease to run out.
    for (const row of claimed) {
      if (!settled.has(row.id)) await retryRow(row, 'worker_error', settled);
    }
    logger.info(`📥 Strava webhook: handled a batch of ${claimed.length} event(s) for owner ${claimed[0]?.owner_id}`);
  }

  async function drainOnce(): Promise<void> {
    for (;;) {
      let claimed: WebhookEventRow[];
      try {
        claimed = await store.claim(LEASE_SECONDS, WEBHOOK_CLAIM_BATCH);
      } catch (error) {
        logger.error(`❌ Strava webhook: could not claim events (${errorCode(error)}); the next sweep tries again`);
        return;
      }
      if (claimed.length === 0) return;
      await processBatch(claimed);
    }
  }

  let inFlight: Promise<void> | null = null;
  let again = false;

  function drain(): Promise<void> {
    if (inFlight) {
      again = true; // looked at once more before the loop ends, so a wake-up is never lost
      return inFlight;
    }
    const loop = (async () => {
      try {
        do {
          again = false;
          await drainOnce();
        } while (again);
      } catch (error) {
        logger.error(`❌ Strava webhook: the loop failed unexpectedly (${errorCode(error)})`);
      } finally {
        inFlight = null;
      }
    })();
    inFlight = loop;
    return loop;
  }

  async function runRetention(): Promise<{ done: number; dead: number } | null> {
    const t = now().getTime();
    try {
      const purged = await store.purge({
        doneBefore: new Date(t - WEBHOOK_RETENTION_DONE_DAYS * MS_DAY),
        deadBefore: new Date(t - WEBHOOK_RETENTION_FAILED_DAYS * MS_DAY),
      });
      logger.info(`🧹 Strava webhook retention: deleted ${purged.done} done and ${purged.dead} dead event(s)`);
      return purged;
    } catch (error) {
      logger.error(`❌ Strava webhook retention failed (${errorCode(error)})`);
      return null;
    }
  }

  return { drain, runRetention };
}
