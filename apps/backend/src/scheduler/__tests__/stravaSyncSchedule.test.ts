/**
 * How often the Strava sync runs. Real constants: every 30 minutes, next-sync estimate 30 minutes ahead.
 * stravaSyncScheduleSingleSource.test.ts proves the scheduler takes the value from packages/shared/src/rules.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  schedule: vi.fn(),
  calculateUserTotals: vi.fn(),
  processAllUsersTitles: vi.fn(),
  callback: null as null | (() => Promise<void>),
}));

vi.mock('node-cron', () => ({
  default: { schedule: (expr: string, cb: () => Promise<void>) => { h.schedule(expr); h.callback = cb; } },
}));
vi.mock('../../routes/strava.js', () => ({
  syncAllStravaUsers: vi.fn().mockResolvedValue({ success: true, message: 'ok', syncedUsers: 0, totalUsers: 0, totalNewRuns: 0 }),
}));
vi.mock('../../services/weatherService.js', () => ({ WeatherService: { backfillMissingWeather: vi.fn().mockResolvedValue(0) } }));
vi.mock('../../services/enhancedTitleService.js', () => ({ enhancedTitleService: { processAllUsersTitles: h.processAllUsersTitles } }));
vi.mock('../../utils/calculateUserTotals.js', () => ({ calculateUserTotals: h.calculateUserTotals }));

import { startStravaScheduler, getSyncInfo } from '../stravaSync.js';
import { logger } from '../../utils/logger.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-14T12:00:00Z'));
  vi.spyOn(logger, 'info').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('Strava sync schedule', () => {
  it('runs every 30 minutes', () => {
    startStravaScheduler();

    expect(h.schedule).toHaveBeenCalledTimes(1);
    expect(h.schedule).toHaveBeenCalledWith('*/30 * * * *');
  });

  it('estimates the next sync 30 minutes ahead', () => {
    startStravaScheduler();

    expect(getSyncInfo().nextSyncEstimated).toBe('2026-10-14T12:30:00.000Z');
  });

  it('a scheduled tick without saved weather recalculates neither totals nor titles', async () => {
    startStravaScheduler();

    await h.callback!();

    expect(h.calculateUserTotals).not.toHaveBeenCalled();
    expect(h.processAllUsersTitles).not.toHaveBeenCalled();
  });
});
