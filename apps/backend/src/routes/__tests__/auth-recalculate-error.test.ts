/**
 * POST /api/auth/recalculate-totals: ett fel under omräkningen får inte följa med i HTTP-svaret (error.message kan bära databasvärden)
 * och loggas bara som felkod.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { inspect } from 'node:util';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

const { LEAK } = vi.hoisted(() => ({ LEAK: 'LEAKMARKER-row-value-4711' }));
vi.mock('../../utils/calculateUserTotals.js', () => ({
  calculateUserTotals: vi.fn().mockRejectedValue(Object.assign(new Error(`update on users failed for (email)=(${LEAK})`), { code: '23503' })),
}));

import app from '../../app.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });

let spies: Array<ReturnType<typeof vi.spyOn>>;
beforeEach(() => {
  spies = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => { vi.restoreAllMocks(); });

describe('POST /api/auth/recalculate-totals', () => {
  it('answers a generic 500 without the error message and logs only the error code', async () => {
    const res = await server.request('POST', '/api/auth/recalculate-totals', { token: mintToken({ user_id: 'u1' }) });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to recalculate user totals' });

    const calls = spies.flatMap((s) => s.mock.calls);
    const out = calls.map((args: unknown[]) => args.map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 6 }))).join(' ')).join('\n');
    expect(out).toContain('23503');
    expect(out).not.toContain(LEAK);
    expect(calls.flat().some((a: unknown) => a instanceof Error)).toBe(false);
  });
});
