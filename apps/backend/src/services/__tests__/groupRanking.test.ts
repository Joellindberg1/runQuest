/**
 * Gruppens titelranking byggs om per grupp (ADR 012 beslut 4.3): update_group_title_leaderboards(groupId), aldrig den globala
 * update_all_title_leaderboards. Efter en join byggs den om utan att det ger titelnyheter, och ett fel fäller aldrig joinen.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { rebuildGroupRankingAfterJoin, rebuildGroupTitleRanking } from '../groupRanking.js';
import { errorCode } from '../../utils/errorCode.js';
import { logger } from '../../utils/logger.js';
import { createFakeDb } from '../../routes/__tests__/helpers/fakeDb.js';

function fakeRpc(result: { data?: unknown; error?: { message: string; code?: string } | null } = {}) {
  const calls: Array<{ name: string; args: unknown }> = [];
  const rpc = (name: string) => (args: unknown) => { calls.push({ name, args }); return result; };
  const db = createFakeDb({}, {
    rpc: { update_group_title_leaderboards: rpc('update_group_title_leaderboards'), update_all_title_leaderboards: rpc('update_all_title_leaderboards') },
  });
  return { calls, db: db.client as never };
}

beforeEach(() => { vi.restoreAllMocks(); });

describe('rebuildGroupTitleRanking', () => {
  it('anropar update_group_title_leaderboards med gruppen och aldrig den globala funktionen', async () => {
    const { calls, db } = fakeRpc();
    await rebuildGroupTitleRanking('g1', db);
    expect(calls).toEqual([{ name: 'update_group_title_leaderboards', args: { p_group_id: 'g1' } }]);
  });

  it.each([[''], [undefined], [null]])('groupId %j kastar utan att anropa databasen (ingen global ombyggnad som reserv)', async (groupId) => {
    const { calls, db } = fakeRpc();
    await expect(rebuildGroupTitleRanking(groupId as unknown as string, db)).rejects.toThrow(/groupId/);
    expect(calls).toEqual([]);
  });

  it('ett databasfel kastas med databasens kod och utan dess text', async () => {
    const { db } = fakeRpc({ error: { message: 'deadlock LEAKMARKER jane@example.com', code: '40P01' } });
    const failure = await rebuildGroupTitleRanking('g1', db).catch((e: Error) => e);
    expect(errorCode(failure)).toBe('40P01');
    expect(JSON.stringify(failure)).not.toContain('LEAKMARKER');
    expect((failure as Error).message).not.toContain('LEAKMARKER');
  });
});

describe('rebuildGroupRankingAfterJoin', () => {
  it('bygger om gruppens ranking', async () => {
    const { calls, db } = fakeRpc();
    await rebuildGroupRankingAfterJoin('g1', db);
    expect(calls).toEqual([{ name: 'update_group_title_leaderboards', args: { p_group_id: 'g1' } }]);
  });

  it('ett fel loggas en gång med koden och kastas inte (medlemskapet är redan sparat)', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const { db } = fakeRpc({ error: { message: 'LEAKMARKER jane@example.com', code: '40P01' } });

    await expect(rebuildGroupRankingAfterJoin('g1', db)).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain('40P01');
    expect(JSON.stringify(error.mock.calls)).not.toContain('LEAKMARKER');
  });
});
