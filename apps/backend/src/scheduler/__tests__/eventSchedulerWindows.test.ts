/**
 * RUN-218 T2 — karaktärisering av eventfönstren som eventScheduler räknar ut (startsAt/endsAt).
 *
 * eventScheduler hade en egen kopia av Stockholm-tid -> UTC (`atStockholm`) som inte exporteras, så fönstren testas
 * här genom att trigga cron-jobben och läsa argumenten till maybeCreateEvent. Klockan fryses per fall.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  crons: new Map<string, () => Promise<void>>(),
  maybeCreateEvent: vi.fn(),
  getAllGroupIds: vi.fn(),
  getEventPool: vi.fn(),
  checkStormChaserForecast: vi.fn(),
}));

vi.mock('node-cron', () => ({
  default: { schedule: (expr: string, cb: () => Promise<void>) => { h.crons.set(expr, cb); } },
}));
vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  testDatabaseConnection: vi.fn(),
  getSupabaseClient: vi.fn(),
}));
vi.mock('../../services/eventService.js', () => ({
  maybeCreateEvent: h.maybeCreateEvent,
  getAllGroupIds: h.getAllGroupIds,
  getEventPool: h.getEventPool,
  settleCompetitionEvents: vi.fn(),
  settleExpiredParticipationEvents: vi.fn(),
  activateScheduledEvents: vi.fn(),
  checkStormChaserForecast: h.checkStormChaserForecast,
}));

import { logger } from '../../utils/logger.js';
import { startEventScheduler } from '../eventScheduler.js';

const DAILY = '0 19 * * *';
const WEEKEND = '0 22 * * 5,6';
const WEEKLY = '0 20 * * 6';

interface Member { name: string; startHour: number; endHour: number; endMinute: number; endDayOffset: number }
const member = (m: Partial<Member> = {}) => ({
  name: 'Test event', weight: 1, condition: null, startHour: 0, endHour: 23, endMinute: 59, endDayOffset: 0, ...m,
});

/** Kör cron-jobbet `expr` vid ögonblicket `now` och returnerar [startsAt, endsAt] (ISO) som events skapades med. */
async function windowOf(expr: string, now: string, members: Array<ReturnType<typeof member>>): Promise<[string, string]> {
  vi.setSystemTime(new Date(now));
  h.getAllGroupIds.mockResolvedValue(['g1']);
  h.getEventPool.mockResolvedValue({ triggerChance: 1, members });
  h.checkStormChaserForecast.mockResolvedValue(false);
  h.maybeCreateEvent.mockResolvedValue(true);
  startEventScheduler();
  await h.crons.get(expr)!();
  expect(h.maybeCreateEvent).toHaveBeenCalledTimes(1);
  const [, , startsAt, endsAt] = h.maybeCreateEvent.mock.calls[0] as [string, string, Date, Date];
  return [startsAt.toISOString(), endsAt.toISOString()];
}

beforeEach(() => {
  vi.clearAllMocks();
  h.crons.clear();
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0);
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Hangover Run — hela nästa dag 00:00–23:59 Stockholm', () => {
  it('sommar (+2): fredag 22:00 Stockholm -> lördagen 2026-07-04', async () => {
    expect(await windowOf(WEEKEND, '2026-07-03T20:00:00Z', [member()])).toEqual(['2026-07-03T22:00:00.000Z', '2026-07-04T21:59:00.000Z']);
  });

  it('vinter (+1): fredag 22:00 Stockholm -> lördagen 2026-01-10', async () => {
    expect(await windowOf(WEEKEND, '2026-01-09T21:00:00Z', [member()])).toEqual(['2026-01-09T23:00:00.000Z', '2026-01-10T22:59:00.000Z']);
  });

  it('lördag 22:00 Stockholm i juli (20:00 UTC) -> söndagen 2026-07-05', async () => {
    expect(await windowOf(WEEKEND, '2026-07-04T20:00:00Z', [member()])).toEqual(['2026-07-04T22:00:00.000Z', '2026-07-05T21:59:00.000Z']);
  });
});

