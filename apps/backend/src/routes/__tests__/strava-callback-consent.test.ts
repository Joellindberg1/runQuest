/**
 * POST /api/strava/callback och GET /api/strava/status — samtyckesloggen (ADR 010 beslut 12).
 *
 * Callbacken kräver aktuell STRAVA_CONSENT_VERSION innan koden byts mot token hos Strava, och servern sätter
 * consented_at. Strava-API:t är fakeStrava (anropsräknare på oauth/token), databasen createFakeDb med primärnyckel.
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
import { logger } from '../../utils/logger.js';
import app from '../../app.js';
import { installFakeStravaFetch, stravaAthlete, stravaTokenResponse, type FakeStrava } from '../../test-utils/fakeStrava.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });

let strava: FakeStrava;
beforeEach(() => {
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
  strava = installFakeStravaFetch({ oauthToken: stravaTokenResponse({ athlete: stravaAthlete({ id: 4711 }) }) });
});
afterEach(() => {
  strava.restore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function use(strava_tokens: Row[] = [], runs: Row[] = []) {
  const t: Record<string, Row[]> = { strava_tokens, runs };
  const db = createFakeDb(t, { primaryKeys: { strava_tokens: ['user_id'] } });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return t;
}

const connect = (body: Record<string, unknown>, user_id = 'user-1') =>
  server.request('POST', '/api/strava/callback', { token: mintToken({ user_id }), body });

const existing = (user_id: string, over: Row = {}): Row => ({
  user_id, access_token: 'old-at', refresh_token: 'old-rt', expires_at: 1, connection_date: '2026-09-01T00:00:00.000Z', sync_paused: false, ...over,
});

describe('POST /api/strava/callback — consent', () => {
  it('callback without consent_version returns 400 and does not call Strava', async () => {
    const t = use();

    const res = await connect({ code: 'auth-code' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Consent required' });
    expect(strava.calls.oauthToken).toBe(0);
    expect(t.strava_tokens).toEqual([]);
  });

  it('callback with a consent_version that differs from the current one returns 400 and does not call Strava', async () => {
    const t = use([existing('user-1')]);

    for (const consent_version of ['2020-01-01', '', null, 7]) {
      const res = await connect({ code: 'auth-code', consent_version });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Consent required' });
    }

    expect(strava.calls.oauthToken).toBe(0);
    expect(t.strava_tokens).toEqual([existing('user-1')]); // en befintlig koppling lämnas orörd
  });

  it('callback with the current consent_version stores consent_version and consented_at', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-14T09:30:00.000Z') });
    const t = use();

    const res = await connect({ code: 'auth-code', consent_version: STRAVA_CONSENT_VERSION });

    expect(res.status).toBe(200);
    expect(strava.calls.oauthToken).toBe(1);
    expect(t.strava_tokens).toHaveLength(1);
    expect(t.strava_tokens[0]).toMatchObject({
      user_id: 'user-1',
      access_token: 'fake-access-token',
      consent_version: STRAVA_CONSENT_VERSION,
      consented_at: '2026-10-14T09:30:00.000Z',
    });
  });

  it('callback sets consented_at on the server and ignores a value sent by the client', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-14T09:30:00.000Z') });
    const t = use();

    const res = await connect({ code: 'auth-code', consent_version: STRAVA_CONSENT_VERSION, consented_at: '2001-01-01T00:00:00.000Z' });

    expect(res.status).toBe(200);
    expect(t.strava_tokens[0].consented_at).toBe('2026-10-14T09:30:00.000Z');
  });

  it('reconnect overwrites consent_version and consented_at', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-14T09:30:00.000Z') });
    const t = use([existing('user-1', { consent_version: '2026-01-01', consented_at: '2026-01-01T00:00:00.000Z' })]);

    const res = await connect({ code: 'auth-code', consent_version: STRAVA_CONSENT_VERSION });

    expect(res.status).toBe(200);
    expect(t.strava_tokens).toHaveLength(1);
    expect(t.strava_tokens[0]).toMatchObject({ consent_version: STRAVA_CONSENT_VERSION, consented_at: '2026-10-14T09:30:00.000Z' });
  });

  it('callback answers with the success flag and message only, never the Strava athlete profile', async () => {
    use();

    const res = await connect({ code: 'auth-code', consent_version: STRAVA_CONSENT_VERSION });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Object.keys(res.body).sort()).toEqual(['message', 'success']);
    expect(JSON.stringify(res.body)).not.toMatch(/fake_runner|Fake|Runner|4711/);
  });
});

describe('GET /api/strava/status — consent', () => {
  const status = () => server.request('GET', '/api/strava/status', { token: mintToken({ user_id: 'user-1' }) });
  const FUTURE = 9_999_999_999;

  it('status includes consent_version for a connected user', async () => {
    use([existing('user-1', { expires_at: FUTURE, consent_version: STRAVA_CONSENT_VERSION, consented_at: '2026-10-14T09:30:00.000Z' })]);

    const res = await status();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ connected: true, expired: false, consent_version: STRAVA_CONSENT_VERSION });
  });

  it('status leaves consent_version null for connections made before the consent log', async () => {
    use([existing('user-1', { expires_at: FUTURE, consent_version: null, consented_at: null })]);

    const res = await status();

    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
    expect(res.body.consent_version).toBeNull();
  });
});
