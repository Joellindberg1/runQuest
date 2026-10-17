/**
 * RUN-214: loggarna (Railway sparar dem) får aldrig innehålla e-postadresser,
 * hela req.user-objektet eller någon del av en OAuth-token.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { inspect } from 'node:util';

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
import { createFakeDb } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });

let spies: Array<ReturnType<typeof vi.spyOn>>;
beforeEach(() => {
  spies = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

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
