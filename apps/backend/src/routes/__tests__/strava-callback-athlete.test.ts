/**
 * POST /api/strava/callback — Strava-identitet (migration 045): athlete-id sparas i samma upsert som token, samma
 * Strava-konto kan inte höra till två RunQuest-användare, en ny anslutning är aldrig pausad.
 * Strava-API:t stubbas lokalt (fetch); databasen är createFakeDb med det riktiga unika indexet.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.STRAVA_CLIENT_ID = 'test-client-id';
process.env.STRAVA_CLIENT_SECRET = 'test-client-secret';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { STRAVA_CONSENT_VERSION } from '@runquest/shared';
import { getSupabaseClient } from '../../config/database.js';
import { tokenCols, plainRow } from '../../test-utils/stravaTokens.js';
import { logger } from '../../utils/logger.js';
import app from '../../app.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });

let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  errorLog = vi.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** Stravas tokenbyte: svarar med tokens och (om `athlete` ges) athlete-objektet. */
function stubTokenExchange(athlete?: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      access_token: 'new-at', refresh_token: 'new-rt', expires_at: 2000000000,
      ...(athlete === undefined ? {} : { athlete }),
    }),
  })));
}

function use(strava_tokens: Row[] = []) {
  const t: Record<string, Row[]> = { strava_tokens };
  const db = createFakeDb(t, {
    primaryKeys: { strava_tokens: ['user_id'] },
    uniqueIndexes: [{ table: 'strava_tokens', name: 'strava_tokens_athlete_id_key', columns: ['strava_athlete_id'] }],
  });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return t;
}

const connect = (user_id = 'user-1') =>
  server.request('POST', '/api/strava/callback', { token: mintToken({ user_id, group_id: 'group-1' }), body: { code: 'auth-code', consent_version: STRAVA_CONSENT_VERSION } });

const existing = (user_id: string, over: Row = {}): Row => ({
  user_id, ...tokenCols(user_id, 'old-at', 'old-rt'), expires_at: 1, connection_date: '2026-09-01', sync_paused: false, ...over,
});

describe('POST /api/strava/callback — athlete identity', () => {
  it('callback stores strava_athlete_id from the token exchange', async () => {
    stubTokenExchange({ id: 4711, firstname: 'Test' });
    const t = use();

    const res = await connect('user-1');

    expect(res.status).toBe(200);
    expect(t.strava_tokens).toHaveLength(1);
    expect(plainRow(t.strava_tokens[0])).toMatchObject({ user_id: 'user-1', access_token: 'new-at', refresh_token: 'new-rt', strava_athlete_id: 4711 });
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('callback rejects a second user connecting an athlete already linked with 409', async () => {
    stubTokenExchange({ id: 4711 });
    const t = use([existing('user-2', { strava_athlete_id: 4711 })]);

    const res = await connect('user-1');

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ success: false, error: 'This Strava account is already connected to another RunQuest user', code: 'strava_account_in_use' });
    expect(t.strava_tokens).toHaveLength(1); // ingen rad för user-1
    expect(plainRow(t.strava_tokens[0])).toMatchObject({ user_id: 'user-2', strava_athlete_id: 4711, access_token: 'old-at' }); // user-2 orörd
  });

  it('callback lets the same user reconnect the athlete they already own', async () => {
    stubTokenExchange({ id: 4711 });
    const t = use([existing('user-1', { strava_athlete_id: 4711 })]);

    const res = await connect('user-1');

    expect(res.status).toBe(200);
    expect(t.strava_tokens).toHaveLength(1);
    expect(plainRow(t.strava_tokens[0])).toMatchObject({ user_id: 'user-1', strava_athlete_id: 4711, access_token: 'new-at' });
  });

  it('callback keeps working and logs an error when the token response has no athlete object', async () => {
    stubTokenExchange(undefined);
    const t = use();

    const res = await connect('user-1');

    expect(res.status).toBe(200);
    expect(t.strava_tokens).toHaveLength(1);
    expect(plainRow(t.strava_tokens[0])).toMatchObject({ user_id: 'user-1', access_token: 'new-at' });
    expect(t.strava_tokens[0].strava_athlete_id ?? null).toBeNull();
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(String(errorLog.mock.calls[0][0])).toMatch(/athlete/i);
    expect(JSON.stringify(errorLog.mock.calls)).not.toMatch(/new-at|new-rt/); // aldrig token i loggen
  });

  it('callback treats an athlete object without a usable id the same way: saved without id, error logged', async () => {
    stubTokenExchange({ firstname: 'NoId' });
    const t = use();

    const res = await connect('user-1');

    expect(res.status).toBe(200);
    expect(t.strava_tokens[0].strava_athlete_id ?? null).toBeNull();
    expect(errorLog).toHaveBeenCalledTimes(1);
  });

  it('callback resets sync_paused to false on reconnect', async () => {
    stubTokenExchange({ id: 4711 });
    const t = use([existing('user-1', { strava_athlete_id: 4711, sync_paused: true, paused_at: '2026-10-01T00:00:00Z' })]);

    const res = await connect('user-1');

    expect(res.status).toBe(200);
    expect(t.strava_tokens).toHaveLength(1);
    expect(t.strava_tokens[0].sync_paused).toBe(false);
    expect(t.strava_tokens[0].paused_at).toBeNull();
  });

  it('callback keeps the stored athlete id when a reconnect response has no athlete object', async () => {
    stubTokenExchange(undefined);
    const t = use([existing('user-1', { strava_athlete_id: 4711 })]);

    const res = await connect('user-1');

    expect(res.status).toBe(200);
    expect(t.strava_tokens).toHaveLength(1);
    expect(plainRow(t.strava_tokens[0])).toMatchObject({ strava_athlete_id: 4711, access_token: 'new-at' });
  });

  it('callback does not report a 409 for other database failures', async () => {
    stubTokenExchange({ id: 4711 });
    const db = createFakeDb({ strava_tokens: [] }, { errors: { strava_tokens: { message: 'connection lost' } } });
    vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);

    const res = await connect('user-1');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to save Strava connection', code: 'internal_error' });
  });

  it('callback answers 500, not 409, for a unique violation on another constraint', async () => {
    stubTokenExchange({ id: 4711 });
    const db = createFakeDb({ strava_tokens: [] }, {
      errors: { strava_tokens: { code: '23505', message: 'duplicate key value violates unique constraint "strava_tokens_pkey"' } as any },
    });
    vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);

    const res = await connect('user-1');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to save Strava connection', code: 'internal_error' });
  });
});
