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

  it('a tick that fires a few milliseconds early still estimates the slot after it, not the slot it belongs to', async () => {
    startStravaScheduler();
    vi.setSystemTime(new Date('2026-10-14T09:59:59.950Z')); // 11:59:59.950 CEST, the 12:00 slot fired early

    await pollJob().run();

    expect(getSyncInfo().nextSyncEstimated).toBe('2026-10-14T22:00:00.000Z');
  });

  it('a failed sync still estimates the next slot', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    h.syncAllStravaUsers.mockRejectedValueOnce(new Error('strava down'));
    vi.setSystemTime(new Date('2026-10-14T10:00:00.000Z'));
    startStravaScheduler();

    await pollJob().run();

    expect(getSyncInfo()).toMatchObject({ lastSyncStatus: 'error', nextSyncEstimated: '2026-10-14T22:00:00.000Z' });
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
