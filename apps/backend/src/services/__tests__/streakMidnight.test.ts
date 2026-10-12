/**
 * RUN-216 T1 — repro: "idag" i StreakService var UTC-datumet (processens tidszon), inte Stockholm-datumet.
 * Mellan 00:00 och 02:00 svensk tid ligger UTC-datumet en dag efter Stockholm-datumet, så en runda loggad 00:30
 * (datum = Stockholm-dagen) föll utanför "idag/igår" och current_streak blev 0.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));
vi.mock('../xpConfig.js', () => ({ getXpConfig: vi.fn() }));

import { getSupabaseClient } from '../../config/database.js';
import { StreakService } from '../streakService.js';
import { createFakeDb, type Row } from '../../routes/__tests__/helpers/fakeDb.js';

/** 2026-10-05 00:30 i Stockholm (CEST, UTC+2) = 2026-10-04 22:30 UTC. */
const STOCKHOLM_00_30 = new Date('2026-10-04T22:30:00.000Z');

const runsOn = (...dates: string[]): Row[] => dates.map((date, i) => ({ id: `r${i}`, user_id: 'u1', date }));

function useRuns(runs: Row[]) {
  const db = createFakeDb({ runs });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
}

const originalTz = process.env.TZ;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(STOCKHOLM_00_30);
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
  if (originalTz === undefined) delete process.env.TZ; else process.env.TZ = originalTz;
});

// UTC = Railway-produktionen; Europe/Stockholm = utvecklarmaskinen. Resultatet ska inte bero på processens tidszon.
describe.each(['UTC', 'Europe/Stockholm'])('StreakService vid 00:30 svensk tid (process TZ=%s)', (tz) => {
  beforeEach(() => { process.env.TZ = tz; });

  it('streak counts a run logged 00:30 Stockholm on the same day', async () => {
    useRuns(runsOn('2026-10-03', '2026-10-04', '2026-10-05'));
    const result = await StreakService.calculateUserStreaks('u1');
    expect(result.currentStreak).toBe(3);
    expect(result.longestStreak).toBe(3);
  });

  it('streak day for the new run is counted against the Stockholm date', async () => {
    useRuns(runsOn('2026-10-03', '2026-10-04'));
    const result = await StreakService.calculateUserStreaks('u1', '2026-10-05');
    expect(result.currentStreak).toBe(3);
    expect(result.streakDayForRun).toBe(3);
  });
});
