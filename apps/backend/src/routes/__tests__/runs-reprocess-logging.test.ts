/**
 * A failed read or write in reprocessRunsFromDate throws an error with a fixed message (user id, counts) and the database CODE in
 * `code`, never the database text: a Postgres error can carry the row's values (Strava id, coordinates) in message and details
 * (ADR 010 decision 8.6). The function logs nothing itself; the callers that catch it log `errorCode(error)`, one Sentry event
 * per failure.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));
vi.mock('../../utils/calculateUserTotals.js', () => ({ calculateUserTotals: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../services/eventService.js', () => ({
  checkEventQualification: vi.fn().mockResolvedValue(undefined),
  maybeCreateEvent: vi.fn(),
  activateScheduledEvents: vi.fn(),
  settleCompetitionEvents: vi.fn(),
  settleExpiredParticipationEvents: vi.fn(),
}));
vi.mock('../../services/xpConfig.js', async () => {
  const shared = await import('@runquest/shared');
  return {
    getXpConfig: vi.fn(async () => ({
      settings: shared.DEFAULT_ADMIN_SETTINGS,
      streak_multipliers: shared.DEFAULT_STREAK_MULTIPLIERS,
      meta: { settings_source: 'defaults', multipliers_source: 'defaults' },
    })),
    invalidateXpConfigCache: vi.fn(),
  };
});

import { getSupabaseClient } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import { reprocessRunsFromDate } from '../runs.js';
import { createFakeDb, type RecordedQuery, type Row } from './helpers/fakeDb.js';

const LEAK = 'failed for external_id 987654321 at 59.3293,18.0686 "My secret morning run"';
const SECRETS = ['987654321', '59.3293', '18.0686', 'secret morning'];

let lines: string[];
let errorLines: string[];
beforeEach(() => {
  vi.clearAllMocks();
  lines = [];
  errorLines = [];
  for (const level of ['info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
      const line = args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg, Object.getOwnPropertyNames(Object(arg))))).join(' ');
      lines.push(line);
      if (level === 'error') errorLines.push(line);
    });
  }
});
afterEach(() => vi.restoreAllMocks());

const run = (over: Row = {}): Row => ({ id: 'run-1', user_id: 'user-1', date: '2026-10-01', distance: 4, streak_day: 1, xp_gained: 0, ...over });

function use(failWhen: (q: RecordedQuery) => { message: string } | null) {
  const tables: Record<string, Row[]> = { runs: [run(), run({ id: 'run-2', date: '2026-10-02' })], user_boosts: [] };
  const db = createFakeDb(tables, { autoIds: true, failWhen });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
}

/** The read of the runs to reprocess (the only select of "id, date, distance" with a lower date bound). */
const isAffectedRunsRead = (q: RecordedQuery) => q.table === 'runs' && !q.mutation && q.select === 'id, date, distance';
const leaky = (code: string) => ({ message: LEAK, code }) as never;

describe('reprocessRunsFromDate thrown errors', () => {
  it('throws a code and the user id, and logs nothing, when the read of the runs to reprocess fails', async () => {
    use((q) => (isAffectedRunsRead(q) ? leaky('57014') : null));

    const failure = await reprocessRunsFromDate('user-1', '2026-10-01').catch((error: Error) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('Failed to fetch runs to reprocess (user user-1)');
    expect((failure as { code?: string }).code).toBe('57014');
    for (const secret of SECRETS) expect((failure as Error).message).not.toContain(secret);
    expect(errorLines).toEqual([]);
  });

  it('throws the count, the user id and the code of the first failure, and logs nothing, when run updates fail', async () => {
    use((q) => (q.table === 'runs' && q.mutation === 'update' ? leaky('23514') : null));

    const failure = await reprocessRunsFromDate('user-1', '2026-10-01').catch((error: Error) => error);

    expect((failure as Error).message).toBe('2 of 2 run updates failed during reprocess (user user-1)');
    expect((failure as { code?: string }).code).toBe('23514');
    for (const secret of SECRETS) expect((failure as Error).message).not.toContain(secret);
    expect(errorLines).toEqual([]);
  });

  it('names the supabase-js network cause when the database cannot be reached', async () => {
    const networkError = {
      message: 'TypeError: fetch failed',
      details: 'TypeError: fetch failed\n\nCaused by: Error: read ECONNRESET (ECONNRESET)',
      hint: '',
      code: '',
    };
    use((q) => (isAffectedRunsRead(q) ? (networkError as never) : null));

    const failure = await reprocessRunsFromDate('user-1', '2026-10-01').catch((error: Error) => error);

    expect((failure as { code?: string }).code).toBe('ECONNRESET');
  });
});
