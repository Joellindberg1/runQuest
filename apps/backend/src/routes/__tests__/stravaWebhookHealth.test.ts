/**
 * Hälsoendpointen GET /api/strava/webhook/health (ADR 010 beslut 11): räknare och tidsstämplar för webhook-kön, bara för admin.
 * Allt går genom hela appen (createApp), så testet bevisar också monteringen: routern ligger före den globala JSON-parsern och
 * före /api/strava-routern, och `/health` är den enda rutten på den med JWT. GET-verifieringen och POST-händelserna är publika.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { randomBytes } from 'node:crypto';
import { getSupabaseClient } from '../../config/database.js';
import { createApp } from '../../app.js';
import { sealStravaToken } from '../../services/stravaTokenStore.js';
import { legacyToken } from '../../test-utils/stravaTokens.js';
import { parseKeyRing } from '../../utils/secretBox.js';
import { STRAVA_WEBHOOK_PATH } from '../../services/stravaWebhook/constants.js';
import { logger } from '../../utils/logger.js';
import { createFakeDb, type FakeDbOptions, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

const HEALTH = `${STRAVA_WEBHOOK_PATH}/health`;
const EVENTS = 'strava_webhook_events';
const VERIFY_TOKEN = 'verify-token-for-tests-0123456789abcdef';
const NOW = Date.parse('2026-10-15T12:00:00.000Z');
const ago = (seconds: number): string => new Date(NOW - seconds * 1000).toISOString();

const event = (status: string, over: Row = {}): Row => ({
  id: Math.floor(Math.random() * 1e9),
  status,
  owner_id: 111,
  object_id: 222,
  user_id: 'user-1',
  received_at: ago(10),
  processed_at: null,
  last_error: null,
  ...over,
});

const ADMIN = { id: 'admin-1', is_admin: true };
const MEMBER = { id: 'member-1', is_admin: false };

function useDb(extra: Record<string, Row[]> = {}, options: FakeDbOptions = {}) {
  const tables: Record<string, Row[]> = { users: [ADMIN, MEMBER], [EVENTS]: [], strava_tokens: [], ...extra };
  const db = createFakeDb(tables, options);
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return { ...db, tables };
}

let servers: TestServer[] = [];
async function serve(): Promise<TestServer> {
  const server = await startServer(createApp());
  servers.push(server);
  return server;
}
const adminToken = () => mintToken({ user_id: ADMIN.id });

let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  process.env.STRAVA_WEBHOOK_VERIFY_TOKEN = VERIFY_TOKEN;
  process.env.STRAVA_WEBHOOK_SUBSCRIPTION_ID = '4242';
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  errorLog = vi.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  delete process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;
  delete process.env.STRAVA_WEBHOOK_SUBSCRIPTION_ID;
  await Promise.all(servers.map((s) => s.close()));
  servers = [];
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.mocked(getSupabaseClient).mockReset();
});

describe('GET /api/strava/webhook/health', () => {
  it('health returns the counts of pending, processing and dead events', async () => {
    useDb({
      [EVENTS]: [
        event('pending'), event('pending'), event('pending'),
        event('processing'), event('processing'),
        event('dead'),
        event('done'), event('done'), event('done'), event('done'),
      ],
    });
    const res = await (await serve()).request('GET', HEALTH, { token: adminToken() });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ pending: 3, processing: 2, dead: 1 });
    expect(res.body.data).not.toHaveProperty('done');
  });

  it('health returns the age of the oldest pending event and the last processed time', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const { queries } = useDb({
      [EVENTS]: [
        event('pending', { received_at: ago(30) }),
        event('pending', { received_at: ago(90.9) }), // oldest pending: 90 whole seconds
        event('done', { received_at: ago(86_400), processed_at: ago(3_600) }), // older, but not pending
        event('processing', { received_at: ago(7_200) }), // older than any pending one, but being worked on: not counted in the age
        event('dead', { received_at: ago(200_000), processed_at: ago(120) }), // the newest processed_at, although it ended dead
        event('done', { received_at: ago(5_000), processed_at: ago(600) }),
      ],
    });
    const res = await (await serve()).request('GET', HEALTH, { token: adminToken() });
    expect(res.status).toBe(200);
    expect(res.body.data.oldest_pending_age_seconds).toBe(90);
    expect(res.body.data.last_processed_at).toBe(ago(120));
    // Postgres puts null first in a descending order, so rows without a processed_at must be filtered out; the fake sorts nulls
    // arbitrarily and cannot prove that by data alone.
    const lastQuery = queries.find((q) => q.table === EVENTS && q.select === 'processed_at');
    expect(lastQuery?.filters).toContainEqual({ op: 'not.is', column: 'processed_at', value: null });
  });

  it('health gives the last processed time as an ISO string with milliseconds and Z', async () => {
    // PostgREST returns timestamptz as "+00:00" with microseconds.
    useDb({ [EVENTS]: [event('done', { processed_at: '2026-10-15T11:58:00.123456+00:00' })] });
    const res = await (await serve()).request('GET', HEALTH, { token: adminToken() });
    expect(res.body.data.last_processed_at).toBe('2026-10-15T11:58:00.123Z');
  });

  it('health counts an event received ahead of the clock as age 0', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    useDb({ [EVENTS]: [event('pending', { received_at: ago(-45) })] });
    const res = await (await serve()).request('GET', HEALTH, { token: adminToken() });
    expect(res.body.data.oldest_pending_age_seconds).toBe(0);
  });

  it('health gives null for the age and the last processed time when there is nothing to report', async () => {
    useDb({ [EVENTS]: [event('processing'), event('pending', { received_at: ago(5) })] });
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const res = await (await serve()).request('GET', HEALTH, { token: adminToken() });
    expect(res.body.data.last_processed_at).toBeNull(); // nothing has a processed_at (a null must not win the ordering)
    useDb({ [EVENTS]: [event('done', { processed_at: ago(1) })] });
    const none = await (await serve()).request('GET', HEALTH, { token: adminToken() });
    expect(none.body.data.oldest_pending_age_seconds).toBeNull();
  });

  it('health reports subscription_configured from the environment variable', async () => {
    useDb();
    const server = await serve();
    const configured = async (value: string | undefined): Promise<unknown> => {
      if (value === undefined) delete process.env.STRAVA_WEBHOOK_SUBSCRIPTION_ID;
      else process.env.STRAVA_WEBHOOK_SUBSCRIPTION_ID = value;
      return (await server.request('GET', HEALTH, { token: adminToken() })).body.data.subscription_configured;
    };
    expect(await configured('4242')).toBe(true);
    expect(await configured(undefined)).toBe(false);
    for (const invalid of ['', 'abc', '0', '-5', '12.5', '4242abc']) expect(await configured(invalid)).toBe(false);
  });

  it('health counts unmapped tokens and paused users', async () => {
    const { queries } = useDb({
      strava_tokens: [
        { user_id: 'a', strava_athlete_id: 1, sync_paused: false },
        { user_id: 'b', strava_athlete_id: 2, sync_paused: true },
        { user_id: 'c', strava_athlete_id: null, sync_paused: false },
        { user_id: 'd', strava_athlete_id: null, sync_paused: true },
        { user_id: 'e', sync_paused: false },
      ],
    });
    const res = await (await serve()).request('GET', HEALTH, { token: adminToken() });
    expect(res.body.data).toMatchObject({ unmapped_tokens: 3, paused_users: 2 });
    // strava_tokens has no id column (its key is user_id), so a count selecting `id` would be a 400 from PostgREST in production.
    // (The token_encryption block reads the token columns too, through the token store; its query is not one of these two.)
    const countSelects = queries.filter((q) => q.table === 'strava_tokens' && !q.select?.includes('access_token')).map((q) => q.select);
    expect(countSelects).toHaveLength(2);
    expect(countSelects.every((s) => s === 'user_id')).toBe(true);
  });

  it('health requires an authenticated admin', async () => {
    useDb({ [EVENTS]: [event('pending')] });
    const server = await serve();
    expect((await server.request('GET', HEALTH)).status).toBe(401);
    expect((await server.request('GET', HEALTH, { token: 'not-a-jwt' })).status).toBe(401);
    const member = await server.request('GET', HEALTH, { token: mintToken({ user_id: MEMBER.id }) });
    expect(member.status).toBe(403);
    expect(member.body).not.toHaveProperty('data');
    const admin = await server.request('GET', HEALTH, { token: adminToken() });
    expect(admin.status).toBe(200);
  });

  it('health response follows the success and data shape', async () => {
    useDb({ [EVENTS]: [event('pending', { received_at: ago(61) })] });
    const res = await (await serve()).request('GET', HEALTH, { token: adminToken() });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Object.keys(res.body).sort()).toEqual(['data', 'success']);
    expect(Object.keys(res.body.data).sort()).toEqual([
      'dead', 'last_processed_at', 'oldest_pending_age_seconds', 'paused_users', 'pending', 'processing', 'subscription_configured', 'token_encryption', 'unmapped_tokens',
    ]);
    expect(Object.keys(res.body.data.token_encryption).sort()).toEqual([
      'active_kid', 'config_error', 'configured', 'encrypted_rows', 'plaintext_rows', 'retired_kids', 'rows_on_other_kid', 'unreadable_since_start', 'unrecognised_rows',
    ]);
    expect(typeof res.body.data.subscription_configured).toBe('boolean');
    for (const key of ['pending', 'processing', 'dead', 'unmapped_tokens', 'paused_users']) expect(Number.isInteger(res.body.data[key])).toBe(true);
    expect(Number.isInteger(res.body.data.oldest_pending_age_seconds)).toBe(true);
  });

  it('health exposes no athlete ids, activity ids or tokens', async () => {
    useDb({
      [EVENTS]: [
        event('pending', { owner_id: 918273645, object_id: 564738291, user_id: 'user-secret-uuid-5551', last_error: 'SECRET-ERROR-TEXT', dedupe_key: 'dedupe-secret-key' }),
        event('dead', { owner_id: 918273645, object_id: 564738291, user_id: 'user-secret-uuid-5551', last_error: 'SECRET-ERROR-TEXT', processed_at: ago(50) }),
      ],
      strava_tokens: [{ user_id: 'user-secret-uuid-5551', strava_athlete_id: 918273645, access_token: 'ACCESS-TOKEN-SECRET', refresh_token: 'REFRESH-TOKEN-SECRET', sync_paused: true }],
    });
    const res = await (await serve()).request('GET', HEALTH, { token: adminToken() });
    expect(res.status).toBe(200);
    const text = JSON.stringify(res.body);
    for (const secret of ['918273645', '564738291', 'user-secret-uuid-5551', 'SECRET-ERROR-TEXT', 'dedupe-secret-key', 'ACCESS-TOKEN-SECRET', 'REFRESH-TOKEN-SECRET']) {
      expect(text).not.toContain(secret);
    }
  });

  it('health fails with 500 and logs the code only when a read fails', async () => {
    useDb({ [EVENTS]: [event('pending')] }, { failWhen: (q) => (q.table === EVENTS && q.filters.some((f) => f.value === 'dead') ? { message: 'boom with owner_id 918273645', code: 'XX001' } as any : null) });
    const res = await (await serve()).request('GET', HEALTH, { token: adminToken() });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to read webhook health' });
    const logged = errorLog.mock.calls.flat().map(String).join(' ');
    expect(logged).toContain('XX001');
    expect(logged).not.toContain('918273645');
  });

  it('health logs the network cause, not "unknown", when the connection broke (supabase-js gives code "")', async () => {
    const networkError = { message: 'TypeError: fetch failed', details: 'Caused by: Error: read ECONNRESET (ECONNRESET)', hint: '', code: '' };
    useDb({ [EVENTS]: [event('pending')] }, { failWhen: (q) => (q.table === EVENTS ? networkError as any : null) });
    const res = await (await serve()).request('GET', HEALTH, { token: adminToken() });
    expect(res.status).toBe(500);
    const logged = errorLog.mock.calls.flat().map(String).join(' ');
    expect(logged).toContain('ECONNRESET');
    expect(logged).not.toContain('unknown');
  });

  it('health fails with 500 and logs the code only when a timestamp read fails', async () => {
    const server = await serve();
    for (const column of ['received_at', 'processed_at']) {
      errorLog.mockClear();
      useDb({ [EVENTS]: [event('pending')] }, { failWhen: (q) => (q.select === column ? ({ message: 'boom owner_id 918273645', code: 'XX002' } as any) : null) });
      const res = await server.request('GET', HEALTH, { token: adminToken() });
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ success: false, error: 'Failed to read webhook health' });
      const logged = errorLog.mock.calls.flat().map(String).join(' ');
      expect(logged).toContain('XX002');
      expect(logged).not.toContain('918273645');
    }
  });

  it('health answers a thrown database error with the fixed message and a log without its text', async () => {
    useDb({}, { failWhen: (q) => { if (q.table === EVENTS) throw new Error('db exploded for owner 918273645'); return null; } });
    const res = await (await serve()).request('GET', HEALTH, { token: adminToken() });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to read webhook health' });
    expect(errorLog.mock.calls.flat().map(String).join(' ')).not.toContain('918273645');
  });

  it('health fails with 500 when the connection table cannot be read', async () => {
    useDb({}, { failWhen: (q) => (q.table === 'strava_tokens' ? { message: 'down' } : null) });
    const res = await (await serve()).request('GET', HEALTH, { token: adminToken() });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to read webhook health' });
  });
});

describe('GET /api/strava/webhook/health, the token_encryption block', () => {
  const newKey = () => randomBytes(32).toString('base64');
  const sealedRow = (userId: string, ring: ReturnType<typeof parseKeyRing>): Row => ({
    user_id: userId,
    access_token: sealStravaToken(userId, 'access_token', 'SEALED-ACCESS-VALUE-0123456789', ring),
    refresh_token: sealStravaToken(userId, 'refresh_token', 'SEALED-REFRESH-VALUE-0123456789', ring),
  });

  it('health reports the key ids and the rows by form, from the store', async () => {
    const active = `prod-2:${newKey()}`;
    const retired = `prod-1:${newKey()}`;
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', active);
    vi.stubEnv('TOKEN_ENCRYPTION_KEYS_RETIRED', retired);
    const onActive = parseKeyRing({ TOKEN_ENCRYPTION_KEY: active });
    const onRetired = parseKeyRing({ TOKEN_ENCRYPTION_KEY: retired });
    useDb({
      strava_tokens: [
        sealedRow('u1', onActive),
        sealedRow('u2', onRetired),
        { user_id: 'u3', access_token: legacyToken('legacy-a'), refresh_token: legacyToken('legacy-r') },
        { user_id: 'u4', access_token: 'enc:v1:prod-2:broken', refresh_token: null },
      ],
    });

    const res = await (await serve()).request('GET', HEALTH, { token: adminToken() });

    expect(res.status).toBe(200);
    expect(res.body.data.token_encryption).toEqual({
      configured: true,
      config_error: null,
      active_kid: 'prod-2',
      retired_kids: ['prod-1'],
      encrypted_rows: 2,
      plaintext_rows: 1,
      unrecognised_rows: 1,
      rows_on_other_kid: 1,
      unreadable_since_start: 0,
    });
  });

  it('health says so when there is no key, and the rest of the health is still there', async () => {
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', '');
    useDb({ [EVENTS]: [event('pending'), event('dead')], strava_tokens: [{ user_id: 'u3', access_token: legacyToken('legacy-a'), refresh_token: legacyToken('legacy-r') }] });

    const res = await (await serve()).request('GET', HEALTH, { token: adminToken() });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ pending: 1, dead: 1 });
    expect(res.body.data.token_encryption).toMatchObject({
      configured: false, config_error: 'key_missing', active_kid: null, retired_kids: [], plaintext_rows: 1, rows_on_other_kid: null,
    });
  });

  it('health shows no token, ciphertext, key or user id, and logs nothing of them', async () => {
    const active = `prod-1:${newKey()}`;
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', active);
    const ring = parseKeyRing({ TOKEN_ENCRYPTION_KEY: active });
    const rows = [sealedRow('user-secret-uuid-1', ring), { user_id: 'user-secret-uuid-2', access_token: legacyToken('legacy-a'), refresh_token: legacyToken('legacy-r') }];
    useDb({ strava_tokens: rows });

    const res = await (await serve()).request('GET', HEALTH, { token: adminToken() });

    expect(res.status).toBe(200);
    const text = JSON.stringify(res.body);
    const logged = [errorLog, vi.mocked(logger.warn), vi.mocked(logger.info)].flatMap((spy) => spy.mock.calls.flat().map(String)).join('\n');
    for (const secret of [active.split(':')[1], rows[0].access_token as string, rows[0].refresh_token as string, 'SEALED-ACCESS', 'SEALED-REFRESH', legacyToken('legacy-a'), 'user-secret-uuid', 'enc:v1']) {
      expect(text, secret).not.toContain(secret);
      expect(logged, secret).not.toContain(secret);
    }
  });

  it('health fails with 500 and logs the code only when the token rows cannot be read', async () => {
    useDb({}, { failWhen: (q) => (q.table === 'strava_tokens' && q.select?.includes('access_token') ? ({ message: 'boom for LEAKED-ROW-VALUE', code: 'XX003' } as any) : null) });

    const res = await (await serve()).request('GET', HEALTH, { token: adminToken() });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to read webhook health' });
    const logged = errorLog.mock.calls.flat().map(String).join(' ');
    expect(logged).toContain('XX003');
    expect(logged).not.toContain('LEAKED-ROW-VALUE');
  });

  it('health is as protected as before: no token, no admin, no block', async () => {
    useDb();
    const server = await serve();

    expect((await server.request('GET', HEALTH)).status).toBe(401);
    const member = await server.request('GET', HEALTH, { token: mintToken({ user_id: MEMBER.id }) });
    expect(member.status).toBe(403);
    expect(JSON.stringify(member.body)).not.toContain('token_encryption');
  });
});

describe('the webhook routes next to health', () => {
  it('health is a GET route only', async () => {
    useDb({ [EVENTS]: [event('pending')] });
    const server = await serve();
    // HEAD is answered by the GET handler in Express, so it must be behind the same auth.
    expect((await server.request('HEAD', HEALTH)).status).toBe(401);
    for (const method of ['POST', 'PUT']) {
      const res = await server.request(method, HEALTH, { token: adminToken(), body: {} });
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain('"data"');
    }
  });

  it('the verification and the event route stay public', async () => {
    const { tables } = useDb({ strava_tokens: [{ user_id: 'user-777', strava_athlete_id: 777 }] });
    const server = await serve();
    const query = new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': 'challenge-abc123' });
    const verified = await server.request('GET', `${STRAVA_WEBHOOK_PATH}?${query.toString()}`);
    expect(verified.status).toBe(200);
    expect(verified.body).toEqual({ 'hub.challenge': 'challenge-abc123' });
    const wrong = await server.request('GET', `${STRAVA_WEBHOOK_PATH}?${new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': 'c' })}`);
    expect(wrong.status).toBe(403);

    const posted = await server.request('POST', STRAVA_WEBHOOK_PATH, {
      body: { object_type: 'activity', object_id: 9001, aspect_type: 'create', owner_id: 777, subscription_id: 4242, event_time: 1_760_000_000, updates: {} },
    });
    expect(posted.status).toBe(200);
    expect(tables[EVENTS]).toHaveLength(1);
  });
});
