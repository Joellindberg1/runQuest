/**
 * What the run routes log when something fails (ADR 010 decision 8.6): our ids and the error CODE, never the error object. A database
 * error carries the values of the row in its message and details (a Strava id, a coordinate, a title), and an Error's stack repeats
 * its message. Every failure path of the group history and of creating, updating and deleting a run is made to fail with a message
 * full of such values, and then everything that was logged is searched for them.
 *
 * Through the real app: the database is createFakeDb. Mocked at the edge: totals, event qualification, the XP config.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

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
import { checkEventQualification } from '../../services/eventService.js';
import app from '../../app.js';
import { createFakeDb, type FakeDbOptions, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });

const LEAK = 'failed for external_id 987654321 at 59.3293,18.0686 "My secret morning run"';
const SECRETS = ['987654321', '59.3293', '18.0686', 'secret morning'];
/** The shape of a PostgREST error: a plain object with a code and a message and details that carry the row's values. */
const dbError = (code: string, over: Row = {}) => ({ code, message: LEAK, details: LEAK, hint: LEAK, ...over }) as never;
const leakyError = (code: string): Error => Object.assign(new Error(LEAK), { code, details: LEAK });

let lines: string[];
beforeEach(() => {
  vi.clearAllMocks();
  lines = [];
  for (const level of ['info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
      lines.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg, Object.getOwnPropertyNames(Object(arg))))).join(' '));
    });
  }
});
afterEach(() => { vi.restoreAllMocks(); });

const token = mintToken({ user_id: 'user-1', group_id: 'group-1' });
const KEY = '3f2b8c1e-5d4a-4e7b-9c3d-2a1b0c9d8e7f';

function setup(failWhen?: FakeDbOptions['failWhen']) {
  const tables: Record<string, Row[]> = {
    runs: [{ id: 'run-1', user_id: 'user-1', date: '2026-01-10', distance: 4, streak_day: 1, xp_gained: 20, source: 'manual', external_id: null }],
    user_boosts: [],
    event_entries: [],
    run_weather: [],
    users: [{ id: 'user-1', group_id: 'group-1' }],
  };
  vi.mocked(getSupabaseClient).mockReturnValue(createFakeDb(tables, { autoIds: true, failWhen }).client as never);
  return tables;
}

/** The handler's own try block fails on its log line: the outer catch is the only thing that sees it. */
function failOnLogLine(fragment: string, code: string) {
  const record = vi.mocked(logger.info).getMockImplementation()!;
  vi.mocked(logger.info).mockImplementation((...args: unknown[]) => {
    record(...args);
    if (String(args[0]).includes(fragment)) throw leakyError(code);
  });
}

/** The log names the failure by code and carries nothing from the message, details, hint or stack. */
function expectOnlyTheCode(code: string) {
  expect(lines.some((line) => line.includes(code))).toBe(true);
  expect(lines.filter((line) => SECRETS.some((secret) => line.includes(secret)))).toEqual([]);
  expect(lines.filter((line) => line.includes('    at '))).toEqual([]);
}

const create = (headers: Record<string, string> = {}) =>
  server.request('POST', '/api/runs', { token, body: { date: '2026-01-11', distance: 5 }, headers });
const update = () => server.request('PUT', '/api/runs/run-1', { token, body: { distance: 7 } });
const remove = () => server.request('DELETE', '/api/runs/run-1', { token });

describe('the group history', () => {
  it('logs only the code when the runs cannot be fetched', async () => {
    setup((q) => (q.table === 'runs' && q.select !== null ? dbError('G0001') : null));

    const res = await server.request('GET', '/api/runs/group-history', { token });

    expect(res.status).toBe(500);
    expectOnlyTheCode('G0001');
  });

  it('logs only the code when something else fails', async () => {
    setup();
    failOnLogLine('Fetching group run history', 'G0002');

    const res = await server.request('GET', '/api/runs/group-history', { token });

    expect(res.status).toBe(500);
    expectOnlyTheCode('G0002');
  });
});

