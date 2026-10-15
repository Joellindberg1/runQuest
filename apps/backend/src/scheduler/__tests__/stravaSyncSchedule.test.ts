/**
 * How often the Strava sync runs and what the next-sync estimate says. Real constants: the poll runs every STRAVA_POLL_INTERVAL_HOURS
 * hours at fixed Stockholm clock times (00:00 and 12:00), the weather backfill has its own 30-minute schedule.
 * stravaSyncScheduleSingleSource.test.ts proves the scheduler takes the value from packages/shared/src/rules.ts.
 *
 * Times in the tests: Stockholm is UTC+2 in summer (CEST) and UTC+1 in winter (CET).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { STRAVA_POLL_INTERVAL_HOURS } from '@runquest/shared';

type Job = { expr: string; options: unknown; run: () => Promise<void> };

const h = vi.hoisted(() => ({
  jobs: [] as Array<{ expr: string; options: unknown; run: () => Promise<void> }>,
  syncAllStravaUsers: vi.fn(),
  calculateUserTotals: vi.fn(),
  backfillMissingWeather: vi.fn(),
  processAllUsersTitles: vi.fn(),
}));

vi.mock('node-cron', () => ({
  default: { schedule: (expr: string, run: () => Promise<void>, options?: unknown) => { h.jobs.push({ expr, options, run }); } },
}));
vi.mock('../../routes/strava.js', () => ({ syncAllStravaUsers: h.syncAllStravaUsers }));
vi.mock('../../services/weatherService.js', () => ({ WeatherService: { backfillMissingWeather: h.backfillMissingWeather } }));
vi.mock('../../services/enhancedTitleService.js', () => ({ enhancedTitleService: { processAllUsersTitles: h.processAllUsersTitles } }));
vi.mock('../../utils/calculateUserTotals.js', () => ({ calculateUserTotals: h.calculateUserTotals }));

import { startStravaScheduler, getSyncInfo } from '../stravaSync.js';
import { logger } from '../../utils/logger.js';

const POLL_CRON = `0 */${STRAVA_POLL_INTERVAL_HOURS} * * *`;
const WEATHER_CRON = '*/30 * * * *';

const jobs = (): Job[] => h.jobs;
const pollJob = (): Job => {
  const job = jobs().find((candidate) => candidate.expr === POLL_CRON);
  if (!job) throw new Error('the poll job is not scheduled');
  return job;
};
const weatherJob = (): Job => {
  const job = jobs().find((candidate) => candidate.expr === WEATHER_CRON);
  if (!job) throw new Error('the weather job is not scheduled');
  return job;
};

beforeEach(() => {
  vi.clearAllMocks();
  h.jobs.length = 0;
  h.syncAllStravaUsers.mockResolvedValue({ success: true, message: 'ok', syncedUsers: 0, totalUsers: 0, totalNewRuns: 0 });
  h.backfillMissingWeather.mockResolvedValue(0);
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-14T12:00:00Z'));
  vi.spyOn(logger, 'info').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('Strava sync schedule', () => {
  it('scheduler runs the strava sync every STRAVA_POLL_INTERVAL_HOURS hours in Europe/Stockholm', () => {
    startStravaScheduler();

    const poll = jobs().filter((job) => job.expr === POLL_CRON);
    expect(poll).toHaveLength(1);
    expect(poll[0].options).toEqual({ timezone: 'Europe/Stockholm' });
  });

  it('weather backfill runs on its own schedule independent of the strava poll', async () => {
    startStravaScheduler();
    expect(jobs()).toHaveLength(2);
    expect(weatherJob()).not.toBe(pollJob());
    expect(weatherJob().options).toEqual({ timezone: 'Europe/Stockholm' });

    // A poll tick fetches no weather.
    await pollJob().run();
    expect(h.syncAllStravaUsers).toHaveBeenCalledTimes(1);
    expect(h.backfillMissingWeather).not.toHaveBeenCalled();

    // A weather tick runs no poll.
    await weatherJob().run();
    expect(h.backfillMissingWeather).toHaveBeenCalledTimes(1);
    expect(h.syncAllStravaUsers).toHaveBeenCalledTimes(1);
  });

  it('a failing poll does not stop the weather backfill, and a failing backfill does not change the poll status', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    startStravaScheduler();

    h.syncAllStravaUsers.mockRejectedValueOnce(new Error('strava down'));
    await pollJob().run();
    expect(getSyncInfo().lastSyncStatus).toBe('error');
    await weatherJob().run();
    expect(h.backfillMissingWeather).toHaveBeenCalledTimes(1);

    await pollJob().run();
    expect(getSyncInfo().lastSyncStatus).toBe('success');
    h.backfillMissingWeather.mockRejectedValueOnce(new Error('open-meteo down'));
    await expect(weatherJob().run()).resolves.toBeUndefined();
    expect(getSyncInfo().lastSyncStatus).toBe('success');
  });

  it('a weather backfill that is still running is not started again by the next tick', async () => {
    let finish: (saved: number) => void = () => {};
    h.backfillMissingWeather.mockImplementationOnce(() => new Promise<number>((resolve) => { finish = resolve; }));
    startStravaScheduler();

    const first = weatherJob().run();
    await weatherJob().run();
    expect(h.backfillMissingWeather).toHaveBeenCalledTimes(1);

    finish(0);
    await first;
    await weatherJob().run();
    expect(h.backfillMissingWeather).toHaveBeenCalledTimes(2);
  });

  it('a weather tick without saved weather recalculates neither totals nor titles', async () => {
    startStravaScheduler();

    await weatherJob().run();

    expect(h.calculateUserTotals).not.toHaveBeenCalled();
    expect(h.processAllUsersTitles).not.toHaveBeenCalled();
  });

  it('a weather tick that saved weather recalculates titles once and never the user totals', async () => {
    h.backfillMissingWeather.mockResolvedValueOnce(3);
    h.processAllUsersTitles.mockResolvedValue({ total: 1, processed: 1, failed: 0 });
    startStravaScheduler();

    await weatherJob().run();

    expect(h.processAllUsersTitles).toHaveBeenCalledTimes(1);
    expect(h.calculateUserTotals).not.toHaveBeenCalled();
  });
});

describe('next_sync_estimated', () => {
  it('next_sync_estimated is the last attempt plus the poll interval', async () => {
    // The tick runs exactly on the 12:00 slot (10:00 UTC): the next slot is one interval later.
    vi.setSystemTime(new Date('2026-10-14T10:00:00.000Z'));
    startStravaScheduler();

    await pollJob().run();

    const info = getSyncInfo();
    expect(info.lastSyncAttempt).toBe('2026-10-14T10:00:00.000Z');
    expect(info.nextSyncEstimated).toBe('2026-10-14T22:00:00.000Z');
    expect(new Date(info.nextSyncEstimated!).getTime() - new Date(info.lastSyncAttempt!).getTime()).toBe(STRAVA_POLL_INTERVAL_HOURS * 3_600_000);
  });

  // A restart is a fresh process: the module state starts empty.
  async function freshScheduler(): Promise<typeof import('../stravaSync.js')> {
    vi.resetModules();
    return import('../stravaSync.js');
  }

  it('next_sync_estimated after a restart is the next slot, not now plus the interval', async () => {
    // 14:37 CEST: now + 12 h would be 02:37 the next night, the cron fires at 00:00.
    vi.setSystemTime(new Date('2026-10-14T12:37:00.000Z'));
    const fresh = await freshScheduler();

    fresh.startStravaScheduler();

    expect(fresh.getSyncInfo().lastSyncAttempt).toBeNull();
    expect(fresh.getSyncInfo().nextSyncEstimated).toBe('2026-10-14T22:00:00.000Z');
  });

  it('last-sync after a restart has no attempt yet but already names the next slot, so Settings does not show Unknown', async () => {
    const fresh = await freshScheduler();
    expect(fresh.getSyncInfo().nextSyncEstimated).toBeNull(); // before the scheduler starts, nothing is claimed
    vi.setSystemTime(new Date('2026-10-14T05:15:00.000Z')); // 07:15 CEST

    fresh.startStravaScheduler();

    expect(fresh.getSyncInfo()).toMatchObject({ lastSyncAttempt: null, lastSyncStatus: 'pending', nextSyncEstimated: '2026-10-14T10:00:00.000Z' });
  });

  it('a tick between slots (a late or a manual run) still estimates the next clock slot', async () => {
    startStravaScheduler();
    vi.setSystemTime(new Date('2026-10-14T12:37:00.000Z'));

    await pollJob().run();

    expect(getSyncInfo().nextSyncEstimated).toBe('2026-10-14T22:00:00.000Z');
  });

  it('a poll that starts shortly before a slot estimates that slot, not the one after it', async () => {
    startStravaScheduler();
    vi.setSystemTime(new Date('2026-10-14T09:30:00.000Z')); // 11:30 CEST

    await pollJob().run();

    expect(getSyncInfo().nextSyncEstimated).toBe('2026-10-14T10:00:00.000Z');
  });

  it('a failed sync still estimates the next slot', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    h.syncAllStravaUsers.mockRejectedValueOnce(new Error('strava down'));
    vi.setSystemTime(new Date('2026-10-14T05:00:00.000Z')); // 07:00 CEST: the scheduler's first estimate is 12:00 CEST (10:00Z)
    startStravaScheduler();
    expect(getSyncInfo().nextSyncEstimated).toBe('2026-10-14T10:00:00.000Z');
    vi.setSystemTime(new Date('2026-10-14T10:00:00.000Z'));

    await pollJob().run();

    // Had the failed tick left the estimate alone it would still say 10:00Z, a slot that has just run.
    expect(getSyncInfo()).toMatchObject({ lastSyncStatus: 'error', nextSyncEstimated: '2026-10-14T22:00:00.000Z' });
  });

  it('the estimate moves on when the poll starts, so Settings does not say overdue while it runs', async () => {
    let finish: (value: unknown) => void = () => {};
    h.syncAllStravaUsers.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    vi.setSystemTime(new Date('2026-10-14T05:00:00.000Z'));
    startStravaScheduler();
    vi.setSystemTime(new Date('2026-10-14T10:00:00.000Z'));

    const running = pollJob().run();

    expect(getSyncInfo()).toMatchObject({ lastSyncStatus: 'running', lastSyncAttempt: '2026-10-14T10:00:00.000Z', nextSyncEstimated: '2026-10-14T22:00:00.000Z' });
    finish({ success: true, message: 'ok', syncedUsers: 0, totalUsers: 0, totalNewRuns: 0 });
    await running;
  });

  it('the night clocks go back (2026-10-25) the estimate keeps the wall-clock time: 00:00 CEST is followed by 12:00 CET, 13 hours later', async () => {
    vi.setSystemTime(new Date('2026-10-24T22:00:00.000Z')); // 00:00 CEST
    startStravaScheduler();

    await pollJob().run();

    expect(getSyncInfo().nextSyncEstimated).toBe('2026-10-25T11:00:00.000Z'); // 12:00 CET
    vi.setSystemTime(new Date('2026-10-25T11:00:00.000Z'));
    await pollJob().run();
    expect(getSyncInfo().nextSyncEstimated).toBe('2026-10-25T23:00:00.000Z'); // 00:00 CET on the 26th
  });

  it('the night clocks go forward (2026-03-29) the estimate keeps the wall-clock time: 00:00 CET is followed by 12:00 CEST, 11 hours later', async () => {
    vi.setSystemTime(new Date('2026-03-28T23:00:00.000Z')); // 00:00 CET
    startStravaScheduler();

    await pollJob().run();

    expect(getSyncInfo().nextSyncEstimated).toBe('2026-03-29T10:00:00.000Z'); // 12:00 CEST
    vi.setSystemTime(new Date('2026-03-29T10:00:00.000Z'));
    await pollJob().run();
    expect(getSyncInfo().nextSyncEstimated).toBe('2026-03-29T22:00:00.000Z'); // 00:00 CEST on the 30th
  });

  it('a restart in the middle of a daylight saving night names the 12:00 slot', () => {
    vi.setSystemTime(new Date('2026-10-25T01:30:00.000Z')); // 02:30 CET, the second 02:30 of that night

    startStravaScheduler();

    expect(getSyncInfo().nextSyncEstimated).toBe('2026-10-25T11:00:00.000Z');
  });
});

// node-cron sometimes skips a whole second window, and a redeploy in the 00:00 or 12:00 minute misses the slot. The 30-minute tick then
// notices that the estimated slot is long past and runs the poll once.
describe('catching up a missed poll slot', () => {
  const at = (iso: string) => vi.setSystemTime(new Date(iso));
  const OK = { success: true, message: 'ok', syncedUsers: 0, totalUsers: 0, totalNewRuns: 0 };

  it('a missed poll slot is caught up within half an hour', async () => {
    at('2026-10-14T05:00:00.000Z');
    startStravaScheduler(); // estimate 10:00Z (12:00 CEST); the slot itself never fires
    at('2026-10-14T10:00:00.000Z');
    await weatherJob().run();
    expect(h.syncAllStravaUsers).not.toHaveBeenCalled(); // the slot may still be running on its own

    at('2026-10-14T10:30:00.000Z');
    await weatherJob().run();

    expect(h.syncAllStravaUsers).toHaveBeenCalledTimes(1);
    expect(getSyncInfo()).toMatchObject({ lastSyncAttempt: '2026-10-14T10:30:00.000Z', lastSyncStatus: 'success', nextSyncEstimated: '2026-10-14T22:00:00.000Z' });

    // The catch-up is done: the next ticks do not poll again.
    at('2026-10-14T11:00:00.000Z');
    await weatherJob().run();
    expect(h.syncAllStravaUsers).toHaveBeenCalledTimes(1);
  });

  it('a catch-up poll that fails is not repeated every half hour, and does not stop the weather backfill', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    h.syncAllStravaUsers.mockRejectedValue(new Error('strava down'));
    at('2026-10-14T05:00:00.000Z');
    startStravaScheduler();
    at('2026-10-14T10:30:00.000Z');
    await weatherJob().run();
    at('2026-10-14T11:00:00.000Z');
    await weatherJob().run();

    expect(h.syncAllStravaUsers).toHaveBeenCalledTimes(1);
    expect(h.backfillMissingWeather).toHaveBeenCalledTimes(2);
  });

  it('catch-up never runs while a poll is in progress or before the grace period', async () => {
    let finish: (value: unknown) => void = () => {};
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    at('2026-10-14T05:00:00.000Z');
    startStravaScheduler(); // estimate 10:00Z

    // Before the grace period: five minutes after the slot, the slot's own tick may still be about to run.
    at('2026-10-14T10:05:00.000Z');
    await weatherJob().run();
    expect(h.syncAllStravaUsers).not.toHaveBeenCalled();

    // In progress: a poll that started on the slot and is still running more than twelve hours later.
    h.syncAllStravaUsers.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    at('2026-10-14T10:00:00.000Z');
    const running = pollJob().run();
    at('2026-10-14T22:20:00.000Z'); // the next slot (22:00Z) is past the grace period, the poll has not finished
    await weatherJob().run();
    expect(h.syncAllStravaUsers).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled(); // not even the "missed slot" warning: the poll is not missed, it is slow

    // The scheduled tick for that slot does not start a second poll either.
    await pollJob().run();
    expect(h.syncAllStravaUsers).toHaveBeenCalledTimes(1);

    finish(OK);
    await running;
  });

  it('a failure inside the catch-up check does not stop the weather backfill', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    vi.spyOn(logger, 'warn').mockImplementation(() => { throw new Error('logger down'); });
    at('2026-10-14T05:00:00.000Z');
    startStravaScheduler();
    at('2026-10-14T10:30:00.000Z');

    await expect(weatherJob().run()).resolves.toBeUndefined();

    expect(h.backfillMissingWeather).toHaveBeenCalledTimes(1);
  });

  it('the scheduled tick does not start a poll while a catch-up poll is in progress', async () => {
    let finish: (value: unknown) => void = () => {};
    h.syncAllStravaUsers.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    at('2026-10-14T05:00:00.000Z');
    startStravaScheduler();
    at('2026-10-14T10:30:00.000Z');
    const catchingUp = weatherJob().run();
    await vi.waitFor(() => expect(h.syncAllStravaUsers).toHaveBeenCalledTimes(1));

    await pollJob().run();

    expect(h.syncAllStravaUsers).toHaveBeenCalledTimes(1);
    finish(OK);
    await catchingUp;
  });

  it('catch-up does not trigger after a restart before the first slot', async () => {
    at('2026-10-14T10:00:30.000Z'); // a redeploy in the middle of the 12:00 CEST minute: the slot was missed
    vi.resetModules();
    const fresh = await import('../stravaSync.js');
    fresh.startStravaScheduler();
    expect(fresh.getSyncInfo()).toMatchObject({ lastSyncAttempt: null, nextSyncEstimated: '2026-10-14T22:00:00.000Z' });

    for (const tick of ['2026-10-14T10:30:00.000Z', '2026-10-14T16:00:00.000Z', '2026-10-14T22:00:00.000Z']) {
      at(tick);
      await weatherJob().run();
    }

    expect(h.syncAllStravaUsers).not.toHaveBeenCalled();
  });
});
