/**
 * Titelomräkningen i calculateUserTotals är gruppavgränsad via användarens AKTIVA medlemskap i group_members (färskt, aldrig JWT-gruppen,
 * som blir inaktuell efter groups/join, och inte users.group_id). Rankingen byggs om för den gruppen och ingen annan. En användare utan
 * aktivt medlemskap får inga titlar alls (ADR 012 beslut 1.4 och 4).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));
vi.mock('../../services/levelService.js', () => ({ getLevelFromXP: vi.fn(async () => 1) }));
vi.mock('../../services/challengeService.js', () => ({ reconcileTokensForLevel: vi.fn(async () => undefined) }));
vi.mock('../../services/badgeService.js', () => ({ evaluateBadges: vi.fn(async () => null) })); // badges testas i calculateUserTotals.badges*.test.ts
const processGroupTitles = vi.fn(async (..._args: unknown[]) => undefined);
const processUserTitlesAfterRun = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock('../../services/enhancedTitleService.js', () => ({
  EnhancedTitleService: class { processGroupTitles = processGroupTitles; processUserTitlesAfterRun = processUserTitlesAfterRun; },
}));

import { getSupabaseClient } from '../../config/database.js';
import { calculateUserTotals } from '../calculateUserTotals.js';
import { logger } from '../logger.js';
import { createFakeDb, type FakeDbOptions, type Row } from '../../routes/__tests__/helpers/fakeDb.js';

const groupRefresh = vi.fn((_args: unknown) => ({ data: null, error: null }));
const globalRefresh = vi.fn(() => ({ data: null, error: null }));

function use(tables: Record<string, Row[]>, options: Partial<FakeDbOptions> = {}) {
  const db = createFakeDb(tables, {
    numericIds: ['activity_log'],
    rpc: { update_group_title_leaderboards: groupRefresh, update_all_title_leaderboards: globalRefresh },
    ...options,
  });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return db;
}

/** Medlemskapet i group_members är sanningen; users.group_id är en pekare som testerna sätter lika, om inget annat anges. */
function tables(groupId: string | null, over: { pointer?: string | null; leftAt?: string | null } = {}): Record<string, Row[]> {
  return {
    activity_log: [],
    users: [{ id: 'u1', group_id: over.pointer === undefined ? groupId : over.pointer, event_xp: 0, current_level: 1, total_km: 0, total_xp: 0, current_streak: 0, longest_streak: 0 }],
    group_members: groupId ? [{ id: 'm1', user_id: 'u1', group_id: groupId, role: 'member', starts_on: null, left_at: over.leftAt ?? null }] : [],
    runs: [
      { id: 'r1', user_id: 'u1', date: '2020-01-01', distance: 5, xp_gained: 10, start_time: '06:00', total_elevation_gain: 20, pace_std_dev: 1, moving_time: 1500 },
      { id: 'r2', user_id: 'u1', date: '2020-01-02', distance: 7, xp_gained: 14 },
    ],
  };
}

beforeEach(() => { vi.clearAllMocks(); });

describe('calculateUserTotals → titelomräkning', () => {
  it('Strava-vägen anropar processGroupTitles med användarens aktiva medlemskap och bygger om just den gruppens ranking', async () => {
    use(tables('g1'));
    await calculateUserTotals('u1'); // ingen groupId-parameter (Strava-importen)
    expect(processGroupTitles).toHaveBeenCalledTimes(1);
    expect(processGroupTitles).toHaveBeenCalledWith('g1');
    expect(processUserTitlesAfterRun).not.toHaveBeenCalled();
    expect(groupRefresh).toHaveBeenCalledTimes(1);
    expect(groupRefresh).toHaveBeenCalledWith({ p_group_id: 'g1' });
  });

  it('ingen global ombyggnad av rankingen i skrivvägen', async () => {
    use(tables('g1'));
    await calculateUserTotals('u1');
    expect(globalRefresh).not.toHaveBeenCalled();
  });

  it('medlemskapet i group_members styr, inte users.group_id (pekaren kan avvika)', async () => {
    use(tables('g-member', { pointer: 'g-pointer' }));
    await calculateUserTotals('u1');
    expect(processGroupTitles).toHaveBeenCalledWith('g-member');
    expect(groupRefresh).toHaveBeenCalledWith({ p_group_id: 'g-member' });
  });

  it('en extra, inaktuell grupp-parameter ignoreras: det färska medlemskapet styr (JWT-gruppen blir inaktuell)', async () => {
    use(tables('g-fresh'));
    await (calculateUserTotals as (userId: string, staleGroupId?: string) => Promise<void>)('u1', 'g-stale-from-jwt');
    expect(processGroupTitles).toHaveBeenCalledWith('g-fresh');
  });

  it('läser medlemskapet ur group_members med left_at is null för just användaren', async () => {
    const db = use(tables('g1'));
    await calculateUserTotals('u1');
    const read = db.queries.find((q) => q.table === 'group_members')!;
    expect(read.filters).toContainEqual({ op: 'eq', column: 'user_id', value: 'u1' });
    expect(read.filters).toContainEqual({ op: 'is', column: 'left_at', value: null });
  });
});

