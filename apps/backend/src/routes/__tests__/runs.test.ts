/**
 * Integration tests for POST /api/runs
 *
 * Uses Node's built-in http module to make real HTTP requests against a test
 * server instance of the Express app, with the Supabase client and utility
 * functions mocked.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import jwt from 'jsonwebtoken';

// ── Environment stubs ─────────────────────────────────────────────────────────
process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

// ── Mock the database layer ───────────────────────────────────────────────────
vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  testDatabaseConnection: vi.fn(),
  getSupabaseClient: vi.fn(),
}));

// ── Mock XP calculation ───────────────────────────────────────────────────────
vi.mock('../../utils/xpCalculation.js', () => ({
  metersToKm: (m: number) => m / 1000,
  getLevelFromXP: vi.fn().mockResolvedValue(1),
  getXPForLevel: vi.fn().mockResolvedValue(0),
  getLevelProgress: vi.fn().mockResolvedValue({ level: 1, progress: 0 }),
}));

// ── Mock @runquest/shared ─────────────────────────────────────────────────────
vi.mock('@runquest/shared', () => ({
  calculateCompleteRunXP: vi.fn().mockReturnValue({
    baseXP: 15, kmXP: 10, distanceBonus: 5, streakBonus: 0,
    multiplier: 1.0, finalXP: 30,
  }),
  calculateRunXP: vi.fn().mockReturnValue({ baseXP: 15, kmXP: 10, distanceBonus: 5, totalXP: 30 }),
  calculateStreakMultiplier: vi.fn().mockReturnValue(1.0),
}));

// ── Mock calculateUserTotals ──────────────────────────────────────────────────
vi.mock('../../utils/calculateUserTotals.js', () => ({
  calculateUserTotals: vi.fn().mockResolvedValue(undefined),
}));

import { getSupabaseClient } from '../../config/database.js';
import app from '../../app.js';

// ─────────────────────────────────────────────────────────────────────────────
// HTTP helpers
// ─────────────────────────────────────────────────────────────────────────────

let server: http.Server;
let port: number;

function httpRequest(
  method: 'GET' | 'POST',
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...headers,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: raw });
          }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const post = (path: string, body: unknown, headers?: Record<string, string>) =>
  httpRequest('POST', path, body, headers);

beforeAll(() => {
  return new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as any).port;
      resolve();
    });
  });
});

afterAll(() => {
  return new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

// ─────────────────────────────────────────────────────────────────────────────

function mintTestToken(userId = 'user-uuid-test') {
  return jwt.sign(
    { user_id: userId, name: 'TestUser', email: 'test@example.com' },
    process.env.JWT_SECRET as string,
    { expiresIn: '1h' }
  );
}

const FAKE_RUN = {
  id: 'run-uuid-1',
  user_id: 'user-uuid-test',
  date: '2025-08-01',
  distance: 5.0,
  source: 'manual',
  base_xp: 15,
  km_xp: 10,
  distance_bonus: 5,
  streak_bonus: 0,
  streak_day: 1,
  multiplier: 1.0,
  xp_gained: 30,
};

/**
 * Build a chainable Supabase stub that handles both insert+single() calls
 * (for the new run) and select+eq+order calls (for reprocessRunsFromDate).
 */
function buildRunsStub() {
  const runsList = { data: [FAKE_RUN], error: null };
  const singleRun = { data: FAKE_RUN, error: null };
  const noError = { data: null, error: null };

  return {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    single: vi.fn().mockResolvedValue(singleRun),
  };
}

describe('POST /api/runs', () => {
  const token = mintTestToken();
  const authHeader = { Authorization: `Bearer ${token}` };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Auth guard ───────────────────────────────────────────────────────────

  it('returns 401 when no Authorization header is provided', async () => {
    const { status } = await post('/api/runs', { date: '2025-08-01', distance: 5.0 });
    expect(status).toBe(401);
  });

  it('returns 403 when the token is invalid', async () => {
    const { status } = await post(
      '/api/runs',
      { date: '2025-08-01', distance: 5.0 },
      { Authorization: 'Bearer not-a-valid-token' }
    );
    expect(status).toBe(403);
  });

  // ── Validation ───────────────────────────────────────────────────────────

  it('returns 400 when date is missing', async () => {
    const { status, body } = await post('/api/runs', { distance: 5.0 }, authHeader);
    expect(status).toBe(400);
    expect(body.error).toMatch(/date and distance are required/i);
  });

  it('returns 400 when distance is missing', async () => {
    const { status, body } = await post('/api/runs', { date: '2025-08-01' }, authHeader);
    expect(status).toBe(400);
    expect(body.error).toMatch(/date and distance are required/i);
  });

  it('returns 400 when distance is below 1.0 km', async () => {
    const { status, body } = await post('/api/runs', { date: '2025-08-01', distance: 0.5 }, authHeader);
    expect(status).toBe(400);
    expect(body.error).toMatch(/at least 1\.0 km/i);
  });

  it('returns 400 when date is before June 1 2025', async () => {
    const { status, body } = await post('/api/runs', { date: '2025-05-31', distance: 5.0 }, authHeader);
    expect(status).toBe(400);
    expect(body.error).toMatch(/before june 1, 2025/i);
  });

  it('returns 400 when date is in the future', async () => {
    const { status, body } = await post('/api/runs', { date: '2099-01-01', distance: 5.0 }, authHeader);
    expect(status).toBe(400);
    expect(body.error).toMatch(/future dates/i);
  });

  // ── Success path ─────────────────────────────────────────────────────────

  it('returns 200 with the correct run shape on a valid request', async () => {
    vi.mocked(getSupabaseClient).mockReturnValue(buildRunsStub() as any);

    const { status, body } = await post(
      '/api/runs',
      { date: '2025-08-01', distance: 5.0 },
      authHeader
    );

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toMatch(/run created/i);

    const run = body.run;
    expect(run).toBeDefined();
    expect(typeof run.id).toBe('string');
    expect(run.user_id).toBe('user-uuid-test');
    expect(run.distance).toBe(5.0);
    expect(typeof run.xp_gained).toBe('number');
    expect(typeof run.streak_day).toBe('number');
    expect(typeof run.multiplier).toBe('number');
  });

  it('response run object contains all required XP breakdown fields', async () => {
    vi.mocked(getSupabaseClient).mockReturnValue(buildRunsStub() as any);

    const { status, body } = await post(
      '/api/runs',
      { date: '2025-08-01', distance: 5.0 },
      authHeader
    );

    expect(status).toBe(200);
    const run = body.run;
    expect(run).toHaveProperty('base_xp');
    expect(run).toHaveProperty('km_xp');
    expect(run).toHaveProperty('distance_bonus');
    expect(run).toHaveProperty('streak_bonus');
    expect(run).toHaveProperty('xp_gained');
    expect(run).toHaveProperty('streak_day');
    expect(run).toHaveProperty('multiplier');
  });
});
