/**
 * POST /api/strava/callback för en användare som redan har en (utgången) koppling — "Reconnect Strava".
 *
 * Reconnect får skriva över tokens men aldrig röra rundorna: frontend anropar inte längre disconnect, och disconnect
 * raderar användarens Stravarundor. Testet pekar ut beteendet (tokens ersatta, rundor orörda) och gäller oavsett hur
 * callbacken i övrigt utvecklas.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

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
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });

const EXPIRED_TOKENS: Row = {
  user_id: 'user-1', access_token: 'old-access', refresh_token: 'old-refresh', expires_at: 1_000, connection_date: '2026-01-01T00:00:00.000Z',
};
const OTHER_USERS_TOKENS: Row = {
  user_id: 'user-2', access_token: 'other-access', refresh_token: 'other-refresh', expires_at: 9_999_999_999, connection_date: '2026-02-01T00:00:00.000Z',
};
const stravaRun = (over: Row): Row => ({
  user_id: 'user-1', source: 'strava', date: '2026-09-01', distance: 5, xp_gained: 55, streak_day: 1, ...over,
});

beforeEach(() => {
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
  // Strava byter koden mot nya tokens.
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ access_token: 'new-access', refresh_token: 'new-refresh', expires_at: 9_999_999_999, athlete: { id: 42 } }),
  })));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** Tabellen har user_id som primärnyckel; fakens upsert utan onConflict antar annars kolumnen `id`. */
function useDb(tables: Record<string, Row[]>) {
  const db = createFakeDb(tables);
  const client = {
    ...db.client,
    from(table: string) {
      const builder = db.client.from(table);
      if (table !== 'strava_tokens') return builder;
      const upsert = builder.upsert.bind(builder);
      builder.upsert = (values: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) => upsert(values, { onConflict: 'user_id', ...opts });
      return builder;
    },
  };
  vi.mocked(getSupabaseClient).mockReturnValue(client as any);
  return db;
}

describe('POST /api/strava/callback — omkoppling', () => {
  it('callback for a user with an existing connection overwrites the tokens and keeps the runs', async () => {
    const runs = [stravaRun({ id: 'run-1', external_id: '1001' }), stravaRun({ id: 'run-2', external_id: '1002', date: '2026-09-02', streak_day: 2 })];
    const tables = { strava_tokens: [{ ...EXPIRED_TOKENS }, { ...OTHER_USERS_TOKENS }], runs: runs.map((r) => ({ ...r })) };
    const db = useDb(tables);

    const res = await server.request('POST', '/api/strava/callback', {
      token: mintToken({ user_id: 'user-1' }),
      body: { code: 'fresh-code' },
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const own = tables.strava_tokens.filter((t) => t.user_id === 'user-1');
    expect(own).toHaveLength(1); // ersatt, inte tillagd vid sidan av
    expect(own[0]).toMatchObject({ access_token: 'new-access', refresh_token: 'new-refresh', expires_at: 9_999_999_999 });
    expect(own[0].connection_date).not.toBe(EXPIRED_TOKENS.connection_date);
    expect(tables.strava_tokens.find((t) => t.user_id === 'user-2')).toEqual(OTHER_USERS_TOKENS);

    expect(tables.runs).toEqual(runs);
    expect(db.queries.filter((q) => q.table === 'runs' && q.mutation)).toEqual([]);
  });
});
