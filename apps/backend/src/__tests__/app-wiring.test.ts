/**
 * ADR 003 wiring-test: varje monterat routerprefix i createApp() svarar på en
 * oautentiserad förfrågan med 401/400/403 — aldrig appens 404 "Route not found".
 * Utökas varje gång en router läggs i app.ts (ADR 007: /api/leaderboard, /api/config; nya paths under challenges/events/runs; ADR 008: /api/news; ADR 009: /api/badges).
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { createApp } from '../app.js';
import { startServer, type TestServer } from '../routes/__tests__/helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(createApp()); });
afterAll(async () => { await server.close(); });

// En känd skyddad endpoint per routerprefix.
const WIRED: Array<[prefix: string, method: string, path: string]> = [
  ['/api/auth', 'GET', '/api/auth/users-with-runs'],
  ['/api/challenges', 'GET', '/api/challenges/my'],
  ['/api/events', 'GET', '/api/events'],
  ['/api/groups', 'GET', '/api/groups/my'],
  ['/api/onboarding', 'GET', '/api/onboarding/status'],
  ['/api/strava', 'GET', '/api/strava/status'],
  ['/api/titles', 'GET', '/api/titles'],
  ['/api/runs', 'GET', '/api/runs/group-history'],
  ['/api/users', 'POST', '/api/users/profile-picture'],
  ['/api/leaderboard', 'GET', '/api/leaderboard/week'],
  ['/api/leaderboard', 'GET', '/api/leaderboard/rank-delta'],
  ['/api/config', 'GET', '/api/config/xp'],
  ['/api/config', 'GET', '/api/config/levels'],
  // ADR 008: Pack News
  ['/api/news', 'GET', '/api/news'],
  ['/api/news', 'POST', '/api/news/seen'],
  ['/api/news', 'POST', '/api/news/read'],
  // ADR 009: badges (läs-API, RUN-120)
  ['/api/badges', 'GET', '/api/badges/user/00000000-0000-4000-8000-000000000001'],
  ['/api/badges', 'GET', '/api/badges/group'],
  // ADR 007 B5–B8: nya paths under befintliga routrar
  ['/api/challenges', 'GET', '/api/challenges/group-history'],
  ['/api/challenges', 'GET', '/api/challenges/head-to-head/00000000-0000-4000-8000-000000000001'],
  ['/api/events', 'GET', '/api/events/history'],
  // Väntelistan (admin-listan; den publika POST /api/waitlist har ingen token och testas i waitlist.test.ts)
  ['/api/admin', 'GET', '/api/admin/waitlist'],
];

describe('createApp wiring', () => {
  it.each(WIRED)('%s monterad: %s %s ger 401 utan token (inte 404)', async (_prefix, method, path) => {
    const res = await server.request(method, path);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: expect.any(String) });
    expect(res.body.error).not.toBe('Route not found');
  });

  // ADR 011: användarinställningar, båda metoderna
  it('monterar /api/settings', async () => {
    for (const method of ['GET', 'PUT']) {
      const res = await server.request(method, '/api/settings');
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: expect.any(String) });
      expect(res.body.error).not.toBe('Route not found');
    }
  });

  // ADR 010 beslut 2: Stravas webhook är publik och monterad före /api/strava
  describe('strava webhook', () => {
    const webhookEnv = () => {
      process.env.STRAVA_WEBHOOK_VERIFY_TOKEN = 'wiring-verify-token-0123456789abcdef';
      delete process.env.STRAVA_WEBHOOK_SUBSCRIPTION_ID;
    };
    afterEach(() => { delete process.env.STRAVA_WEBHOOK_VERIFY_TOKEN; });

    it('webhook route needs no JWT', async () => {
      webhookEnv();
      const verify = await server.request('GET', '/api/strava/webhook?hub.mode=subscribe&hub.verify_token=wiring-verify-token-0123456789abcdef&hub.challenge=wired');
      expect(verify.status).toBe(200);
      expect(verify.body).toEqual({ 'hub.challenge': 'wired' });
      // POST utan token når handlern (prenumerations-id:t är inte satt: 200 och släpps), inte JWT-skyddet
      const event = await server.request('POST', '/api/strava/webhook', { body: { object_type: 'activity' } });
      expect(event.status).toBe(200);
    });

    it('webhook route is mounted before the global json parser with its own 10 kB limit', async () => {
      webhookEnv();
      // 11 kB passerar den globala parserns 100 kB-gräns: bara routerns egen gräns kan ge 413
      const res = await server.request('POST', '/api/strava/webhook', { body: { object_type: 'activity', filler: 'x'.repeat(11 * 1024) } });
      expect(res.status).toBe(413);
      expect(res.body).toEqual({ error: expect.any(String) });
    });

    it('jwt-protected strava routes still require a token', async () => {
      for (const [method, path] of [['GET', '/api/strava/status'], ['POST', '/api/strava/callback'], ['POST', '/api/strava/sync']] as const) {
        const res = await server.request(method, path);
        expect({ path, status: res.status }).toEqual({ path, status: 401 });
      }
    });

    it('api info lists the webhook route', async () => {
      const res = await server.request('GET', '/api');
      expect(res.status).toBe(200);
      expect(res.body.endpoints.strava.webhook).toBe('/api/strava/webhook');
    });
  });

  it('okänd route ger appens 404', async () => {
    const res = await server.request('GET', '/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Route not found');
  });
});