describe('daglig lottning — event som slutar efter midnatt (endDayOffset 1)', () => {
  it('sommar: 20:00 -> 01:00 nästa dag', async () => {
    const evening = member({ name: 'Kvällsrunda', startHour: 20, endHour: 1, endMinute: 0, endDayOffset: 1 });
    expect(await windowOf(DAILY, '2026-07-06T17:00:00Z', [evening])).toEqual(['2026-07-07T18:00:00.000Z', '2026-07-07T23:00:00.000Z']);
  });

  it('vinter: 05:00 -> 07:30 samma dag', async () => {
    const morning = member({ name: 'Morgonrunda', startHour: 5, endHour: 7, endMinute: 30, endDayOffset: 0 });
    expect(await windowOf(DAILY, '2026-01-12T18:00:00Z', [morning])).toEqual(['2026-01-13T04:00:00.000Z', '2026-01-13T06:30:00.000Z']);
  });

  it('dag efter vårens sommartidsskifte (söndag 2026-03-29 -> måndag 30:e): 05:00 ligger efter växlingen', async () => {
    const morning = member({ startHour: 5, endHour: 7, endMinute: 0 });
    expect(await windowOf(DAILY, '2026-03-29T17:00:00Z', [morning])).toEqual(['2026-03-30T03:00:00.000Z', '2026-03-30T05:00:00.000Z']);
  });

  it('söndagen med vårens skifte (lördag kväll -> 2026-03-29): 05:00 och 23:59 ligger efter växlingen (+2)', async () => {
    const day = member({ startHour: 5, endHour: 23, endMinute: 59 });
    expect(await windowOf(DAILY, '2026-03-28T18:00:00Z', [day])).toEqual(['2026-03-29T03:00:00.000Z', '2026-03-29T21:59:00.000Z']);
  });

  it('söndagen med höstens skifte (lördag kväll -> 2026-10-25): 05:00 och 23:59 ligger efter växlingen (+1)', async () => {
    const day = member({ startHour: 5, endHour: 23, endMinute: 59 });
    expect(await windowOf(DAILY, '2026-10-24T17:00:00Z', [day])).toEqual(['2026-10-25T04:00:00.000Z', '2026-10-25T22:59:00.000Z']);
  });
});

describe('veckotävlingen — måndag 00:01 till söndag 23:59, bokad lördag kväll', () => {
  it('sommar', async () => {
    // Lördag 2026-07-04 -> måndag 6 juli 00:01 CEST ... söndag 12 juli 23:59 CEST
    expect(await windowOf(WEEKLY, '2026-07-04T18:00:00Z', [member({ startHour: 0, endHour: 23, endMinute: 59 })]))
      .toEqual(['2026-07-05T22:01:00.000Z', '2026-07-12T21:59:00.000Z']);
  });

  it('veckan efter vårens skifte: måndag 30 mars börjar i sommartid (+2)', async () => {
    expect(await windowOf(WEEKLY, '2026-03-28T19:00:00Z', [member()])).toEqual(['2026-03-29T22:01:00.000Z', '2026-04-05T21:59:00.000Z']);
  });

  it('veckan efter höstens skifte: måndag 26 oktober börjar i vintertid (+1), söndag 1 november slutar i vintertid', async () => {
    expect(await windowOf(WEEKLY, '2026-10-24T18:00:00Z', [member()])).toEqual(['2026-10-25T23:01:00.000Z', '2026-11-01T22:59:00.000Z']);
  });

  it('veckan 16–22 mars: vintertid hela vägen', async () => {
    expect(await windowOf(WEEKLY, '2026-03-14T19:00:00Z', [member()])).toEqual(['2026-03-15T23:01:00.000Z', '2026-03-22T22:59:00.000Z']);
  });

  it('veckan som slutar på vårens skiftessöndag 2026-03-29: söndag 23:59 ligger efter växlingen (+2)', async () => {
    expect(await windowOf(WEEKLY, '2026-03-21T19:00:00Z', [member()])).toEqual(['2026-03-22T23:01:00.000Z', '2026-03-29T21:59:00.000Z']);
  });

  it('veckan som slutar på höstens skiftessöndag 2026-10-25: söndag 23:59 ligger efter växlingen (+1)', async () => {
    expect(await windowOf(WEEKLY, '2026-10-17T18:00:00Z', [member()])).toEqual(['2026-10-18T22:01:00.000Z', '2026-10-25T22:59:00.000Z']);
  });
});

describe('Hangover Run på själva skiftessöndagen — offseten tas vid klockslaget, inte vid middagen', () => {
  // Före RUN-218 räknade eventScheduler hela dagen med offseten vid 12:00. 00:00 ligger FÖRE växlingen, så fönstret började
  // en timme fel på de två skiftesdagarna (vår: 23:00 lördag lokal tid, höst: 01:00 söndag lokal tid). Nu börjar det vid
  // verklig Stockholm-midnatt. Slutet (23:59) ligger efter växlingen och var redan rätt.
  it('vår (lördag 22:00 -> söndag 2026-03-29): start 23:00 UTC = 00:00 CET', async () => {
    expect(await windowOf(WEEKEND, '2026-03-28T21:00:00Z', [member()])).toEqual(['2026-03-28T23:00:00.000Z', '2026-03-29T21:59:00.000Z']);
  });

  it('höst (lördag 22:00 -> söndag 2026-10-25): start 22:00 UTC = 00:00 CEST', async () => {
    expect(await windowOf(WEEKEND, '2026-10-24T20:00:00Z', [member()])).toEqual(['2026-10-24T22:00:00.000Z', '2026-10-25T22:59:00.000Z']);
  });
});
