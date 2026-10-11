/**
 * RUN-157: processAllUsersTitles räknade alla användare parallellt. Varje användares omräkning bygger om den
 * DELADE title_leaderboard per titel (update_title_leaderboard: DELETE + INSERT … SELECT), och två parallella
 * ombyggnader av samma titel krockar på unika nyckeln (title_id, position) med 23505. Felen loggades och
 * sväljdes — körningen rapporterade ändå "6/6 users".
 *
 * update_title_leaderboard simuleras här som i Postgres (READ COMMITTED): DELETE och INSERT … SELECT ser en
 * ögonblicksbild från satsens start, och en annan transaktion kan hinna skriva klart innan raderna sätts in.
 * Unika nyckeln (title_id, position) kontrolleras mot tabellens faktiska läge vid insättningen.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const holder = vi.hoisted(() => ({ client: null as any }));

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { get client() { return holder.client; } },
  testDatabaseConnection: vi.fn(),
  getSupabaseClient: vi.fn(() => holder.client),
}));

import { EnhancedTitleService } from '../enhancedTitleService.js';
import { createFakeDb, type Row } from '../../routes/__tests__/helpers/fakeDb.js';

const TITLE = { id: 't-km', name: 'Distance King', description: '', unlock_requirement: 1, metric_key: 'totalKm' };

function tables(): Record<string, Row[]> {
  return {
    users: [
      { id: 'u1', group_id: 'g1', total_km: 10, longest_streak: 0 },
      { id: 'u2', group_id: 'g1', total_km: 30, longest_streak: 0 },
      { id: 'u3', group_id: 'g1', total_km: 20, longest_streak: 0 },
    ],
    runs: [],
    titles: [TITLE],
    user_titles: [],
    title_leaderboard: [],
  };
}

type RpcError = { code: string; message: string };

/** fakeDb + en update_title_leaderboard som beter sig som plpgsql-funktionen under samtidighet. */
function setup(opts: { failRpc?: RpcError } = {}) {
  const data = tables();
  const db = createFakeDb(data, { autoIds: true });
  const rpcErrors: RpcError[] = [];

  async function updateTitleLeaderboard(titleId: string): Promise<RpcError | null> {
    if (opts.failRpc) return opts.failRpc;
    // Satsens ögonblicksbild: raderna DELETE ser och raderna INSERT … SELECT läser.
    const seen = data.title_leaderboard.filter((r) => r.title_id === titleId);
    const ranked = data.user_titles
      .filter((ut) => ut.title_id === titleId && ut.value != null)
      .sort((a, b) => b.value - a.value || String(a.earned_at).localeCompare(String(b.earned_at)))
      .slice(0, 10)
      .map((ut, i) => ({ title_id: titleId, user_id: ut.user_id, position: i + 1, value: ut.value, earned_at: ut.earned_at }));

    await new Promise((resolve) => setTimeout(resolve, 0)); // en annan transaktion kan committa här

    const remaining = data.title_leaderboard.filter((r) => !seen.includes(r));
    const clash = ranked.find((n) => remaining.some((r) => r.title_id === n.title_id && r.position === n.position));
    if (clash) {
      // Funktionen är atomär: inget av DELETE/INSERT blir kvar.
      return { code: '23505', message: 'duplicate key value violates unique constraint "title_leaderboard_title_id_position_key"' };
    }
    data.title_leaderboard = [...remaining, ...ranked];
    return null;
  }

  holder.client = {
    from: db.client.from,
    async rpc(name: string, args: any) {
      if (name !== 'update_title_leaderboard') return { data: null, error: null };
      const error = await updateTitleLeaderboard(args.p_title_id);
      if (error) rpcErrors.push(error);
      return { data: null, error };
    },
  };

  return { data, rpcErrors, service: new EnhancedTitleService() };
}

beforeEach(() => { vi.clearAllMocks(); });

describe('processAllUsersTitles — delade title_leaderboard (RUN-157)', () => {
  it('flera användare som tar samma titel ger ingen 23505 och rätt slutlig topplista', async () => {
    const { data, rpcErrors, service } = setup();

    await service.processAllUsersTitles('g1', { emitNews: false });

    expect(rpcErrors).toEqual([]);
    const board = data.title_leaderboard
      .filter((r) => r.title_id === TITLE.id)
      .sort((a, b) => a.position - b.position)
      .map((r) => [r.position, r.user_id, r.value]);
    expect(board).toEqual([[1, 'u2', 30], [2, 'u3', 20], [3, 'u1', 10]]);
  });

  it('ett fel i topplistebygget räknas som misslyckad användare, inte som klar', async () => {
    const { service } = setup({ failRpc: { code: '23505', message: 'duplicate key value' } });

    const result = await service.processAllUsersTitles('g1', { emitNews: false });

    expect(result).toEqual({ total: 3, processed: 0, failed: 3 });
  });
});
