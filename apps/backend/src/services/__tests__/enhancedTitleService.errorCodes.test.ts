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

function use(options: { failWhen?: (q: RecordedQuery) => { message: string; code?: string; details?: string } | null; failRefresh?: { message: string; code: string } } = {}) {
  const tables: Record<string, Row[]> = { titles: [TITLE], user_titles: [], users: [{ id: 'u1', total_km: 10, longest_streak: 0 }], runs: [] };
  const db = createFakeDb(tables, {
    autoIds: true,
    failWhen: options.failWhen,
    rpc: { update_group_title_leaderboard: () => (options.failRefresh ? { error: options.failRefresh } : { data: null }) },
  });
  holder.client = db.client;
  return tables;
}

const run = (service = new EnhancedTitleService()) => service.processUserTitlesAfterRun({ userId: 'u1', groupId: 'g1', window: { from: null } }, [], { total_km: 10, longest_streak: 0 }).catch((error: Error) => error);

beforeEach(() => {
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
});

describe('processUserTitlesAfterRun thrown error', () => {
  it('carries the code of the failed title write and nothing of the database text', async () => {
    use({ failWhen: (q) => (q.table === 'user_titles' && q.mutation === 'insert' ? { message: `duplicate key ${LEAK}`, code: '23505' } : null) });

    const failure = await run();

    expect(failure).toBeInstanceOf(Error);
    expect(errorCode(failure)).toBe('23505');
    expect((failure as Error).message).toBe('1 title check(s) and 0 leaderboard refresh(es) failed (user u1)');
    expect(JSON.stringify(failure)).not.toContain('LEAKMARKER');
  });

  it('carries the code of a failed leaderboard refresh when every title check passed', async () => {
    use({ failRefresh: { message: `deadlock ${LEAK}`, code: '40P01' } });

    const failure = await run();

    expect(errorCode(failure)).toBe('40P01');
    expect((failure as Error).message).toBe('0 title check(s) and 1 leaderboard refresh(es) failed (user u1)');
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
