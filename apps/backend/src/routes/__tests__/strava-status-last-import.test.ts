/**
 * GET /api/strava/status: `last_import_at`, the time the user's newest Strava run came in (runs.created_at, set when the run is
 * imported), whether it arrived by webhook or by polling. Not the activity's date, not a manual run, not another user's run.
 * Through the real app; the database is createFakeDb.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.STRAVA_CLIENT_ID = 'client-id';
process.env.STRAVA_CLIENT_SECRET = 'client-secret';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import app from '../../app.js';
import { createFakeDb, type RecordedQuery, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });

let warnings: string[];
beforeEach(() => {
  vi.clearAllMocks();
  warnings = [];
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation((...args: unknown[]) => { warnings.push(args.map(String).join(' ')); });
});
afterEach(() => vi.restoreAllMocks());

const TOKEN_ROW = { user_id: 'user-1', access_token: 'at', refresh_token: 'rt', expires_at: 9999999999, connection_date: '2026-09-01', users: { name: 'Test' } };

const run = (id: string, over: Row = {}): Row => ({
  id, user_id: 'user-1', source: 'strava', date: '2026-10-01', created_at: '2026-10-02T08:00:00.000Z', ...over,
});

function use(runs: Row[], failWhen?: (q: RecordedQuery) => { message: string; code?: string } | null, tokenOver: Row = {}) {
  const db = createFakeDb(
    { strava_tokens: [{ ...TOKEN_ROW, ...tokenOver }], runs, users: [{ id: 'user-1' }] },
    { autoIds: true, primaryKeys: { strava_tokens: ['user_id'] }, failWhen },
  );
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
}

const status = () => server.request('GET', '/api/strava/status', { token: mintToken({ user_id: 'user-1', group_id: 'group-1' }) });

describe('GET /api/strava/status last_import_at', () => {
  it('a user without any Strava run has last_import_at null', async () => {
    use([]);

    const res = await status();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ connected: true });
    expect(res.body).toHaveProperty('last_import_at', null);
  });

  it('several Strava runs give the time the newest one was imported, not the newest activity date', async () => {
    use([
      run('r1', { date: '2026-10-09', created_at: '2026-10-09T18:00:00.000Z' }),
      // The newest import is an older activity (a backfilled or late-arriving run): created_at decides, not date.
      run('r2', { date: '2026-09-20', created_at: '2026-10-12T07:30:00.000Z' }),
      run('r3', { date: '2026-10-11', created_at: '2026-10-11T12:00:00.000Z' }),
    ]);

    const res = await status();

    expect(res.body.last_import_at).toBe('2026-10-12T07:30:00.000Z');
  });

  it('a manual run is not an import', async () => {
    use([
      run('r1', { created_at: '2026-10-02T08:00:00.000Z' }),
      run('r2', { source: 'manual', created_at: '2026-10-14T08:00:00.000Z' }),
    ]);

    const res = await status();

    expect(res.body.last_import_at).toBe('2026-10-02T08:00:00.000Z');
  });

  it("another user's Strava run is not this user's import", async () => {
    use([
      run('r1', { created_at: '2026-10-02T08:00:00.000Z' }),
      run('r2', { user_id: 'user-2', created_at: '2026-10-14T08:00:00.000Z' }),
    ]);
    expect((await status()).body.last_import_at).toBe('2026-10-02T08:00:00.000Z');

    use([run('r2', { user_id: 'user-2', created_at: '2026-10-14T08:00:00.000Z' })]);
    expect((await status()).body.last_import_at).toBeNull();
  });

  it('a failed read gives null with a warning that has the code only, and the status is still answered with 200', async () => {
    const leak = 'failed for user-1 at secret-host';
    use([run('r1')], (q) => (q.table === 'runs' && q.filters.some((f) => f.column === 'user_id') ? { message: leak, code: 'L0001' } : null));

    const res = await status();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ connected: true, expired: false });
    expect(res.body.last_import_at).toBeNull();
    expect(warnings.some((line) => line.includes('L0001'))).toBe(true);
    expect(warnings.filter((line) => line.includes(leak) || line.includes('secret-host'))).toEqual([]);
  });

  it('a client that throws gives null and 200 too', async () => {
    const db = createFakeDb({ strava_tokens: [{ ...TOKEN_ROW }], runs: [], users: [{ id: 'user-1' }] }, { autoIds: true, primaryKeys: { strava_tokens: ['user_id'] } });
    vi.mocked(getSupabaseClient).mockReturnValue({
      from: (table: string) => {
        const builder = db.client.from(table);
        if (table !== 'runs') return builder;
        // Only the per-user read throws (the unrelated global read in the same route keeps working).
        return new Proxy(builder, {
          get: (target, prop) => (prop === 'eq'
            ? (column: string, value: unknown) => { if (column === 'user_id') throw Object.assign(new Error('boom'), { code: 'T0001' }); return target.eq(column, value); }
            : Reflect.get(target, prop)),
        });
      },
    } as any);

    const res = await status();

    expect(res.status).toBe(200);
    expect(res.body.last_import_at).toBeNull();
  });

  it('status exposes no global or other user timestamp: the only time in it is this user\'s own last_import_at', async () => {
    use([
      run('r1', { created_at: '2026-10-02T08:00:00.000Z' }),
      run('r2', { user_id: 'user-2', created_at: '2026-10-14T23:59:00.000Z' }),
      run('r3', { user_id: 'user-3', source: 'manual', created_at: '2026-10-15T01:00:00.000Z' }),
    ]);

    const res = await status();

    expect(res.body).not.toHaveProperty('last_sync');
    expect(Object.keys(res.body).sort()).toEqual(
      ['connected', 'connection_date', 'consent_version', 'expired', 'expires_at', 'last_import_at', 'paused_at', 'sync_paused'],
    );
    expect(JSON.stringify(res.body)).not.toMatch(/2026-10-14T23:59|2026-10-15T01:00/);
    expect(res.body.last_import_at).toBe('2026-10-02T08:00:00.000Z');

    // A user who has no Strava run of their own sees no time at all, however recent the others' runs are.
    use([run('r2', { user_id: 'user-2', created_at: '2026-10-14T23:59:00.000Z' })]);
    const none = await status();
    expect(none.body.last_import_at).toBeNull();
    expect(JSON.stringify(none.body)).not.toMatch(/2026-10-14T23:59/);
  });

  it('a paused user gets it too', async () => {
    use([run('r1', { created_at: '2026-10-02T08:00:00.000Z' })], undefined, { sync_paused: true, paused_at: '2026-10-10T09:00:00+00:00' });

    const res = await status();

    expect(res.body).toMatchObject({ sync_paused: true });
    expect(res.body.last_import_at).toBe('2026-10-02T08:00:00.000Z');
  });
});
