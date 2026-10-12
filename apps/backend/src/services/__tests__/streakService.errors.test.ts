/**
 * RUN-215 T4 — StreakService sväljer inte läsfel.
 *
 * Tidigare: ett läsfel på runs gav { currentStreak: 0, longestStreak: 0 }, som nattjobbet skrev rakt in i users och
 * dessutom tolkade som "streaken dog" (streak_broken). Ett uppdateringsfel returnerade tyst, så schedulern räknade
 * användaren som lyckad. Felhanteringen här är ensam om uppgiften — streak-LOGIKEN konsolideras i F4.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));
vi.mock('../xpConfig.js', () => ({ getXpConfig: vi.fn() }));

import { getSupabaseClient } from '../../config/database.js';
import { getXpConfig } from '../xpConfig.js';
import { logger } from '../../utils/logger.js';
import { StreakService } from '../streakService.js';
import { createFakeDb, type Row, type RecordedQuery } from '../../routes/__tests__/helpers/fakeDb.js';

const NOW = new Date('2026-10-05T12:00:00.000Z');

function days(start: string, n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `r${start}${i}`, user_id: 'u1',
    date: new Date(Date.parse(`${start}T12:00:00Z`) + i * 86400000).toISOString().slice(0, 10),
  }));
}

function use(tables: Record<string, Row[]>, failWhen?: (q: RecordedQuery) => { message: string } | null) {
  const db = createFakeDb(tables, { numericIds: ['activity_log'], failWhen });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return db;
}

/** Streak 7 som hade dött av uppehåll (sista rundan 2026-09-07) — streak_broken-fallet. */
const brokenStreakTables = (): Record<string, Row[]> => ({
  activity_log: [],
  users: [{ id: 'u1', group_id: 'g1', current_streak: 7, longest_streak: 7 }],
  runs: days('2026-09-01', 7),
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  vi.mocked(getXpConfig).mockResolvedValue({ streak_multipliers: [{ days: 5, multiplier: 1.1 }] } as any);
  vi.spyOn(logger, 'error').mockImplementation(() => {});
  vi.spyOn(logger, 'info').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const runsReadFails = (q: RecordedQuery) => (q.table === 'runs' ? { message: 'runs read failed' } : null);

describe('StreakService — läsfel', () => {
  it('streak job never writes 0/0 after a read failure', async () => {
    const tables = brokenStreakTables();
    use(tables, runsReadFails);

    await expect(StreakService.updateUserStreak('u1')).rejects.toThrow(/runs read failed/);

    expect(tables.users[0]).toMatchObject({ current_streak: 7, longest_streak: 7 });
  });

  it('läsfel ger ingen streak_broken-rad', async () => {
    const tables = brokenStreakTables();
    use(tables, runsReadFails);

    await expect(StreakService.updateUserStreak('u1')).rejects.toThrow();
    expect(tables.activity_log).toHaveLength(0);
  });

  it('calculateUserStreaks kastar vid läsfel i stället för att returnera 0/0', async () => {
    use(brokenStreakTables(), runsReadFails);
    await expect(StreakService.calculateUserStreaks('u1')).rejects.toThrow(/runs read failed/);
  });

  it('läsfel på föregående streak (users) kastas — annars försvinner streak_broken tyst', async () => {
    const tables = brokenStreakTables();
    use(tables, (q) => (q.table === 'users' && q.select ? { message: 'users read failed' } : null));

    await expect(StreakService.updateUserStreak('u1')).rejects.toThrow(/users read failed/);
    expect(tables.users[0].current_streak).toBe(7);
  });
});

describe('StreakService — uppdateringsfel', () => {
  it('uppdateringsfel kastas så att schedulern ser det, och ingen streak_broken loggas', async () => {
    const tables = brokenStreakTables();
    use(tables, (q) => (q.table === 'users' && q.mutation === 'update' ? { message: 'update failed' } : null));

    await expect(StreakService.updateUserStreak('u1')).rejects.toThrow(/update failed/);
    expect(tables.users[0].current_streak).toBe(7);
    expect(tables.activity_log).toHaveLength(0);
  });
});

describe('StreakService — lyckad väg oförändrad', () => {
  it('en död streak skrivs som 0 och loggar streak_broken', async () => {
    const tables = brokenStreakTables();
    use(tables);

    await expect(StreakService.updateUserStreak('u1')).resolves.toBeUndefined();
    expect(tables.users[0]).toMatchObject({ current_streak: 0, longest_streak: 7 });
    expect(tables.activity_log.map((r) => r.type)).toEqual(['streak_broken']);
  });

  it('en användare utan rundor ger 0/0 utan fel (äkta noll är inte ett läsfel)', async () => {
    const tables: Record<string, Row[]> = { activity_log: [], users: [{ id: 'u1', group_id: 'g1', current_streak: 0, longest_streak: 0 }], runs: [] };
    use(tables);
    await expect(StreakService.calculateUserStreaks('u1')).resolves.toEqual({ currentStreak: 0, streakDayForRun: 1, longestStreak: 0 });
    await expect(StreakService.updateUserStreak('u1')).resolves.toBeUndefined();
  });
});
