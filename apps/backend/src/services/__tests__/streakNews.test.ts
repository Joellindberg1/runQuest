/**
 * streak_broken (ADR 008 beslut 5): loggas av nattjobbet (StreakService.updateUserStreak) när en
 * streak ≥ T (lägsta days i streak_multipliers) dött av uppehåll — INTE av calculateUserTotals.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  testDatabaseConnection: vi.fn(),
  getSupabaseClient: vi.fn(),
}));
vi.mock('../xpConfig.js', () => ({ getXpConfig: vi.fn() }));

import { getSupabaseClient } from '../../config/database.js';
import { getXpConfig } from '../xpConfig.js';
import { StreakService } from '../streakService.js';
import { createFakeDb, type Row } from '../../routes/__tests__/helpers/fakeDb.js';

const NOW = new Date('2026-10-05T12:00:00.000Z');
const MULTIPLIERS = [{ days: 5, multiplier: 1.1 }, { days: 15, multiplier: 1.2 }];

function days(start: string, n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `r${start}${i}`, user_id: 'u1',
    date: new Date(Date.parse(`${start}T12:00:00Z`) + i * 86400000).toISOString().slice(0, 10),
  }));
}

function use(tables: Record<string, Row[]>, options: Parameters<typeof createFakeDb>[1] = {}) {
  const db = createFakeDb(tables, { numericIds: ['activity_log'], ...options });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return db;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  vi.mocked(getXpConfig).mockResolvedValue({ streak_multipliers: MULTIPLIERS } as any);
});
afterEach(() => { vi.useRealTimers(); });

describe('StreakService.updateUserStreak → streak_broken', () => {
  it('streak 7 som dött av uppehåll → en rad: längd, sista dag, kl 00:00 Stockholm dag+2', async () => {
    const tables: Record<string, Row[]> = {
      activity_log: [], users: [{ id: 'u1', group_id: 'g1', current_streak: 7, longest_streak: 7 }],
      runs: days('2026-09-01', 7), // sista dag 2026-09-07
    };
    use(tables);
    await StreakService.updateUserStreak('u1');

    expect(tables.users[0]).toMatchObject({ current_streak: 0, longest_streak: 7 });
    expect(tables.activity_log).toHaveLength(1);
    expect(tables.activity_log[0]).toMatchObject({
      type: 'streak_broken', group_id: 'g1', actor_user_id: 'u1', target_user_id: null, is_backfill: false,
      payload: { length: 7, last_run_date: '2026-09-07' },
      dedupe_key: 'streak_broken:u1:2026-09-07',
      occurred_at: '2026-09-08T22:00:00.000Z', // 2026-09-09 00:00 CEST
    });
  });

  it('nattjobbet kör igen → ingen dubblett (föregående streak är nu 0, och nyckeln skyddar även om den vore kvar)', async () => {
    const tables: Record<string, Row[]> = {
      activity_log: [], users: [{ id: 'u1', group_id: 'g1', current_streak: 7, longest_streak: 7 }], runs: days('2026-09-01', 7),
    };
    use(tables);
    await StreakService.updateUserStreak('u1');
    await StreakService.updateUserStreak('u1');
    tables.users[0].current_streak = 7; // t.ex. kvarvarande gammalt värde på en andra instans
    await StreakService.updateUserStreak('u1');
    expect(tables.activity_log).toHaveLength(1);
  });

  it('streak under T ger ingen rad', async () => {
    const tables: Record<string, Row[]> = {
      activity_log: [], users: [{ id: 'u1', group_id: 'g1', current_streak: 4 }], runs: days('2026-09-01', 4),
    };
    use(tables);
    await StreakService.updateUserStreak('u1');
    expect(tables.activity_log).toHaveLength(0);
  });

  it('T läses ur streak_multipliers (lägsta days)', async () => {
    vi.mocked(getXpConfig).mockResolvedValue({ streak_multipliers: [{ days: 3, multiplier: 1.1 }] } as any);
    const tables: Record<string, Row[]> = {
      activity_log: [], users: [{ id: 'u1', group_id: 'g1', current_streak: 3 }], runs: days('2026-09-01', 3),
    };
    use(tables);
    await StreakService.updateUserStreak('u1');
    expect(tables.activity_log).toHaveLength(1);
  });

  it('streak som lever (sprang igår) ger ingen rad', async () => {
    const tables: Record<string, Row[]> = {
      activity_log: [], users: [{ id: 'u1', group_id: 'g1', current_streak: 6 }], runs: days('2026-09-28', 7), // 09-28 … 10-04: senaste dag = igår (Stockholm) → streaken lever
    };
    use(tables);
    await StreakService.updateUserStreak('u1');
    expect(tables.users[0].current_streak).toBe(7);
    expect(tables.activity_log).toHaveLength(0);
  });

  it('raderad sista runda (inga rundor kvar) är datakorrigering — ingen rad', async () => {
    const tables: Record<string, Row[]> = { activity_log: [], users: [{ id: 'u1', group_id: 'g1', current_streak: 9 }], runs: [] };
    use(tables);
    await StreakService.updateUserStreak('u1');
    expect(tables.users[0].current_streak).toBe(0);
    expect(tables.activity_log).toHaveLength(0);
  });

  it('användare utan grupp ger ingen rad', async () => {
    const tables: Record<string, Row[]> = {
      activity_log: [], users: [{ id: 'u1', group_id: null, current_streak: 7 }], runs: days('2026-09-01', 7),
    };
    use(tables);
    await StreakService.updateUserStreak('u1');
    expect(tables.activity_log).toHaveLength(0);
  });

  it('ett fel i loggningen (xpConfig kastar) fäller inte streak-uppdateringen', async () => {
    vi.mocked(getXpConfig).mockRejectedValue(new Error('boom'));
    const tables: Record<string, Row[]> = {
      activity_log: [], users: [{ id: 'u1', group_id: 'g1', current_streak: 7 }], runs: days('2026-09-01', 7),
    };
    use(tables);
    await expect(StreakService.updateUserStreak('u1')).resolves.toBeUndefined();
    expect(tables.users[0].current_streak).toBe(0);
    expect(tables.activity_log).toHaveLength(0);
  });

  it('misslyckad users-update ger ingen rad (loggen följer efter den underliggande skrivningen)', async () => {
    const tables: Record<string, Row[]> = {
      activity_log: [], users: [{ id: 'u1', group_id: 'g1', current_streak: 7 }], runs: days('2026-09-01', 7),
    };
    use(tables, { failWhen: (q) => (q.table === 'users' && q.select === null ? { message: 'update failed' } : null) });
    await StreakService.updateUserStreak('u1');
    expect(tables.activity_log).toHaveLength(0);
  });
});
