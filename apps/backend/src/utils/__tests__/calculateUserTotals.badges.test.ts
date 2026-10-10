/**
 * RUN-119: calculateUserTotals utvärderar badges (evaluateBadges) vid varje totalberäkning — efter users-uppdateringen
 * och news-blocket, FÖRE titelbearbetningen. Felisolerat (STATE zon 1: kedjan är inte transaktionell, ADR 005 en skribent).
 * badgeService är mockad här; flöde 9 mot riktig evaluateBadges ligger i calculateUserTotals.badges.flow.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  testDatabaseConnection: vi.fn(),
  getSupabaseClient: vi.fn(),
}));
vi.mock('../../services/levelService.js', () => ({ getLevelFromXP: vi.fn(async () => 2) }));
vi.mock('../../services/challengeService.js', () => ({ reconcileTokensForLevel: vi.fn(async () => undefined) }));
vi.mock('../../services/badgeService.js', () => ({ evaluateBadges: vi.fn() }));
const processAllUsersTitles = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock('../../services/enhancedTitleService.js', () => ({
  EnhancedTitleService: class { processAllUsersTitles = processAllUsersTitles; },
}));

import { getSupabaseClient } from '../../config/database.js';
import { evaluateBadges } from '../../services/badgeService.js';
import { calculateUserTotals } from '../calculateUserTotals.js';
import { createFakeDb, type Row } from '../../routes/__tests__/helpers/fakeDb.js';

function use(tables: Record<string, Row[]>) {
  const db = createFakeDb(tables, { numericIds: ['activity_log'] });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return db;
}

const run = (id: string, date: string, distance: number, xp: number): Row => ({ id, user_id: 'u1', date, distance, xp_gained: xp });

function tables(over: Partial<Record<string, Row[]>> = {}): Record<string, Row[]> {
  return {
    activity_log: [],
    users: [{ id: 'u1', group_id: 'g1', event_xp: 0, current_level: 1, total_km: 0, total_xp: 0, current_streak: 0, longest_streak: 0 }],
    runs: [run('r1', '2020-01-01', 5, 10), run('r2', '2020-01-02', 7, 14)],
    ...over,
  } as Record<string, Row[]>;
}

beforeEach(() => {
  vi.clearAllMocks();
  processAllUsersTitles.mockImplementation(async () => undefined);
  vi.mocked(evaluateBadges).mockResolvedValue({
    written: { inserts: [], upgrades: [], downgrades: [], deletes: [], showcaseRemovals: [] },
    complete: true,
  });
});

describe('calculateUserTotals → evaluateBadges', () => {
  it('anropar evaluateBadges efter users-uppdateringen och före titelbearbetningen', async () => {
    const t = tables();
    use(t);
    const order: string[] = [];
    let usersAtBadges: Row | undefined;
    let newsAtBadges = 0;
    vi.mocked(evaluateBadges).mockImplementation(async () => {
      order.push('badges');
      usersAtBadges = { ...t.users[0] };
      newsAtBadges = t.activity_log.length;
      return null;
    });
    processAllUsersTitles.mockImplementation(async () => { order.push('titles'); });

    await calculateUserTotals('u1');

    expect(order).toEqual(['badges', 'titles']);
    expect(usersAtBadges).toMatchObject({ total_xp: 24, total_km: 12, current_level: 2 }); // users-uppdateringen var redan gjord
    expect(newsAtBadges).toBeGreaterThan(0); // news-blocket (level_up) var redan skrivet
  });

  it('noll rundor → evaluateBadges anropas ändå (raderade rundor ska nedgradera/radera badges)', async () => {
    use(tables({ runs: [] }));
    await calculateUserTotals('u1');
    expect(evaluateBadges).toHaveBeenCalledTimes(1);
    expect(evaluateBadges).toHaveBeenCalledWith('u1', { longestStreak: 0 });
  });

  it('längsta streak skickas till evaluateBadges (ingen extra users-läsning för streak)', async () => {
    const t = tables({ runs: [run('r1', '2020-01-01', 5, 10), run('r2', '2020-01-02', 5, 10), run('r3', '2020-01-03', 5, 10)] });
    const db = use(t);
    await calculateUserTotals('u1');

    const longest = t.users[0].longest_streak as number;
    expect(longest).toBeGreaterThan(0);
    expect(evaluateBadges).toHaveBeenCalledTimes(1);
    expect(evaluateBadges).toHaveBeenCalledWith('u1', { longestStreak: longest });
    // Streaken kommer ur den redan gjorda beräkningen: ingen users-läsning av longest_streak (evaluateBadges är mockad).
    const streakReads = db.queries.filter((q) => q.table === 'users' && !q.mutation && /longest_streak/.test(q.select ?? ''));
    expect(streakReads).toHaveLength(0);
  });

  it('sparar totaler OCH bearbetar titlar även när evaluateBadges kastar', async () => {
    const t = tables();
    use(t);
    vi.mocked(evaluateBadges).mockRejectedValue(new Error('badges boom'));
    await expect(calculateUserTotals('u1')).resolves.toBeUndefined();
    expect(t.users[0]).toMatchObject({ total_xp: 24, total_km: 12, current_level: 2 });
    expect(processAllUsersTitles).toHaveBeenCalledWith('g1');
  });

  it('evaluateBadges som kastar synkront (inte bara avvisar) fäller heller inte kedjan', async () => {
    use(tables());
    vi.mocked(evaluateBadges).mockImplementation(() => { throw new Error('sync boom'); });
    await expect(calculateUserTotals('u1')).resolves.toBeUndefined();
    expect(processAllUsersTitles).toHaveBeenCalledWith('g1');
  });
});
