/**
 * The scheduler of the nightly Strava reconcile: one job at 04:15 Stockholm time, production only, one night at a time.
 * The reconcile itself is tested in services/__tests__/stravaReconcile.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  schedule: vi.fn(),
  stop: vi.fn(),
  callbacks: new Map<string, () => unknown>(),
}));

vi.mock('node-cron', () => ({
  default: {
    schedule: (expression: string, callback: () => unknown, options?: unknown) => {
      h.schedule(expression, options);
      h.callbacks.set(expression, callback);
      return { stop: h.stop };
    },
  },
}));
vi.mock('../../services/stravaReconcile/defaultReconciler.js', () => ({ createDefaultReconciler: vi.fn() }));

import { logger } from '../../utils/logger.js';
import { createDefaultReconciler } from '../../services/stravaReconcile/defaultReconciler.js';
import { RECONCILE_CRON } from '../../services/stravaReconcile/constants.js';
import { WEBHOOK_RETENTION_CRON } from '../../services/stravaWebhook/constants.js';
import type { ReconcileSummary, StravaReconciler } from '../../services/stravaReconcile.js';
import { startStravaReconcileScheduler } from '../stravaReconcileScheduler.js';

const SUMMARY: ReconcileSummary = { users: 0, skippedPaused: 0, skippedUnavailable: 0, checked: 0, removed: 0, updated: 0, failed: 0, requests: 0, stopped: null };
const fakeReconciler = (): StravaReconciler & { run: ReturnType<typeof vi.fn> } => ({ run: vi.fn().mockResolvedValue(SUMMARY) });
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

let stop: (() => void) | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  h.callbacks.clear();
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(() => {
  stop?.();
  stop = null;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('nightly reconcile scheduler', () => {
  it('is not started outside production', () => {
    vi.stubEnv('NODE_ENV', 'development');

    stop = startStravaReconcileScheduler({ reconciler: fakeReconciler() });

    expect(h.schedule).not.toHaveBeenCalled();
    expect(createDefaultReconciler).not.toHaveBeenCalled();
  });

  it('runs one night at 04:15 Stockholm time, a time no other nightly job has', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const reconciler = fakeReconciler();

    stop = startStravaReconcileScheduler({ reconciler });

    expect(RECONCILE_CRON).toBe('15 4 * * *');
    expect(RECONCILE_CRON).not.toBe(WEBHOOK_RETENTION_CRON);
    expect(h.schedule).toHaveBeenCalledTimes(1);
    expect(h.schedule).toHaveBeenCalledWith('15 4 * * *', { timezone: 'Europe/Stockholm' });
    h.callbacks.get('15 4 * * *')!();
    expect(reconciler.run).toHaveBeenCalledTimes(1);
  });

  it('builds the production reconciler when none is given', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const reconciler = fakeReconciler();
    vi.mocked(createDefaultReconciler).mockReturnValue(reconciler);

    stop = startStravaReconcileScheduler();
    h.callbacks.get('15 4 * * *')!();

    expect(reconciler.run).toHaveBeenCalledTimes(1);
  });

  it('starting twice schedules once, and stopping ends the job so it can be started again', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const reconciler = fakeReconciler();

    const first = startStravaReconcileScheduler({ reconciler });
    startStravaReconcileScheduler({ reconciler });
    expect(h.schedule).toHaveBeenCalledTimes(1);

    first();
    expect(h.stop).toHaveBeenCalledTimes(1);
    stop = startStravaReconcileScheduler({ reconciler });
    expect(h.schedule).toHaveBeenCalledTimes(2);
  });

  it('does not start a second night while the first is still running', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    let finish!: () => void;
    const reconciler = fakeReconciler();
    reconciler.run.mockReturnValue(new Promise<ReconcileSummary>((resolve) => { finish = () => resolve(SUMMARY); }));
    stop = startStravaReconcileScheduler({ reconciler });

    const tick = h.callbacks.get('15 4 * * *')!;
    void tick();
    await tick();

    expect(reconciler.run).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalled();
    finish();
    await flush();
    void tick();
    expect(reconciler.run).toHaveBeenCalledTimes(2);
  });

  it('a night that throws is logged by code and the next night still runs', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const reconciler = fakeReconciler();
    reconciler.run.mockRejectedValueOnce(Object.assign(new Error('https://www.strava.com/x?client_secret=hunter2hunter2'), { code: 'ECONNRESET' }));
    stop = startStravaReconcileScheduler({ reconciler });
    const tick = h.callbacks.get('15 4 * * *')!;

    await expect(Promise.resolve(tick())).resolves.toBeUndefined();
    await tick();

    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).toContain('ECONNRESET');
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain('hunter2hunter2');
    expect(reconciler.run).toHaveBeenCalledTimes(2);
  });
});
