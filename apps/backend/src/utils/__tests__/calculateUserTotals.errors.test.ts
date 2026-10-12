/**
 * RUN-215 (bör-punkt D) — calculateUserTotals när streak-läsningen (StreakService.calculateUserStreaks) felar.
 *
 * StreakService kastar nu vid läsfel i stället för att returnera 0/0. calculateUserTotals ska då INTE skriva något till
 * users (varken totaler eller en 0/0-streak) — en uppdatering på ofullständig data är värre än att vänta till nästa körning.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));
vi.mock('../../services/levelService.js', () => ({ getLevelFromXP: vi.fn(async (xp: number) => (xp >= 50 ? 2 : 1)) }));
vi.mock('../../services/challengeService.js', () => ({ reconcileTokensForLevel: vi.fn(async () => undefined) }));
vi.mock('../../services/badgeService.js', () => ({ evaluateBadges: vi.fn(async () => null) }));
vi.mock('../../services/enhancedTitleService.js', () => ({
  EnhancedTitleService: class { processAllUsersTitles = vi.fn(async () => undefined); processUserTitlesAfterRun = vi.fn(async () => undefined); },
}));

import { getSupabaseClient } from '../../config/database.js';
import { reconcileTokensForLevel } from '../../services/challengeService.js';
import { logger } from '../logger.js';
import { calculateUserTotals } from '../calculateUserTotals.js';
import { createFakeDb, type Row, type RecordedQuery } from '../../routes/__tests__/helpers/fakeDb.js';

const tables = (): Record<string, Row[]> => ({
  activity_log: [],
  users: [{ id: 'u1', group_id: 'g1', event_xp: 0, current_level: 1, total_km: 0, total_xp: 10, current_streak: 5, longest_streak: 9 }],
  runs: [
    { id: 'r1', user_id: 'u1', date: '2020-01-01', distance: 10, xp_gained: 60 },
    { id: 'r2', user_id: 'u1', date: '2020-01-02', distance: 10, xp_gained: 45 },
  ],
});

/** Totalernas egen runs-läsning har en lång select; streakläsningen väljer bara `date`. */
const streakReadFails = (q: RecordedQuery) => (q.table === 'runs' && q.select === 'date' ? { message: 'streak read failed' } : null);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

describe('calculateUserTotals — streak-läsfel', () => {
  it('writes nothing to users and never 0/0 when the streak read fails', async () => {
    const t = tables();
    const db = createFakeDb(t, { numericIds: ['activity_log'], failWhen: streakReadFails });
    vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);

    await expect(calculateUserTotals('u1')).resolves.toBeUndefined(); // kastar aldrig (yttre try/catch)

    expect(t.users[0]).toMatchObject({ total_xp: 10, current_level: 1, current_streak: 5, longest_streak: 9 });
    expect(db.queries.filter((q) => q.table === 'users' && q.mutation)).toHaveLength(0);
    expect(reconcileTokensForLevel).not.toHaveBeenCalled();
    expect(t.activity_log).toHaveLength(0);
    expect(vi.mocked(logger.error).mock.calls.some((c: unknown[]) => /calculateUserTotals/.test(String(c[0])))).toBe(true);
  });

  it('lyckad väg oförändrad: totaler och streak skrivs', async () => {
    const t = tables();
    const db = createFakeDb(t, { numericIds: ['activity_log'] });
    vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);

    await calculateUserTotals('u1');

    expect(t.users[0]).toMatchObject({ total_xp: 105, total_km: 20, current_level: 2 });
  });
});
