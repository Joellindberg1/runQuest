/**
 * RUN-214: loggarna (Railway sparar dem) får aldrig innehålla e-postadresser,
 * hela req.user-objektet eller någon del av en OAuth-token.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { inspect } from 'node:util';
import { randomBytes } from 'node:crypto';

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

import { STRAVA_CONSENT_VERSION } from '@runquest/shared';
import { getSupabaseClient } from '../../config/database.js';
import app from '../../app.js';
import { createStravaRateBudget } from '../../services/stravaRateBudget.js';
import { reportTokenKeyAtStartup } from '../../services/tokenKeyStartup.js';
import { syncAllStravaUsers } from '../strava.js';
import { buildSecretAad, parseKeyRing, seal } from '../../utils/secretBox.js';
import { createFakeDb } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });

let spies: Array<ReturnType<typeof vi.spyOn>>;
beforeEach(() => {
  spies = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

/** Allt som loggades, som en enda sträng (objekt expanderas som console skulle visa dem). */
const logged = () => spies.flatMap((s) => s.mock.calls).map((args: unknown[]) => args.map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 6 }))).join(' ')).join('\n');
const loggedObjects = () => spies.flatMap((s) => s.mock.calls).flat().filter((a: unknown) => a !== null && typeof a === 'object');

function useDb(data: Parameters<typeof createFakeDb>[0], options?: Parameters<typeof createFakeDb>[1]) {
  const db = createFakeDb(data, options);
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return db;
}

describe('auth routes', () => {
  const adminToken = () => mintToken({ user_id: 'admin-1' }); // bär e-posten test@example.com

  it('auth routes never log email or the full user object', async () => {
    useDb({ users: [{ id: 'admin-1', is_admin: true }] });

    const list = await server.request('GET', '/api/auth/users', { token: adminToken() });
    expect(list.status).toBe(200);

    const create = await server.request('POST', '/api/auth/users', {
      token: adminToken(), body: { name: 'Newbie', email: 'new.person@example.com', password: 'hunter22' },
    });
    expect(create.status).toBe(200);

    const login = await server.request('POST', '/api/auth/login', { body: { email: 'login.person@example.com', password: 'pw' } });
    expect(login.status).toBe(401);

    const out = logged();
    expect(out).not.toContain('test@example.com');
    expect(out).not.toContain('new.person@example.com');
    expect(out).not.toContain('login.person@example.com');
    expect(loggedObjects().some((o: any) => 'user_id' in o || 'group_id' in o)).toBe(false);
  });
});

describe('waitlist routes', () => {
  const addresses = ['new.signup@waitlist-private.test', 'rejected.honeypot@waitlist-private.test', 'too.fast@waitlist-private.test', 'stored.earlier@waitlist-private.test', 'broken.db@waitlist-private.test'];

  it('waitlist never logs the email address', async () => {
    // Alla vägar genom routen: ny, dubblett, honeypot, tidsfälla, ogiltig, 429 och databasfel, plus adminlistan som visar adressen.
    const data = { users: [{ id: 'admin-1', is_admin: true }], waitlist_signups: [{ id: 'w-1', email: 'stored.earlier@waitlist-private.test', created_at: '2026-10-01T08:00:00.000Z', source: 'landing', consent_version: 'draft' }] };
    useDb(data);
    let n = 0;
    const send = (body: unknown, headers: Record<string, string> = { 'x-forwarded-for': `198.51.100.${++n}` }) => server.request('POST', '/api/waitlist', { body, headers });

    expect((await send({ email: addresses[0], consent: true })).status).toBe(200);
    expect((await send({ email: addresses[0].toUpperCase(), consent: true })).status).toBe(200); // dubblett
    expect((await send({ email: addresses[1], consent: true, website: 'spam' })).status).toBe(200);
    expect((await send({ email: addresses[2], consent: true, elapsedMs: 10 })).status).toBe(200);
    expect((await send({ email: 'not-valid@@waitlist-private.test', consent: true })).status).toBe(400);
    const burst = { 'x-forwarded-for': '198.51.100.200' };
    for (let i = 0; i < 5; i++) expect((await send({ email: addresses[3], consent: true }, burst)).status).toBe(200);
    expect((await send({ email: addresses[3], consent: true }, burst)).status).toBe(429); // sjätte inom fönstret

    useDb({ ...data, waitlist_signups: [] }, { errors: { waitlist_signups: { message: `duplicate key (email)=(${addresses[4]})` } } });
    expect((await send({ email: addresses[4], consent: true }, { 'x-forwarded-for': '198.51.100.78' })).status).toBe(500);

    useDb(data);
    const list = await server.request('GET', '/api/admin/waitlist', { token: mintToken({ user_id: 'admin-1' }) });
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).toContain('stored.earlier@waitlist-private.test'); // sanity: adressen fanns i svaret

    const out = logged().toLowerCase();
    expect(out).not.toContain('waitlist-private.test');
    for (const address of addresses) expect(out).not.toContain(address.split('@')[0]);
    expect(loggedObjects().some((o: any) => 'email' in o || 'body' in o)).toBe(false);
  });
});

