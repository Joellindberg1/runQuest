/**
 * RUN-99 T5 — efter väder-backfillen räknas titlarna om (alla grupper, RUN-104:s explicita allGroups) men bara när
 * backfillen faktiskt sparade rader. Titlarna hänger på väder (Stormborn/Iceborn) som kommer efter importen.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  cronCallback: null as null | (() => Promise<void>),
  syncAllStravaUsers: vi.fn(),
  backfillMissingWeather: vi.fn(),
  processAllUsersTitles: vi.fn(),
  order: [] as string[],
}));

vi.mock('node-cron', () => ({
  default: { schedule: (_expr: string, cb: () => Promise<void>) => { h.cronCallback = cb; } },
}));
vi.mock('../../routes/strava.js', () => ({ syncAllStravaUsers: h.syncAllStravaUsers }));
vi.mock('../../services/weatherService.js', () => ({ WeatherService: { backfillMissingWeather: h.backfillMissingWeather } }));
vi.mock('../../services/enhancedTitleService.js', () => ({ enhancedTitleService: { processAllUsersTitles: h.processAllUsersTitles } }));

import { startStravaScheduler, getSyncInfo } from '../stravaSync.js';
import { logger } from '../../utils/logger.js';

async function runTick(): Promise<void> {
  expect(h.cronCallback).not.toBeNull();
  await h.cronCallback!();
}

beforeEach(() => {
  vi.clearAllMocks();
  h.order.length = 0;
  h.syncAllStravaUsers.mockResolvedValue({ success: true, message: 'ok', syncedUsers: 1, totalUsers: 1, totalNewRuns: 0 });
  h.backfillMissingWeather.mockImplementation(async () => { h.order.push('backfill'); return 0; });
  h.processAllUsersTitles.mockImplementation(async () => { h.order.push('titles'); return { total: 1, processed: 1, failed: 0 }; });
  startStravaScheduler();
});

describe('stravaSync — titelomräkning efter väder-backfill', () => {
  it('titelomräkning körs efter backfill endast när rader sparades', async () => {
    h.backfillMissingWeather.mockImplementation(async () => { h.order.push('backfill'); return 3; });
    await runTick();

    expect(h.processAllUsersTitles).toHaveBeenCalledTimes(1);
    expect(h.processAllUsersTitles).toHaveBeenCalledWith(undefined, { allGroups: true });
    expect(h.order).toEqual(['backfill', 'titles']);
  });

  it('inga sparade rader → ingen omräkning', async () => {
    h.backfillMissingWeather.mockResolvedValue(0);
    await runTick();

    expect(h.backfillMissingWeather).toHaveBeenCalledTimes(1);
    expect(h.processAllUsersTitles).not.toHaveBeenCalled();
  });

  it('ett fel i omräkningen fäller inte synkstatusen (synken lyckades)', async () => {
    h.backfillMissingWeather.mockResolvedValue(2);
    h.processAllUsersTitles.mockRejectedValue(new Error('boom'));
    await expect(runTick()).resolves.toBeUndefined();

    expect(getSyncInfo().lastSyncStatus).toBe('success');
  });
});

describe('misslyckade användare i titelomräkningen efter väder syns i loggen', () => {
  it('failed > 0 ger logger.warn med antalen och fäller inte synkstatusen', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    h.backfillMissingWeather.mockResolvedValue(2);
    h.processAllUsersTitles.mockResolvedValue({ total: 6, processed: 5, failed: 1 });

    await runTick();

    expect(warn.mock.calls.some((c) => /1.*6/.test(String(c[0])))).toBe(true);
    expect(getSyncInfo().lastSyncStatus).toBe('success');
    warn.mockRestore();
  });

  it('failed 0 ger ingen varning', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    h.backfillMissingWeather.mockResolvedValue(2);
    h.processAllUsersTitles.mockResolvedValue({ total: 6, processed: 6, failed: 0 });

    await runTick();

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
