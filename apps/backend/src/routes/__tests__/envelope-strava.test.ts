/**
 * Kuvertet i /api/strava (inte webhooken), steg 1 (ADR 007 Addendum 2026-10-20): `success` på varje svar, `code` på varje fel, och `data` bredvid de gamla nycklarna
 * (status, config, sync, backfill, sync-all) eller `data: null` bredvid `message` (callback, disconnect). Stravas nätverk är fakeStrava; databasen är createFakeDb.
 * Säkerhet (punkt 5): ingen text från Strava eller databasen når ett felsvar.
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
vi.mock('../../utils/calculateUserTotals.js', () => ({ calculateUserTotals: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../services/eventService.js', () => ({
  checkEventQualification: vi.fn().mockResolvedValue(undefined),
  maybeCreateEvent: vi.fn(),
  activateScheduledEvents: vi.fn(),
  settleCompetitionEvents: vi.fn(),
  settleExpiredParticipationEvents: vi.fn(),
}));
vi.mock('../../services/weatherService.js', () => ({
  WeatherService: { fetchAndSaveWeatherForRuns: vi.fn().mockResolvedValue(undefined), backfillMissingWeather: vi.fn() },
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

import { STRAVA_CONSENT_VERSION } from '@runquest/shared';
import { getSupabaseClient } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import { tokenCols } from '../../test-utils/stravaTokens.js';
import { installFakeStravaFetch, stravaError, stravaTokenResponse, type FakeStrava } from '../../test-utils/fakeStrava.js';
import app from '../../app.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
let strava: FakeStrava | undefined;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });
beforeEach(() => {
  vi.clearAllMocks();
  for (const level of ['info', 'warn', 'error', 'debug'] as const) vi.spyOn(logger, level).mockImplementation(() => {});
});
afterEach(() => {
  strava?.restore();
  strava = undefined;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const TOKEN_ROW = { user_id: 'user-1', ...tokenCols('user-1', 'old-at', 'old-rt'), expires_at: 9999999999, connection_date: '2026-09-01', sync_paused: false, paused_at: null, users: { name: 'Test' } };

function use(tables: Record<string, Row[]> = {}) {
  const t: Record<string, Row[]> = { strava_tokens: [{ ...TOKEN_ROW }], runs: [], user_boosts: [], users: [{ id: 'user-1', is_admin: true, group_id: 'group-1' }], ...tables };
  const db = createFakeDb(t, { autoIds: true, primaryKeys: { strava_tokens: ['user_id'] } });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as never);
  return t;
}
const token = () => mintToken({ user_id: 'user-1', group_id: 'group-1' });

describe('GET /api/strava/config', () => {
  it('answers client_id at the top level (old client) and in data (new client)', async () => {
    const res = await server.request('GET', '/api/strava/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, client_id: 'client-id', data: { client_id: 'client-id' } });
  });

  it('answers 500 internal_error when the client id is not configured', async () => {
    vi.stubEnv('STRAVA_CLIENT_ID', '');
    const res = await server.request('GET', '/api/strava/config');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Strava client ID not configured', code: 'internal_error' });
  });
});

describe('GET /api/strava/status', () => {
  it('answers the connection fields at the top level and the same fields in data', async () => {
    strava = installFakeStravaFetch({});
    use();
    const res = await server.request('GET', '/api/strava/status', { token: token() });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body).toMatchObject({ connected: true, expired: false, sync_paused: false });
    const { success: _success, data, ...legacy } = res.body;
    expect(data).toEqual(legacy);
  });

  it('answers a user without a connection as connected: false in both forms', async () => {
    strava = installFakeStravaFetch({});
    use({ strava_tokens: [] });
    const res = await server.request('GET', '/api/strava/status', { token: token() });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, connected: false, expired: false, data: { connected: false, expired: false } });
  });

  it('answers 503 strava_unavailable, with the fixed text, for a token that cannot be read', async () => {
    strava = installFakeStravaFetch({});
    use({ strava_tokens: [{ ...TOKEN_ROW, access_token: 'enc:v1:test-1:AAAA' }] });
    const res = await server.request('GET', '/api/strava/status', { token: token() });
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ success: false, error: 'Strava is temporarily unavailable', code: 'strava_unavailable' });
  });
});

describe('PUT /api/strava/sync-paused', () => {
  it('answers { success, data: { sync_paused, paused_at } }, unchanged', async () => {
    strava = installFakeStravaFetch({ athleteActivities: [] });
    use();
    const res = await server.request('PUT', '/api/strava/sync-paused', { token: token(), body: { paused: true } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { sync_paused: true, paused_at: expect.any(String) } });
  });

  it('answers 400 invalid_request for a wrong body and 400 strava_not_connected without a connection', async () => {
    strava = installFakeStravaFetch({});
    use({ strava_tokens: [] });
    const wrong = await server.request('PUT', '/api/strava/sync-paused', { token: token(), body: { paused: 'yes' } });
    expect(wrong.status).toBe(400);
    expect(wrong.body).toEqual({ success: false, error: 'Body must be exactly { "paused": boolean }', code: 'invalid_request' });
    const none = await server.request('PUT', '/api/strava/sync-paused', { token: token(), body: { paused: true } });
    expect(none.status).toBe(400);
    expect(none.body).toEqual({ success: false, error: 'User not connected to Strava', code: 'strava_not_connected' });
  });
});

describe('POST /api/strava/callback', () => {
  const connect = (body: Record<string, unknown>) => server.request('POST', '/api/strava/callback', { token: token(), body });

  it('answers message at the top level and data: null next to it', async () => {
    strava = installFakeStravaFetch({ oauthToken: stravaTokenResponse() });
    use({ strava_tokens: [] });
    const res = await connect({ code: 'auth-code', consent_version: STRAVA_CONSENT_VERSION });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'Strava connected successfully', data: null });
  });

  it('answers 400 consent_required without the consent, and 400 invalid_request without a code', async () => {
    strava = installFakeStravaFetch({});
    use({ strava_tokens: [] });
    const noConsent = await connect({ code: 'auth-code' });
    expect(noConsent.status).toBe(400);
    expect(noConsent.body).toEqual({ success: false, error: 'Consent required', code: 'consent_required' });
    const noCode = await connect({ consent_version: STRAVA_CONSENT_VERSION });
    expect(noCode.status).toBe(400);
    expect(noCode.body).toEqual({ success: false, error: 'Authorization code required', code: 'invalid_request' });
  });

  it('answers 400 strava_authorization_failed with a fixed text and nothing of the answer from Strava', async () => {
    strava = installFakeStravaFetch({ oauthToken: stravaError(400, { body: { message: 'Bad Request', errors: [{ resource: 'Athlete 12345678901', field: 'code', code: 'invalid' }] } }) });
    use({ strava_tokens: [] });
    const res = await connect({ code: 'auth-code', consent_version: STRAVA_CONSENT_VERSION });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'Failed to exchange authorization code', code: 'strava_authorization_failed' });
    expect(JSON.stringify(res.body)).not.toContain('12345678901');
  });

  it('answers 503 strava_unavailable and does not exchange the code when the token key is missing', async () => {
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', '');
    strava = installFakeStravaFetch({ oauthToken: stravaTokenResponse() });
    use({ strava_tokens: [] });
    const res = await connect({ code: 'auth-code', consent_version: STRAVA_CONSENT_VERSION });
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ success: false, error: 'Strava is temporarily unavailable', code: 'strava_unavailable' });
    expect(strava.calls.oauthToken).toBe(0);
  });
});

describe('DELETE /api/strava/disconnect', () => {
  it('answers message at the top level and data: null next to it', async () => {
    strava = installFakeStravaFetch({ oauthDeauthorize: { access_token: 'old-at' } });
    use({ strava_tokens: [] });
    const res = await server.request('DELETE', '/api/strava/disconnect', { token: token() });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'Strava disconnected successfully', data: null });
  });
});

describe('POST /api/strava/sync', () => {
  it('answers message, newRuns and totalActivities at the top level and newRuns and totalActivities in data', async () => {
    strava = installFakeStravaFetch({ oauthToken: stravaTokenResponse(), athleteActivities: [] });
    use();
    const res = await server.request('POST', '/api/strava/sync', { token: token() });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'Synced 0 new runs from Strava', newRuns: 0, totalActivities: 0, data: { newRuns: 0, totalActivities: 0 } });
  });

  it('answers 409 sync_paused for a paused connection', async () => {
    strava = installFakeStravaFetch({ athleteActivities: [] });
    use({ strava_tokens: [{ ...TOKEN_ROW, sync_paused: true, paused_at: '2026-10-01T00:00:00Z' }] });
    const res = await server.request('POST', '/api/strava/sync', { token: token() });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ success: false, error: 'Sync is paused', code: 'sync_paused' });
  });

  it('answers 400 strava_sync_failed with a fixed text when the sync did not succeed, and nothing from Strava', async () => {
    strava = installFakeStravaFetch({ oauthToken: stravaTokenResponse(), athleteActivities: stravaError(500, { body: { message: 'Strava says activity 12345678901 lat 57.70887' } }) });
    use();
    const res = await server.request('POST', '/api/strava/sync', { token: token() });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'Failed to fetch Strava activities', code: 'strava_sync_failed' });
    expect(JSON.stringify(res.body)).not.toMatch(/12345678901|57\.70887/);
  });

  it('answers 400 strava_not_connected for a user without a connection', async () => {
    strava = installFakeStravaFetch({});
    use({ strava_tokens: [] });
    const res = await server.request('POST', '/api/strava/sync', { token: token() });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'User not connected to Strava', code: 'strava_not_connected' });
  });

  it('answers 503 strava_unavailable when a token cannot be read', async () => {
    strava = installFakeStravaFetch({});
    use({ strava_tokens: [{ ...TOKEN_ROW, access_token: 'enc:v1:test-1:AAAA' }] });
    const res = await server.request('POST', '/api/strava/sync', { token: token() });
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ success: false, error: 'Strava is temporarily unavailable', code: 'strava_unavailable' });
  });
});

describe('GET /api/strava/sync-all and POST /api/strava/backfill-extended', () => {
  it('answers the counters at the top level (old client) and in data (new client) for sync-all', async () => {
    strava = installFakeStravaFetch({ oauthToken: stravaTokenResponse(), athleteActivities: [] });
    use();
    const res = await server.request('GET', '/api/strava/sync-all', { token: token() });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body).toMatchObject({ syncedUsers: 1, totalUsers: 1, totalNewRuns: 0 });
    expect(res.body.data).toEqual({ syncedUsers: res.body.syncedUsers, totalUsers: res.body.totalUsers, totalNewRuns: res.body.totalNewRuns, results: res.body.results });
    expect(res.body).not.toHaveProperty('unavailable');
  });

  it('answers 503 strava_unavailable for sync-all when the token key is missing', async () => {
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', '');
    strava = installFakeStravaFetch({});
    use();
    const res = await server.request('GET', '/api/strava/sync-all', { token: token() });
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ success: false, error: 'Strava is temporarily unavailable', code: 'strava_unavailable' });
  });

  it('answers admin_required for a non-admin', async () => {
    strava = installFakeStravaFetch({});
    use({ users: [{ id: 'user-1', is_admin: false, group_id: 'group-1' }] });
    const res = await server.request('GET', '/api/strava/sync-all', { token: token() });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ success: false, error: 'Admin access required', code: 'admin_required' });
  });

  it('answers the no-users backfill with message and updated at the top level and updated in data', async () => {
    strava = installFakeStravaFetch({});
    use({ strava_tokens: [] });
    const res = await server.request('POST', '/api/strava/backfill-extended', { token: token() });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'No connected users', updated: 0, data: { updated: 0 } });
  });

  it('answers the finished backfill with totalUpdated and summary at the top level and in data', async () => {
    strava = installFakeStravaFetch({ oauthToken: stravaTokenResponse() });
    use();
    const res = await server.request('POST', '/api/strava/backfill-extended', { token: token() });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.totalUpdated).toBe(0);
    expect(res.body.data).toEqual({ totalUpdated: res.body.totalUpdated, summary: res.body.summary });
  }, 15_000);
});
