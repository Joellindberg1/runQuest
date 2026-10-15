/**
 * The scheduler takes its interval from STRAVA_POLL_INTERVAL_HOURS in packages/shared/src/rules.ts. The constant is replaced here by a
 * value the scheduler has never had; a literal in stravaSync.ts would keep 12 and fail both tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({ schedule: vi.fn(), runs: new Map<string, () => Promise<void>>() }));

// The helpers keep their own binding to the real constant, so their default is replaced too: the real logic, applied to the swapped
// value. An explicit argument is forwarded untouched, so a scheduler that passes its own number (a literal 12) is not hidden.
vi.mock('@runquest/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@runquest/shared')>();
  return {
    ...actual,
    STRAVA_POLL_INTERVAL_HOURS: 6,
    stravaPollCron: (hours = 6) => actual.stravaPollCron(hours),
    stravaPollIntervalLabel: (hours = 6) => actual.stravaPollIntervalLabel(hours),
    nextStravaPollSlot: (from: Date, hours = 6) => actual.nextStravaPollSlot(from, hours),
  };
});
vi.mock('node-cron', () => ({ default: { schedule: (expr: string, run: () => Promise<void>, options: unknown) => { h.runs.set(expr, run); h.schedule(expr, options); } } }));
vi.mock('../../routes/strava.js', () => ({ syncAllStravaUsers: vi.fn().mockResolvedValue({ success: true, message: 'ok', syncedUsers: 0, totalUsers: 0, totalNewRuns: 0 }) }));
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

  it('builds the estimate after a tick from STRAVA_POLL_INTERVAL_HOURS too', async () => {
    startStravaScheduler();
    vi.setSystemTime(new Date('2026-10-14T12:00:00Z')); // 14:00 CEST: the next 6-hour slot is 18:00, the next 12-hour slot would be 00:00

    await h.runs.get('0 */6 * * *')!();

    expect(getSyncInfo().nextSyncEstimated).toBe('2026-10-14T16:00:00.000Z'); // 18:00 CEST
  });

  it('names the interval in the start-up log from the shared label', () => {
    startStravaScheduler();

    expect(vi.mocked(logger.info).mock.calls.some(([line]) => String(line).includes('6 hours'))).toBe(true);
  });
});
