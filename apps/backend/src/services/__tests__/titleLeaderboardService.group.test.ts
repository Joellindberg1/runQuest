/**
 * Titelläsningarna gäller en grupp (ADR 012 beslut 5): katalogen slås ihop med gruppens rader så att en titel utan innehavare finns kvar,
 * en annan grupps rader syns aldrig, och en användare utanför gruppen läses inte alls. Adminunderhållet bygger bara om en grupp.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const holder = vi.hoisted(() => ({ client: null as any }));

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { get client() { return holder.client; } },
  getSupabaseClient: vi.fn(() => holder.client),
}));

import { TitleLeaderboardService } from '../titleLeaderboardService.js';
import { errorCode } from '../../utils/errorCode.js';
import { createFakeDb, type Row, type RecordedQuery, type FakeDbOptions } from '../../routes/__tests__/helpers/fakeDb.js';

const G1 = 'group-1';
const G2 = 'group-2';
const TITLE_TABLES = ['titles', 'title_leaderboard_view', 'user_titles'];

const catalog = (): Row[] => [
  { id: 't-early', name: 'Early Bird', description: 'Runs early', unlock_requirement: 10, metric_key: 'early' },
  { id: 't-far', name: 'Far Out', description: 'Runs far', unlock_requirement: 100, metric_key: 'far' },
  { id: 't-wind', name: 'Storm Chaser', description: 'Runs in wind', unlock_requirement: 15, metric_key: 'wind' },
];

function viewRow(titleId: string, titleName: string, groupId: string, position: number, userId: string, userName: string, value: number): Row {
  return {
    title_id: titleId, title_name: titleName, title_description: 'd', unlock_requirement: 1, metric_key: 'm',
    position, user_id: userId, user_name: userName, user_gender: null, profile_picture: null, value,
    earned_at: '2026-10-01T00:00:00Z', status: position === 1 ? 'holder' : position <= 3 ? 'runner_up' : 'top_10', group_id: groupId,
  };
}

const member = (userId: string, groupId: string, leftAt: string | null = null): Row => ({ id: `m-${userId}-${groupId}`, user_id: userId, group_id: groupId, role: 'member', left_at: leftAt });

function use(tables: Record<string, Row[]>, options: FakeDbOptions = {}) {
  const db = createFakeDb(tables, options);
  holder.client = db.client;
  return db;
}

const touched = (queries: RecordedQuery[]) => queries.filter((q) => TITLE_TABLES.includes(q.table));
const service = () => new TitleLeaderboardService();

beforeEach(() => { vi.clearAllMocks(); });

describe('getTitleLeaderboard', () => {
  it('lists the whole title catalog with a null holder for titles nobody in the group holds', async () => {
    use({
      titles: catalog(),
      title_leaderboard_view: [
        viewRow('t-early', 'Early Bird', G1, 1, 'u1', 'Anna', 50),
        // Vyn är en LEFT JOIN: en titel utan innehavare har en rad med group_id null.
        { title_id: 't-far', title_name: 'Far Out', title_description: 'd', unlock_requirement: 100, metric_key: 'far', position: null, user_id: null, group_id: null },
      ],
    });

    const result = await service().getTitleLeaderboard(G1);

    expect(result.map((t) => t.name)).toEqual(['Early Bird', 'Far Out', 'Storm Chaser']);
    expect(result.find((t) => t.name === 'Early Bird')?.holder).toMatchObject({ user_id: 'u1', user_name: 'Anna', value: 50 });
    expect(result.find((t) => t.name === 'Far Out')).toMatchObject({ id: 't-far', unlock_requirement: 100, metric_key: 'far', holder: null, runners_up: [] });
    expect(result.find((t) => t.name === 'Storm Chaser')?.holder).toBeNull();
  });

  it('puts positions 2 and 3 on runners_up and ignores positions below 3', async () => {
    use({
      titles: catalog(),
      title_leaderboard_view: [
        viewRow('t-early', 'Early Bird', G1, 1, 'u1', 'Anna', 50),
        viewRow('t-early', 'Early Bird', G1, 2, 'u2', 'Bertil', 40),
        viewRow('t-early', 'Early Bird', G1, 3, 'u3', 'Cia', 30),
        viewRow('t-early', 'Early Bird', G1, 4, 'u4', 'Dan', 20),
      ],
    });

    const early = (await service().getTitleLeaderboard(G1)).find((t) => t.id === 't-early');

    expect(early?.runners_up.map((r) => [r.position, r.user_id])).toEqual([[2, 'u2'], [3, 'u3']]);
  });

  it("never shows another group's holders, even for a title the caller's group does not hold", async () => {
    use({
      titles: catalog(),
      title_leaderboard_view: [
        viewRow('t-early', 'Early Bird', G1, 1, 'u1', 'Anna', 50),
        viewRow('t-early', 'Early Bird', G2, 1, 'u9', 'Stranger', 99),
        viewRow('t-far', 'Far Out', G2, 1, 'u9', 'Stranger', 500),
      ],
    });

    const result = await service().getTitleLeaderboard(G1);

    expect(result.find((t) => t.id === 't-early')?.holder?.user_id).toBe('u1');
    expect(result.find((t) => t.id === 't-far')?.holder).toBeNull();
    expect(JSON.stringify(result)).not.toContain('Stranger');
  });

  it.each([[''], [undefined], [null]])('refuses groupId %j without reading anything (fail-closed)', async (groupId) => {
    const db = use({ titles: catalog(), title_leaderboard_view: [viewRow('t-early', 'Early Bird', G1, 1, 'u1', 'Anna', 50)] });

    await expect(service().getTitleLeaderboard(groupId as unknown as string)).rejects.toThrow(/groupId/);

    expect(touched(db.queries)).toEqual([]);
  });

  it('throws with the database code and no database text when the catalog read fails', async () => {
    use({ titles: catalog(), title_leaderboard_view: [] }, { failWhen: (q) => (q.table === 'titles' ? { message: 'LEAKMARKER row 4711', code: '57014' } : null) });
    const failure = await service().getTitleLeaderboard(G1).catch((e: Error) => e);

    expect(failure).toBeInstanceOf(Error);
    expect(JSON.stringify(failure)).not.toContain('LEAKMARKER');
    expect(errorCode(failure)).toBe('57014');
  });
});

describe('getUserTitles', () => {
  const tables = (): Record<string, Row[]> => ({
    group_members: [member('u1', G1), member('u2', G1), member('u9', G2), member('u-left', G1, '2026-10-10T00:00:00Z')],
    title_leaderboard_view: [
      viewRow('t-early', 'Early Bird', G1, 1, 'u1', 'Anna', 50),
      viewRow('t-early', 'Early Bird', G1, 2, 'u2', 'Bertil', 40),
      viewRow('t-early', 'Early Bird', G2, 1, 'u9', 'Stranger', 99),
      // Samma användare på första plats i en annan grupp (flermedlemskap, RUN-95): hör inte till den här gruppens läsning.
      viewRow('t-wind', 'Storm Chaser', G2, 1, 'u2', 'Bertil', 77),
    ],
    user_titles: [
      { user_id: 'u2', group_id: G1, title_id: 't-early', value: 40, earned_at: '2026-10-02T00:00:00Z', titles: { name: 'Early Bird', description: 'Runs early' } },
      { user_id: 'u2', group_id: G1, title_id: 't-far', value: 7, earned_at: '2026-10-03T00:00:00Z', titles: { name: 'Far Out', description: 'Runs far' } },
      // Samma användare i en annan grupp (flermedlemskap, RUN-95): dess värden hör inte till den här gruppens läsning.
      { user_id: 'u2', group_id: G2, title_id: 't-wind', value: 3, earned_at: '2026-10-04T00:00:00Z', titles: { name: 'Storm Chaser', description: 'Runs in wind' } },
    ],
  });

  it("returns the member's standing in the group: ranked titles first, then titles outside the top 10 as participant", async () => {
    use(tables());

    const result = await service().getUserTitles(G1, 'u2');

    expect(result).toEqual([
      { title_id: 't-early', title_name: 'Early Bird', title_description: 'd', position: 2, value: 40, earned_at: '2026-10-01T00:00:00Z', is_current_holder: false, status: 'runner_up' },
      { title_id: 't-far', title_name: 'Far Out', title_description: 'Runs far', position: null, value: 7, earned_at: '2026-10-03T00:00:00Z', is_current_holder: false, status: 'participant' },
    ]);
  });

  it('flags the holder of a title as the current holder', async () => {
    use(tables());

    const result = await service().getUserTitles(G1, 'u1');

    expect(result?.find((t) => t.title_id === 't-early')).toMatchObject({ position: 1, is_current_holder: true, status: 'holder' });
  });

  it.each([
    ['a user in another group', 'u9'],
    ['a user whose membership has ended', 'u-left'],
    ['an unknown user', 'nobody'],
  ])('returns null for %s, without reading any title data', async (_label, userId) => {
    const db = use(tables());

    const result = await service().getUserTitles(G1, userId);

    expect(result).toBeNull();
    expect(touched(db.queries)).toEqual([]);
  });

  it('answers a malformed user id like an unknown user', async () => {
    const db = use(tables(), { failWhen: (q) => (q.table === 'group_members' ? { message: 'invalid input syntax for type uuid: "x"', code: '22P02' } : null) });

    expect(await service().getUserTitles(G1, 'x')).toBeNull();
    expect(touched(db.queries)).toEqual([]);
  });

  it('throws with the database code when the membership read fails', async () => {
    use(tables(), { failWhen: (q) => (q.table === 'group_members' ? { message: 'LEAKMARKER', code: '57014' } : null) });
    const failure = await service().getUserTitles(G1, 'u2').catch((e: Error) => e);

    expect(errorCode(failure)).toBe('57014');
    expect(JSON.stringify(failure)).not.toContain('LEAKMARKER');
  });

  it.each([[''], [undefined], [null]])('refuses groupId %j without reading anything (fail-closed)', async (groupId) => {
    const db = use(tables());

    await expect(service().getUserTitles(groupId as unknown as string, 'u2')).rejects.toThrow(/groupId/);

    expect(db.queries).toEqual([]);
  });
});

describe('populateTitleLeaderboard', () => {
  function useRpc() {
    const calls: Array<{ name: string; args: unknown }> = [];
    const record = (name: string) => (args: unknown) => { calls.push({ name, args }); return { data: null }; };
    use({}, { rpc: {
      update_group_title_leaderboards: record('update_group_title_leaderboards'),
      rebuild_all_groups: record('rebuild_all_groups'),
      rebuild_one_title: record('rebuild_one_title'),
    } });
    return calls;
  }

  it("rebuilds only the given group's ranking, never every group's", async () => {
    const calls = useRpc();

    await service().populateTitleLeaderboard(G1);

    expect(calls).toEqual([{ name: 'update_group_title_leaderboards', args: { p_group_id: G1 } }]);
  });

  it.each([[''], [undefined], [null]])('refuses groupId %j without any rebuild (fail-closed)', async (groupId) => {
    const calls = useRpc();

    await expect(service().populateTitleLeaderboard(groupId as unknown as string)).rejects.toThrow(/groupId/);

    expect(calls).toEqual([]);
  });
});
