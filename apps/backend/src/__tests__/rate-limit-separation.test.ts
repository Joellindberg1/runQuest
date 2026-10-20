/**
 * T2: rate limiterna delar aldrig räknare. Dagens login-limiter ligger på en modulglobal karta nycklad på IP; väntelistan
 * får en egen karta via fabriken, så att ett flöde av väntelisteanmälningar från en IP inte låser inloggningen för samma IP
 * (och tvärtom). Login-limiterns eget beteende (20 försök / 15 min / IP) är oförändrat.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from '../config/database.js';
import { createApp } from '../app.js';
import { createRateLimiter, loginRateLimiter } from '../middleware/rateLimit.js';
import { createFakeDb } from '../routes/__tests__/helpers/fakeDb.js';
import { startServer, type TestServer } from '../routes/__tests__/helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(createApp()); });
afterAll(async () => { await server.close(); });

const tables: Record<string, any[]> = { waitlist_signups: [] };
beforeEach(() => {
  tables.waitlist_signups = [];
  vi.mocked(getSupabaseClient).mockReturnValue(createFakeDb(tables).client as any);
});

const asIp = (ip: string) => ({ 'x-forwarded-for': ip });
// Saknat lösenord ger 400 direkt i login-handlern: räknas av limitern utan att behöva databas eller hash.
const login = (ip: string) => server.request('POST', '/api/auth/login', { body: { email: 'someone@example.com' }, headers: asIp(ip) });
const join = (ip: string) =>
  server.request('POST', '/api/waitlist', { body: { email: 'someone@example.com', consent: true }, headers: asIp(ip) });

/** Kör en limiter direkt mot en låtsasförfrågan; ger statuskoden den svarade, eller null om den släppte igenom. */
function hit(limiter: ReturnType<typeof createRateLimiter>, ip: string): number | null {
  let status: number | null = null;
  const req = { ip, socket: { remoteAddress: ip } } as unknown as Request;
  const res = { status(code: number) { status = code; return this; }, json() { return this; } } as unknown as Response;
  limiter(req, res, (() => {}) as NextFunction);
  return status;
}

describe('login rate limit (oförändrat beteende)', () => {
  it('login allows 20 attempts per IP and answers 429 on the 21st', async () => {
    const ip = '203.0.113.10';
    for (let i = 1; i <= 20; i++) expect((await login(ip)).status, `försök ${i}`).toBe(400);
    const blocked = await login(ip);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ success: false, error: 'Too many attempts, try again later', code: 'rate_limited' });
    // en annan IP påverkas inte
    expect((await login('203.0.113.11')).status).toBe(400);
  });
});

describe('createRateLimiter', () => {
  it('each limiter from the factory counts on its own map', () => {
    const a = createRateLimiter(60_000, 2);
    const b = createRateLimiter(60_000, 2);
    expect([hit(a, '198.51.100.1'), hit(a, '198.51.100.1'), hit(a, '198.51.100.1')]).toEqual([null, null, 429]);
    expect(hit(b, '198.51.100.1')).toBeNull();
    // och inte heller med den delade kartan som login-limitern använder
    expect(hit(loginRateLimiter, '198.51.100.1')).toBeNull();
  });
});

describe('T2 rate limit separation', () => {
  it('waitlist rate limit does not affect login rate limit', async () => {
    // Väntelistan blockerar efter 5 anmälningar från samma IP …
    const ipA = '203.0.113.20';
    for (let i = 1; i <= 5; i++) expect((await join(ipA)).status, `anmälan ${i}`).toBe(200);
    expect((await join(ipA)).status).toBe(429);
    // … men inloggningen från samma IP är orörd: den har sin egen räknare och släpps igenom (400 = nådde handlern).
    expect((await login(ipA)).status).toBe(400);

    // Tvärtom: en IP vars login-kvot är slut kan fortfarande anmäla sig, och anmälan förbrukar inget av login-kvoten.
    const ipB = '203.0.113.21';
    for (let i = 1; i <= 21; i++) await login(ipB);
    expect((await login(ipB)).status).toBe(429);
    expect((await join(ipB)).status).toBe(200);
  });
});