describe('strava routes', () => {
  it('strava routes never log any part of a token', async () => {
    const access = 'ACCESSTOKENVALUE0123456789';
    const refresh = 'REFRESHTOKENVALUE9876543210';
    useDb({ strava_tokens: [] });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: access, refresh_token: refresh, expires_at: 1900000000, athlete: { id: 7 } }),
    }));

    const res = await server.request('POST', '/api/strava/callback', { token: mintToken(), body: { code: 'oauth-code', consent_version: STRAVA_CONSENT_VERSION } });
    expect(res.status).toBe(200);

    const out = logged();
    expect(out).not.toContain(access.slice(0, 5));
    expect(out).not.toContain(refresh.slice(0, 5));
    expect(out).not.toContain('oauth-code');
  });

  it('strava token storage never logs a token, an enc:v1 value or any part of the key, on every path that touches them', async () => {
    const keyBase64 = randomBytes(32).toString('base64');
    const keyEntry = `log-1:${keyBase64}`;
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', keyEntry);
    const ring = parseKeyRing({ TOKEN_ENCRYPTION_KEY: keyEntry });
    const sealFor = (column: 'access_token' | 'refresh_token', plain: string) =>
      seal(plain, buildSecretAad({ table: 'strava_tokens', column, userId: 'user-1' }), ring);
    const connected = { access: 'CONNECTEDACCESS0123456789', refresh: 'CONNECTEDREFRESH9876543210' };
    const renewed = { access: 'RENEWEDACCESS0123456789', refresh: 'RENEWEDREFRESH9876543210' };
    const stored = { access: 'STOREDACCESS0123456789', refresh: 'STOREDREFRESH9876543210' };
    const tokenAnswer = (tokens: { access: string; refresh: string }) => ({
      ok: true,
      status: 200,
      json: async () => ({ access_token: tokens.access, refresh_token: tokens.refresh, expires_at: 1900000000, athlete: { id: 7 } }),
    });
    const tables = { strava_tokens: [] as Array<Record<string, unknown>>, runs: [], users: [] };
    useDb(tables);
    const fetchStub = vi.fn().mockResolvedValueOnce(tokenAnswer(connected)).mockResolvedValueOnce(tokenAnswer(renewed));
    vi.stubGlobal('fetch', fetchStub);
    const user = () => mintToken({ user_id: 'user-1' });
    const status = () => server.request('GET', '/api/strava/status', { token: user() });

    // 1. The callback saves sealed tokens.
    expect((await server.request('POST', '/api/strava/callback', { token: user(), body: { code: 'oauth-code', consent_version: STRAVA_CONSENT_VERSION } })).status).toBe(200);
    // 2. A refresh of an expired row saves the renewed ones.
    tables.strava_tokens[0] = { ...tables.strava_tokens[0], access_token: sealFor('access_token', stored.access), refresh_token: sealFor('refresh_token', stored.refresh), expires_at: 1 };
    expect((await status()).status).toBe(200);
    expect(fetchStub).toHaveBeenCalledTimes(2);
    // 3. A damaged stored value, 4. a value moved from another column, 5. a missing key.
    tables.strava_tokens[0] = { ...tables.strava_tokens[0], expires_at: 1, refresh_token: 'enc:v1:log-1:DAMAGEDCHUNK' };
    expect((await status()).status).toBe(503);
    tables.strava_tokens[0] = { ...tables.strava_tokens[0], expires_at: 1, refresh_token: sealFor('access_token', stored.refresh) };
    expect((await status()).status).toBe(503);
    tables.strava_tokens[0] = { ...tables.strava_tokens[0], expires_at: 9999999999, access_token: sealFor('access_token', stored.access) };
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', '');
    expect((await status()).status).toBe(503);
    expect((await server.request('POST', '/api/strava/callback', { token: user(), body: { code: 'oauth-code', consent_version: STRAVA_CONSENT_VERSION } })).status).toBe(503);

    const out = logged();
    for (const secret of [...Object.values(connected), ...Object.values(renewed), ...Object.values(stored), 'DAMAGEDCHUNK', keyBase64, keyBase64.slice(0, 10), 'oauth-code']) {
      expect(out, secret).not.toContain(secret);
    }
    expect(out).not.toContain('enc:v1');
    expect(out).not.toContain('KRITISKT'); // an unreadable token is an error line with a code, not the startup alarm
    // What is logged for the failures: the user, the code and the column.
    expect(out).toMatch(/Strava token unreadable for user user-1 \(bad_format, refresh_token\)/);
    expect(out).toMatch(/Strava token unreadable for user user-1 \(auth_failed, refresh_token\)/);
    expect(out).toMatch(/Strava token unreadable for user user-1 \(key_missing\)/);
  });
});

