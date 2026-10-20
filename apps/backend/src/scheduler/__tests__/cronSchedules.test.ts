/**
 * Every job the backend hands to node-cron, with the expression and options it is scheduled with, and what the real node-cron does with
 * them. The scheduler tests mock node-cron, so a library upgrade that changed a default (a job that starts at once, another time zone)
 * would pass them all; this file is where the library itself is held to the schedule.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as NodeCron from 'node-cron';

const h = vi.hoisted(() => ({
  calls: [] as Array<{ expression: string; options: unknown }>,
}));

vi.mock('node-cron', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeCron>();
  return {
    ...actual,
    default: {
      ...actual.default,
      schedule: (expression: string, _callback: unknown, options?: unknown) => {
        h.calls.push({ expression, options });
        return { stop: vi.fn() };
      },
    },
  };
});
vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));
vi.mock('../../routes/strava.js', () => ({ syncAllStravaUsers: vi.fn() }));
vi.mock('../../services/streakService.js', () => ({ StreakService: { updateUserStreak: vi.fn() } }));
vi.mock('../../services/stravaWebhook/defaultWorker.js', () => ({ createDefaultWebhookWorker: vi.fn() }));
vi.mock('../../services/stravaWebhook/subscriptionCheck.js', () => ({ runStravaSubscriptionCheck: vi.fn() }));
vi.mock('../../services/recalculationMarks/defaultRecovery.js', () => ({ createDefaultRecovery: vi.fn() }));
vi.mock('../../services/stravaReconcile/defaultReconciler.js', () => ({ createDefaultReconciler: vi.fn() }));

import { logger } from '../../utils/logger.js';
import { startChallengeScheduler } from '../challengeScheduler.js';
import { startEventScheduler } from '../eventScheduler.js';
import { startStreakScheduler } from '../streakScheduler.js';
import { startStravaScheduler } from '../stravaSync.js';
import { startStravaWebhookScheduler } from '../stravaWebhookScheduler.js';
import { startStravaReconcileScheduler } from '../stravaReconcileScheduler.js';
import { startRecalculationRecoveryScheduler } from '../recalculationRecoveryScheduler.js';

const STOCKHOLM = { timezone: 'Europe/Stockholm' };

/** The schedule the jobs have run on since node-cron 3. `options: undefined` means the server's own clock, as before. */
const EXPECTED = [
  { expression: '5 * * * *', options: undefined }, // challenges: settle
  { expression: '10 */6 * * *', options: undefined }, // challenges: auto start / decline
  { expression: '0 19 * * *', options: STOCKHOLM }, // events: daily draw
  { expression: '0 22 * * 5,6', options: STOCKHOLM }, // events: Hangover Run
  { expression: '0 18 * * 4', options: STOCKHOLM }, // events: 5K Friday
  { expression: '0 20 * * 6', options: STOCKHOLM }, // events: weekly competitions
  { expression: '5 0 * * 1', options: STOCKHOLM }, // events: Monday settlement
  { expression: '35 * * * *', options: STOCKHOLM }, // events: settlement retry
  { expression: '*/5 * * * *', options: undefined }, // events: lifecycle tick
  { expression: '0 3 * * *', options: STOCKHOLM }, // streaks: nightly
  { expression: '0 */12 * * *', options: STOCKHOLM }, // Strava: backup poll
  { expression: '*/30 * * * *', options: STOCKHOLM }, // Strava: weather backfill and catch-up
  { expression: '* * * * *', options: undefined }, // Strava webhooks: sweep
  { expression: '30 3 * * *', options: STOCKHOLM }, // Strava webhooks: retention
  { expression: '15 4 * * *', options: STOCKHOLM }, // Strava: nightly reconcile
  { expression: '5 4 * * *', options: STOCKHOLM }, // recalculation recovery
];

const stops: Array<() => void> = [];

beforeEach(() => {
  h.calls.length = 0;
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function startEverything(): void {
  vi.stubEnv('NODE_ENV', 'production');
  startChallengeScheduler();
  startEventScheduler();
  startStreakScheduler();
  startStravaScheduler();
  stops.push(startStravaWebhookScheduler({ worker: { drain: vi.fn(), runRetention: vi.fn() } }));
  stops.push(startStravaReconcileScheduler({ reconciler: { run: vi.fn() } as never }));
  stops.push(startRecalculationRecoveryScheduler({ recovery: { run: vi.fn().mockResolvedValue({ found: 0, recalculated: 0, failed: 0 }) } }));
}

describe('node-cron schedules', () => {
  it('schedules every job with the expression and time zone it had before', () => {
    startEverything();

    expect(h.calls).toEqual(EXPECTED);
  });

  it('is given expressions and time zones the installed node-cron accepts', async () => {
    startEverything();
    const real = (await vi.importActual<typeof NodeCron>('node-cron')).default;

    for (const { expression, options } of h.calls) {
      expect(real.validate(expression), expression).toBe(true);
      const task = real.schedule(expression, () => {}, { ...(options as object) } as Parameters<typeof real.schedule>[2]);
      await task.stop();
    }
  });
});

describe('what the installed node-cron does with those schedules', () => {
  let real: typeof NodeCron.default;
  const tasks: Array<{ stop(): unknown }> = [];
  const schedule = (...args: Parameters<typeof NodeCron.default.schedule>) => {
    const task = real.schedule(...args);
    tasks.push(task);
    return task;
  };

  beforeEach(async () => {
    real = (await vi.importActual<typeof NodeCron>('node-cron')).default;
    vi.useFakeTimers();
  });
  afterEach(async () => {
    await Promise.all(tasks.splice(0).map((task) => task.stop()));
    vi.useRealTimers();
  });

  it('does not run a job when it is scheduled, only at the next matching minute', async () => {
    vi.setSystemTime(new Date('2026-10-20T10:00:30.000Z'));
    const run = vi.fn();

    schedule('*/5 * * * *', run);
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runs the Stockholm jobs on Stockholm wall-clock time, in summer and in winter', async () => {
    // 19:00 Stockholm is 17:00 UTC in summer (CEST) and 18:00 UTC in winter (CET).
    for (const [from, firstUtcHour] of [['2026-07-15T00:00:00.000Z', 17], ['2026-12-15T00:00:00.000Z', 18]] as const) {
      vi.setSystemTime(new Date(from));
      const run = vi.fn(() => new Date().toISOString());

      schedule('0 19 * * *', run, STOCKHOLM);
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000 - 1);

      expect(run).toHaveBeenCalledTimes(1);
      expect(run.mock.results[0].value, from).toMatch(new RegExp(`T${firstUtcHour}:00:0\\d`));
      await Promise.all(tasks.splice(0).map((task) => task.stop()));
    }
  });
});
