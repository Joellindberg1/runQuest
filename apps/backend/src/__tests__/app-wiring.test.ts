/**
 * ADR 003 wiring-test: varje monterat routerprefix i createApp() svarar på en
 * oautentiserad förfrågan med 401/400/403 — aldrig appens 404 "Route not found".
 * Utökas varje gång en router läggs i app.ts (ADR 007: /api/leaderboard, /api/config).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  testDatabaseConnection: vi.fn(),
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
];

describe('createApp wiring', () => {
  it.each(WIRED)('%s monterad: %s %s ger 401 utan token (inte 404)', async (_prefix, method, path) => {
    const res = await server.request(method, path);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: expect.any(String) });
    expect(res.body.error).not.toBe('Route not found');
  });

  it('okänd route ger appens 404', async () => {
    const res = await server.request('GET', '/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Route not found');
  });
});
