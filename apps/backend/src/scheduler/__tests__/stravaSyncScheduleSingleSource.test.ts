/**
 * The scheduler takes its interval from STRAVA_POLL_INTERVAL_MINUTES in packages/shared/src/rules.ts. The constant is replaced here by a
 * value the scheduler has never had; a literal in stravaSync.ts would keep 30 and fail both tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({ schedule: vi.fn() }));

// The cron helper keeps its own binding to the real constant, so it is replaced too: the real formatting, applied to the swapped value.
vi.mock('@runquest/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@runquest/shared')>();
  return { ...actual, STRAVA_POLL_INTERVAL_MINUTES: 20, stravaPollCron: () => actual.stravaPollCron(20) };
});
vi.mock('node-cron', () => ({ default: { schedule: (expr: string) => h.schedule(expr) } }));
vi.mock('../../routes/strava.js', () => ({ syncAllStravaUsers: vi.fn() }));
vi.mock('../../services/weatherService.js', () => ({ WeatherService: { backfillMissingWeather: vi.fn() } }));
vi.mock('../../services/enhancedTitleService.js', () => ({ enhancedTitleService: { processAllUsersTitles: vi.fn() } }));

import { startStravaScheduler, getSyncInfo } from '../stravaSync.js';
import { logger } from '../../utils/logger.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-14T12:00:00Z'));
  vi.spyOn(logger, 'info').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('the Strava scheduler takes its interval from shared', () => {
  it('builds the cron expression from STRAVA_POLL_INTERVAL_MINUTES', () => {
    startStravaScheduler();

    expect(h.schedule).toHaveBeenCalledWith('*/20 * * * *');
  });

  it('builds the next-sync estimate from STRAVA_POLL_INTERVAL_MINUTES', () => {
    startStravaScheduler();

    expect(getSyncInfo().nextSyncEstimated).toBe('2026-10-14T12:20:00.000Z');
  });
});
