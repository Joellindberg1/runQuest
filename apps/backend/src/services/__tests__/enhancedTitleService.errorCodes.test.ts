/**
 * The error that processUserTitlesAfterRun throws carries the code of the first thing that failed, never the database text, so the
 * one place that catches it (processGroupTitles, calculateUserTotals) logs a meaningful code and not "(Error)".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const holder = vi.hoisted(() => ({ client: null as any }));

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { get client() { return holder.client; } },
  getSupabaseClient: vi.fn(() => holder.client),
}));

import { EnhancedTitleService } from '../enhancedTitleService.js';
import { errorCode } from '../../utils/errorCode.js';
import { logger } from '../../utils/logger.js';
import { createFakeDb, type RecordedQuery, type Row } from '../../routes/__tests__/helpers/fakeDb.js';

const TITLE = { id: 't-km', name: 'Distance King', description: '', unlock_requirement: 1, metric_key: 'totalKm' };
const LEAK = 'LEAKMARKER row 4711 jane@example.com';

function use(options: { failWhen?: (q: RecordedQuery) => { message: string; code?: string; details?: string } | null } = {}) {
  const tables: Record<string, Row[]> = { titles: [TITLE], user_titles: [], users: [{ id: 'u1', total_km: 10, longest_streak: 0 }], runs: [] };
  const db = createFakeDb(tables, {
    autoIds: true,
    failWhen: options.failWhen,
    rpc: { update_group_title_leaderboard: () => { rpcCalls.push('update_group_title_leaderboard'); return { data: null }; }, update_group_title_leaderboards: () => { rpcCalls.push('update_group_title_leaderboards'); return { data: null }; } },
  });
  holder.client = db.client;
  return tables;
}

const rpcCalls: string[] = [];

const run = (service = new EnhancedTitleService()) => service.processUserTitlesAfterRun({ userId: 'u1', groupId: 'g1', window: { from: null } }, [], { total_km: 10, longest_streak: 0 }).catch((error: Error) => error);

beforeEach(() => {
  rpcCalls.length = 0;
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
});

describe('processUserTitlesAfterRun thrown error', () => {
  it('writes the title and never rebuilds the ranking itself (processGroupTitles does that once per group)', async () => {
    const tables = use();

    expect(await run()).toBeUndefined();

    expect(tables.user_titles).toHaveLength(1);
    expect(rpcCalls).toEqual([]);
  });

  it('carries the code of the failed title write and nothing of the database text', async () => {
    use({ failWhen: (q) => (q.table === 'user_titles' && q.mutation === 'insert' ? { message: `duplicate key ${LEAK}`, code: '23505' } : null) });

    const failure = await run();

    expect(failure).toBeInstanceOf(Error);
    expect(errorCode(failure)).toBe('23505');
    expect((failure as Error).message).toBe('1 title check(s) failed (user u1)');
    expect(JSON.stringify(failure)).not.toContain('LEAKMARKER');
  });

  it('names the network cause when the connection broke during a title write (supabase-js code "")', async () => {
    const networkError = { message: 'TypeError: fetch failed', details: 'Caused by: Error: read ECONNRESET (ECONNRESET)', hint: '', code: '' };
    use({ failWhen: (q) => (q.table === 'user_titles' && q.mutation === 'insert' ? networkError : null) });

    expect(errorCode(await run())).toBe('ECONNRESET');
  });

  it('carries the code of a failed read of the existing title row', async () => {
    use({ failWhen: (q) => (q.table === 'user_titles' && !q.mutation ? { message: LEAK, code: '57014' } : null) });

    expect(errorCode(await run())).toBe('57014');
  });

  it('carries the code of a failed titles read', async () => {
    use({ failWhen: (q) => (q.table === 'titles' ? { message: LEAK, code: '42P01' } : null) });

    const failure = await run();

    expect(errorCode(failure)).toBe('42P01');
    expect((failure as Error).message).toBe('Titles fetch failed');
  });
});
