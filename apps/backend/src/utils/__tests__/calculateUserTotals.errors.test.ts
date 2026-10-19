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
  EnhancedTitleService: class { processGroupTitles = vi.fn(async () => undefined); processUserTitlesAfterRun = vi.fn(async () => undefined); },
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

/** Totalernas users-läsning (event_xp m.fl.): den enda läsningen av users som inte är en mutation. */
const usersReadFails = (q: RecordedQuery) => (q.table === 'users' && !q.mutation && q.select?.includes('event_xp') ? { message: 'users read failed' } : null);

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

    await expect(calculateUserTotals('u1')).resolves.toBe(false); // kastar aldrig (yttre try/catch), men säger att totalerna inte skrevs

    expect(t.users[0]).toMatchObject({ total_xp: 10, current_level: 1, current_streak: 5, longest_streak: 9 });
    expect(db.queries.filter((q) => q.table === 'users' && q.mutation)).toHaveLength(0);
    expect(reconcileTokensForLevel).not.toHaveBeenCalled();
    expect(t.activity_log).toHaveLength(0);
    expect(vi.mocked(logger.error).mock.calls.some((c: unknown[]) => /calculateUserTotals/.test(String(c[0])))).toBe(true);
  });

  it('writes nothing and returns false when the users read fails, instead of writing totals without the event XP', async () => {
    const t = tables();
    t.users[0].event_xp = 40;
    const db = createFakeDb(t, { numericIds: ['activity_log'], failWhen: usersReadFails });
    vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);

    await expect(calculateUserTotals('u1')).resolves.toBe(false);

    expect(t.users[0]).toMatchObject({ total_xp: 10, current_level: 1, current_streak: 5, longest_streak: 9, event_xp: 40 });
    expect(db.queries.filter((q) => q.table === 'users' && q.mutation)).toHaveLength(0);
    expect(reconcileTokensForLevel).not.toHaveBeenCalled();
    expect(t.activity_log).toHaveLength(0);
  });

  it('logs only the error code when the users read fails, never the message', async () => {
    const t = tables();
    const db = createFakeDb(t, {
      numericIds: ['activity_log'],
      failWhen: (q) => (usersReadFails(q) ? { message: 'secret detail user u1', code: 'XX000' } : null),
    });
    vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);

    await calculateUserTotals('u1');

    const logged = vi.mocked(logger.error).mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
    expect(logged).toContain('XX000');
    expect(logged).not.toContain('secret detail');
  });

  it('writes nothing and returns false when the users row is missing', async () => {
    const t = tables();
    t.users = [];
    const db = createFakeDb(t, { numericIds: ['activity_log'] });
    vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);

    await expect(calculateUserTotals('u1')).resolves.toBe(false);

    expect(db.queries.filter((q) => q.table === 'users' && q.mutation)).toHaveLength(0);
    expect(reconcileTokensForLevel).not.toHaveBeenCalled();
  });

  it('returns true when the totals were written, false when they were not, and never throws', async () => {
    // Återhämtningen av en omräkning rensar sin markering bara på det här svaret (RUN-322): ett fel som fångas inuti får inte se ut som en lyckad körning.
    const cases: Array<{ label: string; failWhen?: (q: RecordedQuery) => { message: string } | null; expected: boolean; setup?: () => void }> = [
      { label: 'the totals are written', expected: true },
      { label: 'the runs cannot be read', failWhen: (q) => (q.table === 'runs' && q.select === 'xp_gained, distance' ? { message: 'down' } : null), expected: false },
      { label: 'the streak cannot be read', failWhen: streakReadFails, expected: false },
      { label: 'the users cannot be read', failWhen: usersReadFails, expected: false },
      { label: 'the update of users fails', failWhen: (q) => (q.table === 'users' && q.mutation === 'update' ? { message: 'down' } : null), expected: false },
      { label: 'the token reconciliation throws', expected: false, setup: () => vi.mocked(reconcileTokensForLevel).mockRejectedValueOnce(new Error('boom')) },
    ];
    for (const { label, failWhen, expected, setup } of cases) {
      const t = tables();
      const db = createFakeDb(t, { numericIds: ['activity_log'], failWhen });
      vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
      setup?.();

      await expect(calculateUserTotals('u1'), label).resolves.toBe(expected);
    }
  });

  it('still returns true when only the badges or the titles fail after the totals were written', async () => {
    const t = tables();
    const db = createFakeDb(t, { numericIds: ['activity_log'] });
    vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
    const { evaluateBadges } = await import('../../services/badgeService.js');
    vi.mocked(evaluateBadges).mockRejectedValueOnce(new Error('boom'));

    await expect(calculateUserTotals('u1')).resolves.toBe(true);
    expect(t.users[0]).toMatchObject({ total_xp: 105 });
  });

  it('lyckad väg oförändrad: totaler och streak skrivs', async () => {
    const t = tables();
    const db = createFakeDb(t, { numericIds: ['activity_log'] });
    vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);

    await calculateUserTotals('u1');

    expect(t.users[0]).toMatchObject({ total_xp: 105, total_km: 20, current_level: 2 });
  });
});
