/**
 * The scheduler of the recalculation recovery job: one run when it is started and one at 04:05 Stockholm time every night, production
 * only, one run at a time. The job itself is tested in services/__tests__/recalculationRecovery.test.ts.
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
vi.mock('../../services/recalculationMarks/defaultRecovery.js', () => ({ createDefaultRecovery: vi.fn() }));

import { logger } from '../../utils/logger.js';
import { createDefaultRecovery } from '../../services/recalculationMarks/defaultRecovery.js';
import { RECOVERY_CRON } from '../../services/recalculationMarks/constants.js';
import { RECONCILE_CRON } from '../../services/stravaReconcile/constants.js';
import type { RecalculationRecovery, RecoverySummary } from '../../services/recalculationMarks/recovery.js';
import { startRecalculationRecoveryScheduler } from '../recalculationRecoveryScheduler.js';

const SUMMARY: RecoverySummary = { found: 0, recalculated: 0, failed: 0 };
const fakeRecovery = (): RecalculationRecovery & { run: ReturnType<typeof vi.fn> } => ({ run: vi.fn().mockResolvedValue(SUMMARY) });
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

describe('recalculation recovery scheduler', () => {
  it('is not started outside production: no job, no run', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const recovery = fakeRecovery();

    stop = startRecalculationRecoveryScheduler({ recovery });

    expect(h.schedule).not.toHaveBeenCalled();
    expect(recovery.run).not.toHaveBeenCalled();
    expect(createDefaultRecovery).not.toHaveBeenCalled();
  });

  it('runs once at start and then every night at 04:05 Stockholm time, before the reconcile at 04:15', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const recovery = fakeRecovery();

    stop = startRecalculationRecoveryScheduler({ recovery });
    await flush();

    expect(recovery.run).toHaveBeenCalledTimes(1); // at start
    expect(RECOVERY_CRON).toBe('5 4 * * *');
    expect(RECOVERY_CRON).not.toBe(RECONCILE_CRON);
    expect(h.schedule).toHaveBeenCalledTimes(1);
    expect(h.schedule).toHaveBeenCalledWith('5 4 * * *', { timezone: 'Europe/Stockholm' });
    h.callbacks.get('5 4 * * *')!();
    await flush();
    expect(recovery.run).toHaveBeenCalledTimes(2);
  });

  it('builds the production recovery when none is given', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const recovery = fakeRecovery();
    vi.mocked(createDefaultRecovery).mockReturnValue(recovery);

    stop = startRecalculationRecoveryScheduler();
    await flush();

    expect(createDefaultRecovery).toHaveBeenCalledTimes(1);
    expect(recovery.run).toHaveBeenCalledTimes(1);
  });

  it('does not start a run while the previous one is still going, at start or at night', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    let finish!: (summary: RecoverySummary) => void;
    const recovery = fakeRecovery();
    recovery.run.mockImplementationOnce(() => new Promise<RecoverySummary>((resolve) => { finish = resolve; }));

    stop = startRecalculationRecoveryScheduler({ recovery });
    await flush();
    h.callbacks.get('5 4 * * *')!(); // the night comes while the start run is still working
    await flush();
    expect(recovery.run).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalled();

    finish(SUMMARY);
    await flush();
    h.callbacks.get('5 4 * * *')!();
    await flush();
    expect(recovery.run).toHaveBeenCalledTimes(2);
  });

  it('a run that rejects is logged by code and does not stop the next one', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const recovery = fakeRecovery();
    recovery.run.mockRejectedValueOnce(Object.assign(new Error('secret message'), { code: 'XX000' }));

    stop = startRecalculationRecoveryScheduler({ recovery });
    await flush();

    const lines = vi.mocked(logger.error).mock.calls.map((call) => String(call[0]));
    expect(lines.join('\n')).toContain('XX000');
    expect(lines.join('\n')).not.toContain('secret message');
    h.callbacks.get('5 4 * * *')!();
    await flush();
    expect(recovery.run).toHaveBeenCalledTimes(2);
  });

  it('starts once: a second start does nothing until the first is stopped', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const recovery = fakeRecovery();

    stop = startRecalculationRecoveryScheduler({ recovery });
    startRecalculationRecoveryScheduler({ recovery });
    await flush();

    expect(h.schedule).toHaveBeenCalledTimes(1);
    expect(recovery.run).toHaveBeenCalledTimes(1);
  });

  it('stopping it stops the job and allows a new start', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const recovery = fakeRecovery();

    startRecalculationRecoveryScheduler({ recovery })();
    expect(h.stop).toHaveBeenCalledTimes(1);

    stop = startRecalculationRecoveryScheduler({ recovery });
    expect(h.schedule).toHaveBeenCalledTimes(2);
  });
});
