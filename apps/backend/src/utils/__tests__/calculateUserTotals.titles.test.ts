/**
 * RUN-104: titelomräkningen i calculateUserTotals är gruppavgränsad via den FÄRSKA users.group_id
 * (aldrig via JWT-gruppen, som blir inaktuell efter groups/join). Användare utan grupp räknar bara om sig själva.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  testDatabaseConnection: vi.fn(),
  getSupabaseClient: vi.fn(),
}));
vi.mock('../../services/levelService.js', () => ({ getLevelFromXP: vi.fn(async () => 1) }));
vi.mock('../../services/challengeService.js', () => ({ reconcileTokensForLevel: vi.fn(async () => undefined) }));
const processAllUsersTitles = vi.fn(async (..._args: unknown[]) => undefined);
const processUserTitlesAfterRun = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock('../../services/enhancedTitleService.js', () => ({
  EnhancedTitleService: class { processAllUsersTitles = processAllUsersTitles; processUserTitlesAfterRun = processUserTitlesAfterRun; },
}));

import { getSupabaseClient } from '../../config/database.js';
import { calculateUserTotals } from '../calculateUserTotals.js';
import { createFakeDb, type Row } from '../../routes/__tests__/helpers/fakeDb.js';

const leaderboardRefresh = vi.fn(() => ({ data: null, error: null }));

function use(tables: Record<string, Row[]>) {
  const db = createFakeDb(tables, { numericIds: ['activity_log'], rpc: { update_all_title_leaderboards: leaderboardRefresh } });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return db;
}

function tables(groupId: string | null): Record<string, Row[]> {
  return {
    activity_log: [],
    users: [{ id: 'u1', group_id: groupId, event_xp: 0, current_level: 1, total_km: 0, total_xp: 0, current_streak: 0, longest_streak: 0 }],
    runs: [
      { id: 'r1', user_id: 'u1', date: '2020-01-01', distance: 5, xp_gained: 10, start_time: '06:00', total_elevation_gain: 20, pace_std_dev: 1, moving_time: 1500 },
      { id: 'r2', user_id: 'u1', date: '2020-01-02', distance: 7, xp_gained: 14 },
    ],
  };
}

beforeEach(() => { vi.clearAllMocks(); });

describe('calculateUserTotals → titelomräkning', () => {
  it('Strava-vägen anropar processAllUsersTitles med användarens users.group_id', async () => {
    use(tables('g1'));
    await calculateUserTotals('u1'); // ingen groupId-parameter (Strava-importen)
    expect(processAllUsersTitles).toHaveBeenCalledTimes(1);
    expect(processAllUsersTitles).toHaveBeenCalledWith('g1');
    expect(processUserTitlesAfterRun).not.toHaveBeenCalled();
    expect(leaderboardRefresh).toHaveBeenCalledTimes(1);
  });

  it('en extra, inaktuell grupp-parameter ignoreras: users.group_id styr (färskare än JWT)', async () => {
    use(tables('g-fresh'));
    await (calculateUserTotals as (userId: string, staleGroupId?: string) => Promise<void>)('u1', 'g-stale-from-jwt');
    expect(processAllUsersTitles).toHaveBeenCalledWith('g-fresh');
  });

  it('användare utan grupp: processAllUsersTitles 0 anrop, processUserTitlesAfterRun en gång', async () => {
    use(tables(null));
    await calculateUserTotals('u1');
    expect(processAllUsersTitles).not.toHaveBeenCalled();
    expect(processUserTitlesAfterRun).toHaveBeenCalledTimes(1);

    const [userId, runs, totalKm, longestStreak] = processUserTitlesAfterRun.mock.calls[0] as [string, any[], number, number];
    expect(userId).toBe('u1');
    expect(runs).toHaveLength(2);
    expect(runs.map((r) => r.distance_km)).toEqual([5, 7]); // alias som motorerna läser
    expect(runs[0]).toMatchObject({ date: '2020-01-01', start_time: '06:00', total_elevation_gain: 20, pace_std_dev: 1, moving_time: 1500 });
    expect(totalKm).toBe(12);
    expect(typeof longestStreak).toBe('number');
    expect(leaderboardRefresh).toHaveBeenCalledTimes(1); // leaderboarden uppdateras även för grupplösa
  });

  it('grupplösa grenen avrundar total km till numeric(8,2) som users.total_km (1.004 + 1.004 → 2.01)', async () => {
    const t = tables(null);
    t.runs = [
      { id: 'r1', user_id: 'u1', date: '2020-01-01', distance: 1.004, xp_gained: 1 },
      { id: 'r2', user_id: 'u1', date: '2020-01-02', distance: 1.004, xp_gained: 1 },
    ];
    use(t);
    await calculateUserTotals('u1');
    const totalKm = (processUserTitlesAfterRun.mock.calls[0] as [string, any[], number, number])[2];
    expect(totalKm).toBe(2.01);
  });

  it('ett fel i titelbearbetningen fäller inte totalerna', async () => {
    const t = tables('g1');
    use(t);
    processAllUsersTitles.mockRejectedValueOnce(new Error('boom'));
    await expect(calculateUserTotals('u1')).resolves.toBeUndefined();
    expect(t.users[0]).toMatchObject({ total_xp: 24, total_km: 12 });
  });
});
