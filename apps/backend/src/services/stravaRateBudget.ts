/**
 * How much of Strava's read limit the app has used, and when it may call again (ADR 010 decision 9).
 *
 * It listens to every Strava response through the stravaClient hook (registerStravaRateBudget) and reads
 * `X-ReadRateLimit-Usage` / `-Limit` ("15min,daily"). Nothing stops on it yet: the webhook worker and the polling ask
 * `isOverSoftLimit()` and `nextResumeAt()` later.
 *
 * The state is in memory, per process. The backend runs as one Railway instance, so that is the whole app. A restart
 * empties it; until the first response with headers arrives, a local sliding counter stands in.
 */
import { logger } from '../utils/logger.js';
import {
  STRAVA_READ_LIMIT_15_MIN,
  STRAVA_READ_LIMIT_DAILY,
  WEBHOOK_SOFT_LIMIT_15_MIN,
  WEBHOOK_SOFT_LIMIT_DAILY,
} from '../config/stravaLimits.js';
import { setStravaRequestHooks } from './stravaClient.js';

// Strava's windows are UTC: the 15-minute one turns over on the quarter hour, the daily one at UTC midnight.
// (The calendar helpers in utils/dateUtils.ts are Europe/Stockholm, so they do not fit here.)
const QUARTER_MS = 15 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const QUARTER_WAIT_MARGIN_MS = 30_000;
const DAY_WAIT_MARGIN_MS = 60_000;

export interface RateUsage {
  /** Reads in the current 15-minute window. */
  last15Min: number;
  /** Reads in the current day. */
  daily: number;
  /** Strava's reported limit, or the constants until a header has been seen. */
  limit15Min: number;
  limitDaily: number;
}

export interface StravaRateBudget {
  /** Feed it every Strava response (the hook does). Never throws. */
  recordResponse(url: string, response: Response): void;
  usage(): RateUsage;
  /** True from the webhook soft limit (210 per 15 min or 2 100 per day), and after a 429 until the window turns over. */
  isOverSoftLimit(): boolean;
  /** When the budget is open again: the next quarter hour + 30 s, or UTC midnight + 1 min when the day is the limit that is hit. */
  nextResumeAt(): Date;
}

interface BudgetOptions {
  /** Injectable for tests. Epoch milliseconds. */
  now?: () => number;
}

/** "15min,daily" with two whole numbers; anything else is not a reading. */
function parsePair(value: string | null): [number, number] | null {
  const match = /^\s*(\d+)\s*,\s*(\d+)\s*$/.exec(value ?? '');
  return match ? [Number(match[1]), Number(match[2])] : null;
}

/** The token refresh and deauthorize are not reads; Strava counts them in the total only. The hook sees no HTTP method, so this goes by path. */
function isRead(url: string): boolean {
  return !url.startsWith('https://www.strava.com/oauth/');
}

/** Usage in one fixed Strava window, known from the last header and local counting after it. */
interface Window {
  id: number;
  reported: number;
  since: number;
}

