/**
 * refreshTitleLeaderboard bygger om EN grupps lista för en titel (update_group_title_leaderboard); ett anrop utan grupp kastar
 * i stället för att falla tillbaka på en ombyggnad av alla grupper.
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
import { createFakeDb } from '../../routes/__tests__/helpers/fakeDb.js';

function use(result: { error?: { message: string; code?: string } | null } = {}) {
  const calls: Array<{ name: string; args: unknown }> = [];
  const rpc = (name: string) => (args: unknown) => { calls.push({ name, args }); return result; };
  holder.client = createFakeDb({}, {
    rpc: { update_group_title_leaderboard: rpc('update_group_title_leaderboard'), update_title_leaderboard: rpc('update_title_leaderboard'), update_all_title_leaderboards: rpc('update_all_title_leaderboards') },
  }).client;
  return calls;
}

beforeEach(() => { vi.clearAllMocks(); });

describe('refreshTitleLeaderboard', () => {
  it('anropar update_group_title_leaderboard med gruppen och titeln', async () => {
    const calls = use();
    await new TitleLeaderboardService().refreshTitleLeaderboard('g1', 't1');
    expect(calls).toEqual([{ name: 'update_group_title_leaderboard', args: { p_group_id: 'g1', p_title_id: 't1' } }]);
  });

  it.each([[''], [undefined], [null]])('groupId %j kastar utan databasanrop', async (groupId) => {
    const calls = use();
    await expect(new TitleLeaderboardService().refreshTitleLeaderboard(groupId as unknown as string, 't1')).rejects.toThrow(/groupId/);
    expect(calls).toEqual([]);
  });

  it('ett databasfel kastas med koden och utan databastexten', async () => {
    use({ error: { message: 'LEAKMARKER row 4711', code: '23505' } });
    const failure = await new TitleLeaderboardService().refreshTitleLeaderboard('g1', 't1').catch((e: Error) => e);
    expect(errorCode(failure)).toBe('23505');
    expect(JSON.stringify(failure)).not.toContain('LEAKMARKER');
  });
});
