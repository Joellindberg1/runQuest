/**
 * En förfrågan utan kropp, eller med en innehållstyp som JSON-parsern inte läser (text/plain), lämnar `req.body` odefinierad i Express 5. Varje rutt som
 * läser sina fält ur kroppen ska då svara 400 `invalid_request` (klientens fel) och inte 500 `internal_error` (som också blir en Sentry-händelse).
 * Provet går genom createApp() med fejkad databas, så det är den riktiga kedjan av parser, middleware, rutt och felhanterare som svarar.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));
vi.mock('../utils/calculateUserTotals.js', () => ({ calculateUserTotals: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../services/eventService.js', () => ({
  checkEventQualification: vi.fn().mockResolvedValue(undefined),
  maybeCreateEvent: vi.fn(),
  activateScheduledEvents: vi.fn(),
  settleCompetitionEvents: vi.fn(),
  settleExpiredParticipationEvents: vi.fn(),
}));
vi.mock('../services/weatherService.js', () => ({
  WeatherService: { fetchAndSaveWeatherForRuns: vi.fn().mockResolvedValue(undefined), backfillMissingWeather: vi.fn() },
}));

import http from 'node:http';
import net from 'node:net';
import { getSupabaseClient } from '../config/database.js';
import app from '../app.js';
import { createFakeDb, type Row } from '../routes/__tests__/helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from '../routes/__tests__/helpers/http.js';
import { startFakeSentry, type FakeSentry } from '../observability/__tests__/helpers/fakeSentry.js';

let server: TestServer;
let sentry: FakeSentry;
// Egen lyssnare vid sidan av startServer: rå HTTP-förfrågningar utan Content-Length (rawWithoutBody) behöver portnumret.
const rawServer = http.createServer(app);
let port: number;
beforeAll(async () => {
  server = await startServer(app);
  await new Promise<void>((resolve) => { rawServer.listen(0, '127.0.0.1', resolve); });
  port = (rawServer.address() as { port: number }).port;
});
afterAll(async () => {
  await server.close();
  await new Promise<void>((resolve) => { rawServer.close(() => resolve()); });
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const tables: Record<string, Row[]> = {
    users: [{ id: 'user-1', name: 'Alice', email: 'test@example.com', is_admin: true, group_id: 'group-1', current_level: 3, total_xp: 100, profile_picture: null }],
    group_members: [{ id: 'm-1', user_id: 'user-1', group_id: 'group-1', role: 'admin', left_at: null, starts_on: null, joined_at: '2026-01-01T00:00:00.000Z' }],
    groups: [{ id: 'group-1', name: 'Gruppen', invite_code: 'ABC123' }],
  };
  vi.mocked(getSupabaseClient).mockReturnValue(createFakeDb(tables, { autoIds: true }).client as never);
  sentry = startFakeSentry();
});
afterEach(async () => {
  await sentry.stop();
  vi.restoreAllMocks();
});

const token = mintToken({ user_id: 'user-1', group_id: 'group-1' });
const UUID = '3f2b8c1e-5d4a-4b7e-9c3a-1a2b3c4d5e6f';

interface BodyRoute { method: 'POST' | 'PUT'; path: string }

/** Rutterna som kräver sina fält i kroppen: utan kropp finns inget att utföra, och svaret är 400. */
const BODY_REQUIRED: BodyRoute[] = [
  { method: 'POST', path: '/api/auth/login' },
  { method: 'POST', path: '/api/auth/change-password' },
  { method: 'POST', path: '/api/auth/users' },
  { method: 'PUT', path: `/api/auth/users/${UUID}/password` },
  { method: 'PUT', path: '/api/auth/admin-settings' },
  { method: 'PUT', path: '/api/auth/streak-multipliers' },
  { method: 'PUT', path: '/api/auth/me/displayed-titles' },
  { method: 'PUT', path: '/api/badges/showcase' },
  { method: 'POST', path: '/api/challenges/send' },
  { method: 'PUT', path: `/api/challenges/${UUID}/respond` },
  { method: 'PUT', path: '/api/groups/settings' },
  { method: 'POST', path: '/api/groups/join' },
  { method: 'POST', path: '/api/news/read' },
  { method: 'POST', path: '/api/onboarding/mark-seen' },
  { method: 'POST', path: '/api/runs' },
  { method: 'PUT', path: `/api/runs/${UUID}` },
  { method: 'PUT', path: '/api/settings' },
  { method: 'PUT', path: '/api/strava/sync-paused' },
  { method: 'POST', path: '/api/strava/callback' },
];

