/**
 * RUN-216 T2 — karaktärisering av StreakService.calculateUserStreaks (publikt API) för prod-lika historiker.
 *
 * Skrivna FÖRE flytten till shared och gröna både före och efter. "Nu" ligger mitt på dagen (14:00 Stockholm) så att
 * UTC-datum och Stockholm-datum är samma dag — midnattsfallet har sitt eget repro-test (streakMidnight.test.ts).
 * Processens tidszon sätts till UTC som i Railway-prod.
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

const NOW = new Date('2026-10-05T12:00:00.000Z');

const runsOn = (...dates: string[]): Row[] => dates.map((date, i) => ({ id: `r${i}`, user_id: 'u1', date }));

/** n dagar i rad som slutar på `end`. */
function consecutiveUntil(end: string, n: number): string[] {
  const endMs = Date.parse(`${end}T12:00:00Z`);
  return Array.from({ length: n }, (_, i) => new Date(endMs - (n - 1 - i) * 86400000).toISOString().slice(0, 10));
}

async function streaks(dates: string[], newRunDate?: string) {
  const db = createFakeDb({ runs: runsOn(...dates) });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return StreakService.calculateUserStreaks('u1', newRunDate);
}

const originalTz = process.env.TZ;
beforeEach(() => {
  process.env.TZ = 'UTC';
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
  if (originalTz === undefined) delete process.env.TZ; else process.env.TZ = originalTz;
});

describe('StreakService.calculateUserStreaks — dagens beteende', () => {
  it('ingen historik ger 0 / 1 / 0', async () => {
    expect(await streaks([])).toEqual({ currentStreak: 0, streakDayForRun: 1, longestStreak: 0 });
  });

  it('en ensam runda idag: aktuell 1, längsta 1', async () => {
    expect(await streaks(['2026-10-05'])).toEqual({ currentStreak: 1, streakDayForRun: 1, longestStreak: 1 });
  });

  it('streak som slutar idag räknas hela vägen', async () => {
    const r = await streaks(consecutiveUntil('2026-10-05', 7));
    expect(r.currentStreak).toBe(7);
    expect(r.longestStreak).toBe(7);
  });

  it('streak som slutar igår lever fortfarande (kan räddas idag)', async () => {
    const r = await streaks(consecutiveUntil('2026-10-04', 4));
    expect(r.currentStreak).toBe(4);
    expect(r.longestStreak).toBe(4);
  });

  it('streak vars senaste dag är förrgår är bruten: aktuell 0, längsta bevarad', async () => {
    const r = await streaks(consecutiveUntil('2026-10-03', 6));
    expect(r.currentStreak).toBe(0);
    expect(r.longestStreak).toBe(6);
  });

  it('en ensam gammal runda: aktuell 0, längsta 1', async () => {
    const r = await streaks(['2026-07-04']);
    expect(r.currentStreak).toBe(0);
    expect(r.longestStreak).toBe(1);
  });

  it('längsta streaken kan ligga bakåt i tiden medan aktuell är kortare', async () => {
    const r = await streaks([...consecutiveUntil('2026-09-10', 9), '2026-10-04', '2026-10-05']);
    expect(r.currentStreak).toBe(2);
    expect(r.longestStreak).toBe(9);
  });

  it('glapp i mitten bryter aktuell men inte längsta (3 i rad, glapp, 2 i rad som slutar idag)', async () => {
    const r = await streaks(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-04', '2026-10-05']);
    expect(r.currentStreak).toBe(2);
    expect(r.longestStreak).toBe(3);
  });

  it('flera rundor samma dag räknas som en dag', async () => {
    const r = await streaks(['2026-10-03', '2026-10-04', '2026-10-04', '2026-10-04', '2026-10-05', '2026-10-05']);
    expect(r.currentStreak).toBe(3);
    expect(r.longestStreak).toBe(3);
  });

  it('streak över månadsskifte och sommartidsskifte (okt 24-26) räknas obruten', async () => {
    const r = await streaks(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05']);
    expect(r.currentStreak).toBe(7);
    const dst = await streaks(['2026-10-24', '2026-10-25', '2026-10-26']);
    expect(dst.longestStreak).toBe(3);
  });

  it('streak över årsskifte räknas obruten', async () => {
    const r = await streaks(['2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02']);
    expect(r.longestStreak).toBe(4);
  });

  it('newRunDate läggs till temporärt och ger sin streak-dag (retroaktiv runda i mitten av en streak)', async () => {
    const r = await streaks(['2026-10-01', '2026-10-03'], '2026-10-02');
    expect(r.streakDayForRun).toBe(2);
    expect(r.longestStreak).toBe(3);
  });

  it('newRunDate som förlänger dagens streak: streakDayForRun och aktuell följer med', async () => {
    const r = await streaks(['2026-10-03', '2026-10-04'], '2026-10-05');
    expect(r).toEqual({ currentStreak: 3, streakDayForRun: 3, longestStreak: 3 });
  });

  it('newRunDate efter ett glapp startar om på dag 1', async () => {
    const r = await streaks(['2026-10-01', '2026-10-02'], '2026-10-05');
    expect(r.streakDayForRun).toBe(1);
    expect(r.currentStreak).toBe(1);
    expect(r.longestStreak).toBe(2);
  });

  it('newRunDate på en dag som redan har en runda dubbelräknas inte', async () => {
    const r = await streaks(['2026-10-04', '2026-10-05'], '2026-10-05');
    expect(r).toEqual({ currentStreak: 2, streakDayForRun: 2, longestStreak: 2 });
  });
});
