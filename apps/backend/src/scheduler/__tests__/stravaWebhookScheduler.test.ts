/**
 * The webhook worker's scheduler (ADR 010 decisions 6 and 11): a sweep every minute, the retention job at 03:30 Stockholm time,
 * and the wake-up after an insert. Started only in production; outside it a wake-up does nothing, so tests and dev process nothing.
 * The worker itself is tested in services/__tests__/stravaWebhookWorker.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  schedule: vi.fn(),
  stop: vi.fn(),
  callbacks: new Map<string, () => void>(),
}));

vi.mock('node-cron', () => ({
  default: {
    schedule: (expression: string, callback: () => void, options?: unknown) => {
      h.schedule(expression, options);
      h.callbacks.set(expression, callback);
      return { stop: h.stop };
    },
  },
}));
vi.mock('../../services/stravaWebhook/defaultWorker.js', () => ({ createDefaultWebhookWorker: vi.fn() }));
vi.mock('../../services/stravaWebhook/subscriptionCheck.js', () => ({ runStravaSubscriptionCheck: vi.fn() }));

import { logger } from '../../utils/logger.js';
import { createDefaultWebhookWorker } from '../../services/stravaWebhook/defaultWorker.js';
import { runStravaSubscriptionCheck } from '../../services/stravaWebhook/subscriptionCheck.js';
import type { StravaWebhookWorker } from '../../services/stravaWebhookWorker.js';
import { startStravaWebhookScheduler, wakeStravaWebhookWorker } from '../stravaWebhookScheduler.js';

const fakeWorker = (): StravaWebhookWorker & { drain: ReturnType<typeof vi.fn>; runRetention: ReturnType<typeof vi.fn> } => ({
  drain: vi.fn().mockResolvedValue(undefined),
  runRetention: vi.fn().mockResolvedValue({ done: 0, dead: 0 }),
});
const flushImmediates = () => new Promise<void>((resolve) => setImmediate(resolve));

let stopScheduler: (() => void) | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  h.callbacks.clear();
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.mocked(runStravaSubscriptionCheck).mockResolvedValue('ok');
});
afterEach(() => {
  stopScheduler?.();
  stopScheduler = null;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('webhook scheduler', () => {
  it('webhook scheduler is not started outside production', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const worker = fakeWorker();

    stopScheduler = startStravaWebhookScheduler({ worker });
    wakeStravaWebhookWorker();
    await flushImmediates();

    expect(h.schedule).not.toHaveBeenCalled();
    expect(worker.drain).not.toHaveBeenCalled();
    expect(createDefaultWebhookWorker).not.toHaveBeenCalled();
  });

  it('a wake-up before the scheduler has started does nothing', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    wakeStravaWebhookWorker();
    await flushImmediates();

    expect(createDefaultWebhookWorker).not.toHaveBeenCalled();
  });

  it('in production it sweeps every minute and runs the retention at 03:30 Stockholm time', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const worker = fakeWorker();

    stopScheduler = startStravaWebhookScheduler({ worker });

    expect(h.schedule).toHaveBeenCalledTimes(2);
    expect(h.schedule).toHaveBeenCalledWith('* * * * *', undefined);
    expect(h.schedule).toHaveBeenCalledWith('30 3 * * *', { timezone: 'Europe/Stockholm' });

    h.callbacks.get('* * * * *')!();
    expect(worker.drain).toHaveBeenCalledTimes(1);
    expect(worker.runRetention).not.toHaveBeenCalled();
    h.callbacks.get('30 3 * * *')!();
    expect(worker.runRetention).toHaveBeenCalledTimes(1);
  });

  it('builds the production worker when none is given', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const worker = fakeWorker();
    vi.mocked(createDefaultWebhookWorker).mockReturnValue(worker);

    stopScheduler = startStravaWebhookScheduler();
    h.callbacks.get('* * * * *')!();

    expect(worker.drain).toHaveBeenCalledTimes(1);
  });

  it('a wake-up after the scheduler started runs the worker once, after the current call has finished', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const worker = fakeWorker();
    stopScheduler = startStravaWebhookScheduler({ worker });

    wakeStravaWebhookWorker();
    expect(worker.drain).not.toHaveBeenCalled();
    await flushImmediates();

    expect(worker.drain).toHaveBeenCalledTimes(1);
  });

  it('starting twice schedules once, and stopping ends the jobs and the wake-up', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const worker = fakeWorker();
    const stop = startStravaWebhookScheduler({ worker });
    startStravaWebhookScheduler({ worker });
    expect(h.schedule).toHaveBeenCalledTimes(2);

    stop();
    expect(h.stop).toHaveBeenCalledTimes(2);
    wakeStravaWebhookWorker();
    await flushImmediates();
    expect(worker.drain).not.toHaveBeenCalled();
  });

  describe('the nightly subscription check', () => {
    it('runs in the 03:30 job, once per run, and not in the sweep', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      const worker = fakeWorker();
      stopScheduler = startStravaWebhookScheduler({ worker });

      h.callbacks.get('* * * * *')!();
      await flushImmediates();
      expect(runStravaSubscriptionCheck).not.toHaveBeenCalled();

      h.callbacks.get('30 3 * * *')!();
      await flushImmediates();
      expect(runStravaSubscriptionCheck).toHaveBeenCalledTimes(1);
      expect(worker.runRetention).toHaveBeenCalledTimes(1);
    });

    it('a failing retention does not stop the check', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
      const worker = fakeWorker();
      worker.runRetention.mockRejectedValue(new Error('database is down'));
      stopScheduler = startStravaWebhookScheduler({ worker });

      expect(() => h.callbacks.get('30 3 * * *')!()).not.toThrow();
      await flushImmediates();

      expect(runStravaSubscriptionCheck).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledTimes(1);
    });

    it('a retention that throws at once does not stop the check', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.spyOn(logger, 'error').mockImplementation(() => {});
      const worker = fakeWorker();
      worker.runRetention.mockImplementation(() => {
        throw new Error('broken before the first await');
      });
      stopScheduler = startStravaWebhookScheduler({ worker });

      expect(() => h.callbacks.get('30 3 * * *')!()).not.toThrow();
      await flushImmediates();

      expect(runStravaSubscriptionCheck).toHaveBeenCalledTimes(1);
    });

    it('a failing check does not stop the retention and never throws out of the cron callback', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
      vi.mocked(runStravaSubscriptionCheck).mockRejectedValue(new Error('https://www.strava.com/api/v3/push_subscriptions?client_secret=hunter2hunter2'));
      const worker = fakeWorker();
      stopScheduler = startStravaWebhookScheduler({ worker });

      expect(() => h.callbacks.get('30 3 * * *')!()).not.toThrow();
      await flushImmediates();

      expect(worker.runRetention).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledTimes(1);
      expect(String(error.mock.calls[0][0])).not.toContain('hunter2hunter2');
      expect(JSON.stringify(error.mock.calls)).not.toContain('hunter2hunter2');
    });

    it('a check that throws at once is caught as well', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
      vi.mocked(runStravaSubscriptionCheck).mockImplementation(() => {
        throw new Error('broken before the first await');
      });
      const worker = fakeWorker();
      stopScheduler = startStravaWebhookScheduler({ worker });

      expect(() => h.callbacks.get('30 3 * * *')!()).not.toThrow();
      await flushImmediates();

      expect(worker.runRetention).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledTimes(1);
    });
  });
});
