/**
 * RUN-214: request-loggen ska ge metod, path (utan query) och status — aldrig
 * query-strängen (kan bära tokens/koder).
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

import { createApp } from '../app.js';
import { startServer, type TestServer } from '../routes/__tests__/helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(createApp()); });
afterAll(async () => { await server.close(); });

let logSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => { logSpy = vi.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

const lines = () => logSpy.mock.calls.map((args: unknown[]) => args.map(String).join(' '));

describe('request log', () => {
  it('loggar metod, path och status', async () => {
    await server.request('GET', '/health');
    await vi.waitFor(() => expect(lines().some((l) => /GET/.test(l) && l.includes('/health') && /\b200\b/.test(l))).toBe(true));
  });

  it('loggar slutlig status också för 401 och hela pathen genom sub-routrar', async () => {
    await server.request('GET', '/api/strava/status');
    await vi.waitFor(() => expect(lines().some((l) => l.includes('/api/strava/status') && /\b401\b/.test(l))).toBe(true));
  });

  it('loggar aldrig query-strängen', async () => {
    await server.request('GET', '/health?token=s3cr3t-value&code=abc123');
    await vi.waitFor(() => expect(lines().some((l) => l.includes('/health'))).toBe(true));
    expect(lines().join('\n')).not.toMatch(/s3cr3t-value|abc123|token=/);
  });
});
