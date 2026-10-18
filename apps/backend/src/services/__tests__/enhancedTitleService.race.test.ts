/**
 * RUN-157: titelomräkningen räknade alla användare parallellt. Varje användares omräkning bygger om gruppens
 * title_leaderboard per titel (update_group_title_leaderboard: DELETE + INSERT … SELECT), och två parallella
 * ombyggnader av samma (grupp, titel) krockar på unika nyckeln (group_id, title_id, position) med 23505. Felen loggades och
 * sväljdes — körningen rapporterade ändå "6/6 users".
 *
 * update_group_title_leaderboard simuleras här som i Postgres (READ COMMITTED): DELETE och INSERT … SELECT ser en
 * ögonblicksbild från satsens start, och en annan transaktion kan hinna skriva klart innan raderna sätts in.
 * Unika nyckeln (group_id, title_id, position) kontrolleras mot tabellens faktiska läge vid insättningen.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const holder = vi.hoisted(() => ({ client: null as any }));

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { get client() { return holder.client; } },
  getSupabaseClient: vi.fn(() => holder.client),
}));

import { EnhancedTitleService } from '../enhancedTitleService.js';
import { createFakeDb, type Row } from '../../routes/__tests__/helpers/fakeDb.js';

const TITLE = { id: 't-km', name: 'Distance King', description: '', unlock_requirement: 1, metric_key: 'totalKm' };

function tables(): Record<string, Row[]> {
  const member = (id: string, userId: string): Row => ({ id, user_id: userId, group_id: 'g1', role: 'member', starts_on: null, left_at: null });
  return {
    users: [
      { id: 'u1', group_id: 'g1', total_km: 10, longest_streak: 0 },
      { id: 'u2', group_id: 'g1', total_km: 30, longest_streak: 0 },
      { id: 'u3', group_id: 'g1', total_km: 20, longest_streak: 0 },
    ],
    group_members: [member('m1', 'u1'), member('m2', 'u2'), member('m3', 'u3')],
    runs: [],
    titles: [TITLE],
    user_titles: [],
    title_leaderboard: [],
  };
}

type RpcError = { code: string; message: string };

/** fakeDb + en update_group_title_leaderboard som beter sig som plpgsql-funktionen under samtidighet. */
function setup(opts: { failRpc?: RpcError; failInsertFor?: string } = {}) {
  const data = tables();
  const db = createFakeDb(data, { autoIds: true });
  const rpcErrors: RpcError[] = [];

  async function updateGroupTitleLeaderboard(groupId: string, titleId: string): Promise<RpcError | null> {
    if (opts.failRpc) return opts.failRpc;
    // Satsens ögonblicksbild: raderna DELETE ser och raderna INSERT … SELECT läser.
    const seen = data.title_leaderboard.filter((r) => r.group_id === groupId && r.title_id === titleId);
    const ranked = data.user_titles
      .filter((ut) => ut.group_id === groupId && ut.title_id === titleId && ut.value != null)
      .sort((a, b) => b.value - a.value || String(a.earned_at).localeCompare(String(b.earned_at)))
      .slice(0, 10)
      .map((ut, i) => ({ group_id: groupId, title_id: titleId, user_id: ut.user_id, position: i + 1, value: ut.value, earned_at: ut.earned_at }));

    await new Promise((resolve) => setTimeout(resolve, 0)); // en annan transaktion kan committa här

    const remaining = data.title_leaderboard.filter((r) => !seen.includes(r));
    const clash = ranked.find((n) => remaining.some((r) => r.group_id === n.group_id && r.title_id === n.title_id && r.position === n.position));
    if (clash) {
      // Funktionen är atomär: inget av DELETE/INSERT blir kvar.
      return { code: '23505', message: 'duplicate key value violates unique constraint "title_leaderboard_group_title_position_key"' };
    }
    data.title_leaderboard = [...remaining, ...ranked];
    return null;
  }

  holder.client = {
    from(table: string) {
      const builder = db.client.from(table);
      if (table !== 'user_titles' || !opts.failInsertFor) return builder;
      // I prod bygger triggern på user_titles om topplistan i samma sats — 23505 kan alltså komma redan vid skrivningen.
      const insert = builder.insert;
      builder.insert = (values: Row) => values.user_id === opts.failInsertFor
        ? Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key value' } })
        : insert(values);
      return builder;
    },
    async rpc(name: string, args: any) {
      if (name !== 'update_group_title_leaderboard') return { data: null, error: null };
      const error = await updateGroupTitleLeaderboard(args.p_group_id, args.p_title_id);
      if (error) rpcErrors.push(error);
      return { data: null, error };
    },
  };

  return { data, rpcErrors, service: new EnhancedTitleService() };
}

beforeEach(() => { vi.clearAllMocks(); });

describe('processGroupTitles — gruppens title_leaderboard', () => {
  it('flera användare som tar samma titel ger ingen 23505 och rätt slutlig topplista', async () => {
    const { data, rpcErrors, service } = setup();

    await service.processGroupTitles('g1', { emitNews: false });

    expect(rpcErrors).toEqual([]);
    const board = data.title_leaderboard
      .filter((r) => r.title_id === TITLE.id)
      .sort((a, b) => a.position - b.position)
      .map((r) => [r.position, r.user_id, r.value]);
    expect(board).toEqual([[1, 'u2', 30], [2, 'u3', 20], [3, 'u1', 10]]);
  });

  it('ett fel i topplistebygget räknas som misslyckad användare, inte som klar', async () => {
    const { service } = setup({ failRpc: { code: '23505', message: 'duplicate key value' } });

    const result = await service.processGroupTitles('g1', { emitNews: false });

    expect(result).toEqual({ total: 3, processed: 0, failed: 3 });
  });

  it('ett skrivfel i user_titles räknas som misslyckad användare och stoppar inte de övriga', async () => {
    const { data, rpcErrors, service } = setup({ failInsertFor: 'u3' });

    const result = await service.processGroupTitles('g1', { emitNews: false });

    expect(result).toEqual({ total: 3, processed: 2, failed: 1 });
    expect(rpcErrors).toEqual([]);
    expect(data.title_leaderboard.map((r) => [r.position, r.user_id])).toEqual([[1, 'u2'], [2, 'u1']]);
  });
});