let ipCounter = 0;
/** Varje anrop får en egen klient-IP (trust proxy 1), så rutternas hastighetsgränser inte fäller provet. */
const asNewClient = (headers: Record<string, string> = {}) => ({ 'X-Forwarded-For': `10.9.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`, ...headers });

/**
 * En förfrågan utan Content-Type och utan Content-Length, som `curl -X POST` eller en klient utan kropp skickar den. Node:s http-klient lägger själv till
 * `Content-Length: 0` på en POST, och body-parser läser det som en tom JSON-kropp (`{}`), så förfrågan skrivs som rå HTTP över en socket.
 */
function withoutBody(r: BodyRoute): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    let raw = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => { raw += chunk; });
    socket.on('error', reject);
    socket.on('close', () => {
      const [head, ...rest] = raw.split('\r\n\r\n');
      const status = Number(/^HTTP\/1\.1 (\d{3})/.exec(head)?.[1] ?? 0);
      const text = rest.join('\r\n\r\n');
      try { resolve({ status, body: JSON.parse(text) }); } catch { resolve({ status, body: text }); }
    });
    const lines = [`${r.method} ${r.path} HTTP/1.1`, 'Host: 127.0.0.1', `Authorization: Bearer ${token}`, `X-Forwarded-For: ${asNewClient()['X-Forwarded-For']}`, 'Connection: close'];
    socket.write(`${lines.join('\r\n')}\r\n\r\n`);
  });
}
const withTextPlain = (r: BodyRoute) => server.request(r.method, r.path, { token, body: 'not json at all', headers: asNewClient({ 'Content-Type': 'text/plain' }) });

describe('a request without a body', () => {
  it.each(BODY_REQUIRED)('is answered 400 invalid_request by $method $path', async (route) => {
    const res = await withoutBody(route);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, code: 'invalid_request' });
    expect(typeof res.body.error).toBe('string');
  });
});

describe('a request with Content-Type text/plain', () => {
  it.each(BODY_REQUIRED)('is answered 400 invalid_request by $method $path', async (route) => {
    const res = await withTextPlain(route);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, code: 'invalid_request' });
    expect(typeof res.body.error).toBe('string');
  });
});

describe('a missing body is a client error', () => {
  it('sends no event to Sentry for any of the routes that read their fields from the body', async () => {
    for (const route of BODY_REQUIRED) {
      await withoutBody(route);
      await withTextPlain(route);
    }
    const events = await sentry.drain();
    expect(events).toEqual([]);
  }, 30000);
});

describe('routes where the body is optional', () => {
  it('still answers POST /api/badges/seen without a body as before', async () => {
    const res = await server.request('POST', '/api/badges/seen', { token, headers: asNewClient() });
    expect(res.status).toBeLessThan(500);
  });

  it('still answers POST /api/news/seen without a body as before', async () => {
    const res = await server.request('POST', '/api/news/seen', { token, headers: asNewClient() });
    expect(res.status).toBeLessThan(500);
  });

  it('still answers the routes that take no body at all without one', async () => {
    for (const path of ['/api/strava/sync', '/api/auth/recalculate-totals', '/api/events/admin/trigger-daily-draw', '/api/titles/refresh']) {
      const res = await server.request('POST', path, { token, headers: asNewClient() });
      expect(res.status, path).toBeLessThan(500);
    }
  });
});

describe('the routes with their own body parser', () => {
  it('answers POST /api/waitlist without a body with its own validation, not a server error', async () => {
    const res = await withoutBody({ method: 'POST', path: '/api/waitlist' });
    expect(res.status).toBe(400);
  });

  it('answers the Strava webhook event post without a body with a client error, not a server error', async () => {
    const res = await withoutBody({ method: 'POST', path: '/api/strava/webhook' });
    expect(res.status).toBeLessThan(500);
  });

  it('answers a profile picture post with an image content type but no body 400', async () => {
    const empty = await server.request('POST', '/api/users/profile-picture', { token, headers: asNewClient({ 'Content-Type': 'image/png' }) });
    expect(empty.status).toBe(400);
  });
});