export function createStravaRateBudget(options: BudgetOptions = {}): StravaRateBudget {
  const now = options.now ?? Date.now;

  // Reads since the process started, for the sliding fallback. Pruned to a day.
  let reads: number[] = [];
  // Once a header has been seen the window boundaries are known and fixed windows are exact; before that, the sliding counter
  // is the cautious guess (a window that has not turned over yet may hold reads from before the restart that we cannot see).
  let headersSeen = false;
  let quarter: Window = { id: 0, reported: 0, since: 0 };
  let day: Window = { id: 0, reported: 0, since: 0 };
  let limits = { quarter: STRAVA_READ_LIMIT_15_MIN, day: STRAVA_READ_LIMIT_DAILY };
  let lastLimitKey = `${STRAVA_READ_LIMIT_15_MIN},${STRAVA_READ_LIMIT_DAILY}`;
  // A 429 means the limit is used up in that window, whatever our own count says.
  let limitedQuarterId: number | null = null;
  let limitedDayId: number | null = null;

  const quarterId = (t: number) => Math.floor(t / QUARTER_MS);
  const dayId = (t: number) => Math.floor(t / DAY_MS);

  function roll(t: number): void {
    if (quarter.id !== quarterId(t)) quarter = { id: quarterId(t), reported: 0, since: 0 };
    if (day.id !== dayId(t)) day = { id: dayId(t), reported: 0, since: 0 };
  }

  function slidingCount(t: number, span: number): number {
    return reads.filter((readAt) => readAt > t - span).length;
  }

  function used(t: number): { quarter: number; day: number } {
    roll(t);
    let usedQuarter = headersSeen ? quarter.reported + quarter.since : slidingCount(t, QUARTER_MS);
    let usedDay = headersSeen ? day.reported + day.since : slidingCount(t, DAY_MS);
    if (limitedQuarterId === quarterId(t)) usedQuarter = Math.max(usedQuarter, limits.quarter);
    if (limitedDayId === dayId(t)) usedDay = Math.max(usedDay, limits.day);
    return { quarter: usedQuarter, day: usedDay };
  }

  function warnOnChangedLimit(pair: [number, number]): void {
    const key = pair.join(',');
    if (key === lastLimitKey) return;
    lastLimitKey = key;
    if (pair[0] !== STRAVA_READ_LIMIT_15_MIN || pair[1] !== STRAVA_READ_LIMIT_DAILY) {
      logger.warn(
        `⚠️ Strava reports a read limit of ${key} (15 min, day), not the ${STRAVA_READ_LIMIT_15_MIN},${STRAVA_READ_LIMIT_DAILY} in config/stravaLimits.ts. Update the constants if the limit was raised.`,
      );
    }
  }

  function recordResponse(url: string, response: Response): void {
    try {
      const t = now();
      roll(t);

      if (isRead(url)) {
        reads.push(t);
        reads = reads.filter((readAt) => readAt > t - DAY_MS);
        quarter.since += 1;
        day.since += 1;
      }

      const usage = parsePair(response.headers.get('X-ReadRateLimit-Usage'));
      if (usage) {
        headersSeen = true;
        quarter = { id: quarterId(t), reported: usage[0], since: 0 };
        day = { id: dayId(t), reported: usage[1], since: 0 };
      }
      const limit = parsePair(response.headers.get('X-ReadRateLimit-Limit'));
      if (limit) {
        limits = { quarter: limit[0], day: limit[1] };
        warnOnChangedLimit(limit);
      }

      if (response.status === 429) {
        const current = used(t);
        // The daily limit is the one hit only when the response says so; otherwise assume the 15-minute one, which clears sooner.
        if (usage && current.day >= limits.day) limitedDayId = dayId(t);
        else limitedQuarterId = quarterId(t);
      }
    } catch (error) {
      // A broken budget must never break the Strava call it listens to.
      logger.error('❌ Strava rate budget could not read a response:', error);
    }
  }

  function usage(): RateUsage {
    const current = used(now());
    return { last15Min: current.quarter, daily: current.day, limit15Min: limits.quarter, limitDaily: limits.day };
  }

  function isOverSoftLimit(): boolean {
    const current = used(now());
    return current.quarter >= WEBHOOK_SOFT_LIMIT_15_MIN || current.day >= WEBHOOK_SOFT_LIMIT_DAILY;
  }

  function nextResumeAt(): Date {
    const t = now();
    const current = used(t);
    // The day is checked first: when both windows are full, waiting for the quarter hour would only end in a second wait.
    if (current.day >= WEBHOOK_SOFT_LIMIT_DAILY) return new Date((dayId(t) + 1) * DAY_MS + DAY_WAIT_MARGIN_MS);
    return new Date((quarterId(t) + 1) * QUARTER_MS + QUARTER_WAIT_MARGIN_MS);
  }

  return { recordResponse, usage, isOverSoftLimit, nextResumeAt };
}

/** The app's one budget. */
export const stravaRateBudget = createStravaRateBudget();

export const isOverSoftLimit = (): boolean => stravaRateBudget.isOverSoftLimit();
export const nextResumeAt = (): Date => stravaRateBudget.nextResumeAt();

/**
 * Hooks the budget onto the central Strava fetch path, so every call is counted without any caller knowing.
 * Returns a function that takes the hook off again. Call it once per process (server.ts).
 */
export function registerStravaRateBudget(budget: StravaRateBudget = stravaRateBudget): () => void {
  return setStravaRequestHooks({ after: (url, response) => budget.recordResponse(url, response) });
}
