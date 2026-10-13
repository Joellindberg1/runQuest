/**
 * POST /api/waitlist (publik): validering, normalisering, ingen e-postuppräkning, honeypot, tidsfälla och rate limit.
 * Varje test använder en egen IP (x-forwarded-for; appen litar på en proxy) så att rate limitern inte smittar mellan test.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { WAITLIST_CONSENT_VERSION } from '@runquest/shared';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from '../../config/database.js';
import app from '../../app.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });

let tables: Record<string, Row[]>;
let ipCounter = 0;
beforeEach(() => {
  tables = { waitlist_signups: [] };
});

function useDb(options?: Parameters<typeof createFakeDb>[1]) {
  const db = createFakeDb(tables, options);
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return db;
}

// En ny IP per anrop om inget annat anges, så att 5-per-15-min-gränsen aldrig delas mellan anrop eller test.
const freshIp = () => { ipCounter++; return `10.1.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`; };
const post = (body: unknown, ip = freshIp()) =>
  server.request('POST', '/api/waitlist', { body, headers: { 'x-forwarded-for': ip } });
const stored = () => tables.waitlist_signups;

describe('POST /api/waitlist', () => {
  it('waitlist rejects invalid email with 400', async () => {
    useDb();
    const bad = ['', '   ', 'plainaddress', 'a@', '@b.se', 'a b@c.se', 'a@b', 'a@@b.se', 'a@b..', 'a@.se', `${'x'.repeat(250)}@b.se`];
    for (const email of bad) {
      const res = await post({ email, consent: true });
      expect(res.status, JSON.stringify(email)).toBe(400);
      expect(res.body).toEqual({ error: expect.any(String) });
    }
    for (const email of [undefined, null, 42, ['a@b.se'], { a: 1 }]) {
      const res = await post({ email, consent: true });
      expect(res.status, JSON.stringify(email)).toBe(400);
    }
    expect((await post(undefined)).status).toBe(400); // ingen body alls
    expect(stored()).toEqual([]);
  });

  it('waitlist requires the consent flag', async () => {
    useDb();
    for (const consent of [undefined, false, 'true', 1, null]) {
      const res = await post({ email: 'alice@example.com', consent });
      expect(res.status, String(consent)).toBe(400);
      expect(res.body).toEqual({ error: expect.any(String) });
    }
    expect(stored()).toEqual([]);
  });

  it('waitlist stores a normalized email once and returns the same response on duplicate', async () => {
    useDb();
    const first = await post({ email: '  Alice.Smith@Example.COM ', consent: true, elapsedMs: 5000 });
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ success: true });
    expect(stored()).toHaveLength(1);
    expect(stored()[0]).toMatchObject({ email: 'alice.smith@example.com', source: 'landing', consent_version: WAITLIST_CONSENT_VERSION });

    // Samma adress igen (annan skrivning, annan IP): identiskt svar, ingen andra rad — inget avslöjar att adressen fanns.
    const again = await post({ email: 'ALICE.SMITH@example.com', consent: true, elapsedMs: 5000 });
    expect(again.status).toBe(first.status);
    expect(again.body).toEqual(first.body);
    expect(stored()).toHaveLength(1);

    // En ny adress ger en andra rad och samma svar.
    const other = await post({ email: 'bob@example.com', consent: true });
    expect(other).toEqual(first);
    expect(stored().map((r) => r.email)).toEqual(['alice.smith@example.com', 'bob@example.com']);
  });

  it('waitlist is public: no token is needed and a stored row carries no IP or user data', async () => {
    useDb();
    const res = await post({ email: 'carol@example.com', consent: true });
    expect(res.status).toBe(200);
    expect(Object.keys(stored()[0]).sort()).toEqual(['consent_version', 'email', 'source']);
  });

  it('waitlist honeypot filled returns 200 without storing', async () => {
    useDb();
    const genuine = await post({ email: 'dave@example.com', consent: true });
    for (const website of ['http://spam.example', 'x', ' ']) {
      const res = await post({ email: 'bot@example.com', consent: true, website, elapsedMs: 9000 });
      expect(res.status).toBe(200);
      expect(res.body).toEqual(genuine.body);
    }
    // även när resten av formuläret är ogiltigt: boten får inte lära sig något av ett 400
    expect((await post({ email: 'not-an-email', website: 'x' })).status).toBe(200);
    expect(stored().map((r) => r.email)).toEqual(['dave@example.com']);
  });

  it('waitlist empty honeypot is stored normally', async () => {
    useDb();
    expect((await post({ email: 'erin@example.com', consent: true, website: '' })).status).toBe(200);
    expect(stored()).toHaveLength(1);
  });

  it('waitlist submitted too fast returns 200 without storing', async () => {
    useDb();
    const genuine = await post({ email: 'frank@example.com', consent: true, elapsedMs: 3000 });
    for (const elapsedMs of [0, 150, 1999, -5]) {
      const res = await post({ email: 'fast@example.com', consent: true, elapsedMs });
      expect(res.status, String(elapsedMs)).toBe(200);
      expect(res.body).toEqual(genuine.body);
    }
    expect(stored().map((r) => r.email)).toEqual(['frank@example.com']);
  });

  it('waitlist stores a signup when elapsedMs is 2000 or missing so that clients without scripts are not locked out', async () => {
    useDb();
    expect((await post({ email: 'gina@example.com', consent: true, elapsedMs: 2000 })).status).toBe(200);
    expect((await post({ email: 'hans@example.com', consent: true })).status).toBe(200);
    expect(stored().map((r) => r.email)).toEqual(['gina@example.com', 'hans@example.com']);
  });

  it('waitlist answers 429 after five attempts from the same IP and still counts other IPs separately', async () => {
    useDb();
    const ip = '10.9.9.9';
    for (let i = 1; i <= 5; i++) expect((await post({ email: `u${i}@example.com`, consent: true }, ip)).status, `försök ${i}`).toBe(200);
    const blocked = await post({ email: 'u6@example.com', consent: true }, ip);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: expect.any(String) });
    expect(stored()).toHaveLength(5);
    expect((await post({ email: 'u7@example.com', consent: true }, '10.9.9.10')).status).toBe(200);
  });

  it('waitlist rejects a body larger than 1 kB with 413', async () => {
    useDb();
    const res = await post({ email: 'big@example.com', consent: true, padding: 'x'.repeat(2000) });
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: expect.any(String) });
    expect(stored()).toEqual([]);
  });

  it('waitlist answers 500 without details when the database fails', async () => {
    useDb({ errors: { waitlist_signups: { message: 'Key (email)=(ivan@example.com) boom' } } });
    const res = await post({ email: 'ivan@example.com', consent: true });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: expect.any(String) });
    expect(JSON.stringify(res.body)).not.toContain('ivan@example.com');
  });

  it('waitlist answers 400 when the database rejects the address as not normalized', async () => {
    useDb({ errors: { waitlist_signups: { message: 'violates check constraint "waitlist_signups_email_normalized"', code: '23514' } as any } });
    const res = await post({ email: 'jan@example.com', consent: true });
    expect(res.status).toBe(400);
  });

  it('waitlist is mounted: an empty body gives the route\'s own 400, not the app 404', async () => {
    useDb();
    const res = await post({});
    expect(res.status).toBe(400);
    expect(res.body.error).not.toBe('Route not found');
  });

  it('waitlist lists itself in the /api info endpoint', async () => {
    const res = await server.request('GET', '/api');
    expect(JSON.stringify(res.body.endpoints)).toContain('/api/waitlist');
  });
});
