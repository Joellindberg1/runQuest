/**
 * The scheduler takes its interval from STRAVA_POLL_INTERVAL_HOURS in packages/shared/src/rules.ts. The constant is replaced here by a
 * value the scheduler has never had; a literal in stravaSync.ts would keep 12 and fail both tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({ schedule: vi.fn() }));

// The helpers keep their own binding to the real constant, so they are replaced too: the real logic, applied to the swapped value.
vi.mock('@runquest/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@runquest/shared')>();
  return {
    ...actual,
    STRAVA_POLL_INTERVAL_HOURS: 6,
    stravaPollCron: () => actual.stravaPollCron(6),
    stravaPollIntervalLabel: () => actual.stravaPollIntervalLabel(6),
    nextStravaPollSlot: (from: Date) => actual.nextStravaPollSlot(from, 6),
  };
});
vi.mock('node-cron', () => ({ default: { schedule: (expr: string, _run: unknown, options: unknown) => h.schedule(expr, options) } }));
vi.mock('../../routes/strava.js', () => ({ syncAllStravaUsers: vi.fn() }));
vi.mock('../../services/weatherService.js', () => ({ WeatherService: { backfillMissingWeather: vi.fn() } }));
vi.mock('../../services/enhancedTitleService.js', () => ({ enhancedTitleService: { processAllUsersTitles: vi.fn() } }));

import { startStravaScheduler, getSyncInfo } from '../stravaSync.js';
import { logger } from '../../utils/logger.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-14T12:00:00Z')); // 14:00 CEST
  vi.spyOn(logger, 'info').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('the Strava scheduler takes its interval from shared', () => {
  it('builds the cron expression from STRAVA_POLL_INTERVAL_HOURS', () => {
    startStravaScheduler();

    expect(h.schedule).toHaveBeenCalledWith('0 */6 * * *', { timezone: 'Europe/Stockholm' });
  });

  it('builds the next-sync estimate from STRAVA_POLL_INTERVAL_HOURS', () => {
    startStravaScheduler();

    expect(getSyncInfo().nextSyncEstimated).toBe('2026-10-14T16:00:00.000Z'); // 18:00 CEST
  });

  it('names the interval in the start-up log from the shared label', () => {
    startStravaScheduler();

    expect(vi.mocked(logger.info).mock.calls.some(([line]) => String(line).includes('6 hours'))).toBe(true);
  });
});