describe('creating a run', () => {
  it('logs only the code when the idempotency lookup fails', async () => {
    setup((q) => (q.table === 'runs' && q.filters.some((f) => f.column === 'client_request_id') ? dbError('C0001') : null));

    const res = await create({ 'Idempotency-Key': KEY });

    expect(res.status).toBe(500);
    expectOnlyTheCode('C0001');
  });

  it('logs only the code when a concurrent insert won but its run cannot be read', async () => {
    let lookups = 0;
    setup((q) => {
      if (q.table !== 'runs') return null;
      if (q.mutation === 'insert') {
        return dbError('23505', { message: 'duplicate key value violates unique constraint "runs_user_client_request_id_key"' });
      }
      if (q.filters.some((f) => f.column === 'client_request_id') && ++lookups === 2) return dbError('C0002');
      return null;
    });

    const res = await create({ 'Idempotency-Key': KEY });

    expect(res.status).toBe(500);
    expectOnlyTheCode('C0002');
  });

  it('logs only the code when the insert fails', async () => {
    setup((q) => (q.table === 'runs' && q.mutation === 'insert' ? dbError('C0003') : null));

    const res = await create();

    expect(res.status).toBe(500);
    expectOnlyTheCode('C0003');
  });

  it('logs only the code when the event qualification fails', async () => {
    setup();
    vi.mocked(checkEventQualification).mockRejectedValueOnce(leakyError('C0004'));

    const res = await create();
    await vi.waitFor(() => expect(lines.some((line) => line.includes('checkEventQualification'))).toBe(true));

    expect(res.status).toBe(200);
    expectOnlyTheCode('C0004');
  });

  it('logs only the code when the processed run cannot be fetched', async () => {
    setup((q) => (q.table === 'runs' && q.select?.includes('is_treadmill') && q.filters.some((f) => f.column === 'id') ? dbError('C0005') : null));

    const res = await create();

    expect(res.status).toBe(200);
    expectOnlyTheCode('C0005');
  });

  it('logs only the code when something else fails', async () => {
    setup();
    failOnLogLine('Creating run for user', 'C0006');

    const res = await create();

    expect(res.status).toBe(500);
    expectOnlyTheCode('C0006');
  });
});

describe('updating a run', () => {
  it('logs only the code when the update fails', async () => {
    setup((q) => (q.table === 'runs' && q.mutation === 'update' ? dbError('U0001') : null));

    const res = await update();

    expect(res.status).toBe(500);
    expectOnlyTheCode('U0001');
  });

  it('logs only the code when the event qualification fails', async () => {
    setup();
    vi.mocked(checkEventQualification).mockRejectedValueOnce(leakyError('U0002'));

    const res = await update();
    await vi.waitFor(() => expect(lines.some((line) => line.includes('checkEventQualification'))).toBe(true));

    expect(res.status).toBe(200);
    expectOnlyTheCode('U0002');
  });

  it('logs only the code when the updated run cannot be fetched', async () => {
    setup((q) => (q.table === 'runs' && q.select?.includes('xp_gained, multiplier') && q.filters.some((f) => f.column === 'id') ? dbError('U0003') : null));

    const res = await update();

    expect(res.status).toBe(200);
    expectOnlyTheCode('U0003');
  });

  it('logs only the code when something else fails', async () => {
    setup();
    failOnLogLine('Updating run', 'U0004');

    const res = await update();

    expect(res.status).toBe(500);
    expectOnlyTheCode('U0004');
  });
});

describe('deleting a run', () => {
  it('logs only the code when the event entries cannot be checked', async () => {
    setup((q) => (q.table === 'event_entries' ? dbError('D0001') : null));

    const res = await remove();

    expect(res.status).toBe(500);
    expectOnlyTheCode('D0001');
  });

  it('logs only the code when the delete fails', async () => {
    setup((q) => (q.table === 'runs' && q.mutation === 'delete' ? dbError('D0002') : null));

    const res = await remove();

    expect(res.status).toBe(500);
    expectOnlyTheCode('D0002');
  });

  it('logs only the code when something else fails', async () => {
    setup();
    failOnLogLine('Deleting run', 'D0003');

    const res = await remove();

    expect(res.status).toBe(500);
    expectOnlyTheCode('D0003');
  });
});