describe('användare utan aktivt medlemskap', () => {
  it('får inga titlar: ingen omräkning, ingen ranking, ingen titelrad för användaren — men totalerna sparas', async () => {
    const t = tables(null);
    use(t);
    await calculateUserTotals('u1');
    expect(processGroupTitles).not.toHaveBeenCalled();
    expect(processUserTitlesAfterRun).not.toHaveBeenCalled();
    expect(groupRefresh).not.toHaveBeenCalled();
    expect(globalRefresh).not.toHaveBeenCalled();
    expect(t.users[0]).toMatchObject({ total_xp: 24, total_km: 12 });
  });

  it('har lämnat gruppen (left_at satt) men pekaren står kvar: inga titlar', async () => {
    use(tables('g1', { leftAt: '2026-10-01T00:00:00Z' }));
    await calculateUserTotals('u1');
    expect(processGroupTitles).not.toHaveBeenCalled();
    expect(groupRefresh).not.toHaveBeenCalled();
  });

  it('loggas som info, inte som fel', async () => {
    use(tables(null));
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {});
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    await calculateUserTotals('u1');
    expect(info.mock.calls.some((c) => /no active group membership/i.test(String(c[0])))).toBe(true);
    expect(error).not.toHaveBeenCalled();
    info.mockRestore();
    error.mockRestore();
  });
});

describe('fel i titelkedjan fäller inte totalerna', () => {
  it('ett fel i titelbearbetningen fäller inte totalerna och hoppar över ombyggnaden', async () => {
    const t = tables('g1');
    use(t);
    processGroupTitles.mockRejectedValueOnce(new Error('boom'));
    await expect(calculateUserTotals('u1')).resolves.toBe(true); // kastar aldrig; totalerna skrevs före felet
    expect(t.users[0]).toMatchObject({ total_xp: 24, total_km: 12 });
    expect(groupRefresh).not.toHaveBeenCalled();
  });

  it('ett fel när medlemskapet läses loggas med koden, ger inga titlar och fäller inte totalerna', async () => {
    const t = tables('g1');
    use(t, { failWhen: (q) => (q.table === 'group_members' ? { message: 'LEAKMARKER jane@example.com', code: '57014' } : null) });
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});

    await expect(calculateUserTotals('u1')).resolves.toBe(true); // kastar aldrig; totalerna skrevs före felet

    expect(processGroupTitles).not.toHaveBeenCalled();
    expect(groupRefresh).not.toHaveBeenCalled();
    expect(t.users[0]).toMatchObject({ total_xp: 24, total_km: 12 });
    expect(error.mock.calls.some((c) => String(c[0]).includes('57014'))).toBe(true);
    expect(JSON.stringify(error.mock.calls)).not.toContain('LEAKMARKER');
    error.mockRestore();
  });
});

describe('misslyckade användare i gruppomräkningen syns i loggen', () => {
  it('failed > 0 ger logger.warn med antalen — och totalerna skrivs ändå', async () => {
    const t = tables('g1');
    use(t);
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    processGroupTitles.mockResolvedValueOnce({ total: 6, processed: 4, failed: 2 } as never);

    await calculateUserTotals('u1');

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/2.*6/);
    expect(t.users[0]).toMatchObject({ total_xp: 24, total_km: 12 });
    expect(groupRefresh).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('failed 0 ger ingen varning', async () => {
    use(tables('g1'));
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    processGroupTitles.mockResolvedValueOnce({ total: 6, processed: 6, failed: 0 } as never);

    await calculateUserTotals('u1');

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