describe('token key configuration', () => {
  it('never logs a token, a stored value or any part of a key at startup without a key, with an invalid key, with a refused key id, in skipped runs and through the health endpoint', async () => {
    const goodKey = randomBytes(32).toString('base64');
    const testKey = randomBytes(32).toString('base64');
    const retiredKey = randomBytes(32).toString('base64');
    const invalidValues = [`prod-1:${goodKey.slice(0, 20)}`, `prod-1:${goodKey}:extra`, `NOKIDJUSTAVALUE${goodKey}`];
    const stored = { access: 'STOREDACCESS0123456789', refresh: 'STOREDREFRESH9876543210' };
    const sealingRing = parseKeyRing({ TOKEN_ENCRYPTION_KEY: `prod-1:${goodKey}` });
    const sealed = {
      user_id: 'user-secret-uuid-1',
      access_token: seal(stored.access, buildSecretAad({ table: 'strava_tokens', column: 'access_token', userId: 'user-secret-uuid-1' }), sealingRing),
      refresh_token: seal(stored.refresh, buildSecretAad({ table: 'strava_tokens', column: 'refresh_token', userId: 'user-secret-uuid-1' }), sealingRing),
      expires_at: 9999999999,
      sync_paused: false,
      users: { name: 'x' },
    };
    useDb({ users: [{ id: 'admin-1', is_admin: true }], strava_tokens: [sealed], strava_webhook_events: [] });
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SENTRY_ENVIRONMENT', '');
    vi.stubEnv('TOKEN_ENCRYPTION_KEYS_RETIRED', '');
    const startWith = (active: string, retired = '') => {
      vi.stubEnv('TOKEN_ENCRYPTION_KEY', active);
      vi.stubEnv('TOKEN_ENCRYPTION_KEYS_RETIRED', retired);
      reportTokenKeyAtStartup();
    };

    // 1. No key. 2. Invalid keys. 3. A key id the environment refuses, active and retired. 4. A working key.
    startWith('');
    for (const value of invalidValues) startWith(value);
    startWith(`test-1:${testKey}`);
    startWith(`prod-2:${goodKey}`, `test-1:${testKey}`);
    startWith(`prod-1:${goodKey}`, `prod-0:${retiredKey}`);
    // 5. The runs that are skipped for want of a key, 6. the health endpoint with a key, without one and with a refused one.
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', '');
    expect((await syncAllStravaUsers()).unavailable).toBe(true);
    const health = async () => (await server.request('GET', '/api/strava/webhook/health', { token: mintToken({ user_id: 'admin-1' }) })).body;
    const bodies = [await health()];
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', `prod-1:${goodKey}`);
    bodies.push(await health());
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', `test-1:${testKey}`);
    bodies.push(await health());

    const out = `${logged()}\n${JSON.stringify(bodies)}`;
    const secrets = [goodKey, testKey, retiredKey, ...invalidValues, stored.access, stored.refresh, sealed.access_token, sealed.refresh_token, 'user-secret-uuid-1'];
    for (const secret of secrets) {
      expect(out, secret).not.toContain(secret);
      expect(out, `start of ${secret}`).not.toContain(secret.slice(0, 12));
    }
    expect(out).not.toContain('enc:v1');
    // Sanity: what is meant to be there is there (the alarms name the problem and the key ids, and the health names the key ids).
    expect(out).toContain('KRITISKT');
    expect(out).toContain('test-1');
    expect(bodies[1].data.token_encryption).toMatchObject({ configured: true, active_kid: 'prod-1', encrypted_rows: 1 });
  });
});

describe('strava rate budget', () => {
  it('the rate budget logs only the error code when it cannot read a response', () => {
    const leak = 'headers broke for REFRESHTOKENVALUE9876543210 and activity 987654321';
    const unreadable = { status: 200, headers: { get: () => { throw Object.assign(new Error(leak), { code: 'H0001', stack: `stack with ${leak}` }); } } } as unknown as Response;

    expect(() => createStravaRateBudget().recordResponse('https://www.strava.com/api/v3/athlete/activities', unreadable)).not.toThrow();

    const out = logged();
    expect(out).toContain('H0001');
    expect(out).not.toContain('REFRESHTOKENVALUE');
    expect(out).not.toContain('987654321');
    expect(loggedObjects().some((o: any) => o instanceof Error)).toBe(false);
  });
});

describe('strava webhook routes', () => {
  const verifyToken = 'WEBHOOKVERIFYTOKEN0123456789abcdef';
  const title = 'Sunrise intervals at Hemliga sjon';
  const bodyMarker = 'BODYMARKER-5f3a9c';

  afterEach(() => { delete process.env.STRAVA_WEBHOOK_VERIFY_TOKEN; delete process.env.STRAVA_WEBHOOK_SUBSCRIPTION_ID; });

  it('no log line contains the verify token, an activity title or the request body', async () => {
    process.env.STRAVA_WEBHOOK_VERIFY_TOKEN = verifyToken;
    process.env.STRAVA_WEBHOOK_SUBSCRIPTION_ID = '4242';
    const event = (over: Record<string, unknown> = {}) => ({
      object_type: 'activity', object_id: 9001, aspect_type: 'update', owner_id: 777, subscription_id: 4242, event_time: 1_760_000_000,
      updates: { title, private: 'true' }, marker: bodyMarker, ...over,
    });
    const send = (body: unknown) => server.request('POST', '/api/strava/webhook', { body });
    const tokens = [{ user_id: 'user-777', strava_athlete_id: 777 }];

    // verifiering: rätt token och fel token
    useDb({ strava_tokens: tokens, strava_webhook_events: [] });
    const verify = (token: string) => server.request('GET', `/api/strava/webhook?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=abc`);
    expect((await verify(verifyToken)).status).toBe(200);
    expect((await verify(`${verifyToken}WRONG`)).status).toBe(403);

    // alla vägar genom POST: lagrad, dubblett, fel prenumeration, fel form, okänd typ, okänd ägare, för stor, kön full, databasfel
    expect((await send(event())).status).toBe(200);
    expect((await send(event())).status).toBe(200);
    expect((await send(event({ subscription_id: 1 }))).status).toBe(403);
    expect((await send(event({ object_id: 'not-a-number' }))).status).toBe(400);
    expect((await send(event({ aspect_type: 'archive' }))).status).toBe(200);
    expect((await send(event({ owner_id: 31337 }))).status).toBe(200);
    expect((await send(event({ filler: 'x'.repeat(11 * 1024) }))).status).toBe(413);

    useDb({ strava_tokens: tokens, strava_webhook_events: Array.from({ length: 200 }, (_, n) => ({ dedupe_key: `k${n}`, owner_id: 777, status: 'pending' })) });
    expect((await send(event({ object_id: 9002 }))).status).toBe(200);

    useDb({ strava_tokens: tokens, strava_webhook_events: [] }, { failWhen: (q) => (q.mutation === 'upsert' ? { message: `insert failed for ${title} ${bodyMarker}` } : null) });
    expect((await send(event({ object_id: 9003 }))).status).toBe(500);
    useDb({ strava_tokens: tokens }, { errors: { strava_tokens: { message: `lookup failed ${bodyMarker}` } } });
    expect((await send(event({ object_id: 9004 }))).status).toBe(500);

    // prenumerations-id:t inte satt: händelsen släpps med en varning
    delete process.env.STRAVA_WEBHOOK_SUBSCRIPTION_ID;
    expect((await send(event())).status).toBe(200);

    const out = logged();
    expect(out).not.toContain(verifyToken);
    expect(out).not.toContain('WEBHOOKVERIFYTOKEN');
    expect(out).not.toContain(title);
    expect(out).not.toContain('Hemliga');
    expect(out).not.toContain(bodyMarker);
    expect(out).toContain('31337'); // sanity: det som får loggas (ägarens id) loggas
    expect(loggedObjects().some((o: any) => 'body' in o || 'updates' in o || 'title' in o)).toBe(false);
  });
});
