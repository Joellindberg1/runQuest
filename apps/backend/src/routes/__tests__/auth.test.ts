/**
 * Integration tests for POST /api/auth/login
 *
 * Uses Node's built-in http module to make real HTTP requests to a test server
 * instance of the Express app, with the Supabase client and bcrypt mocked so
 * no real database or network calls are made.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import jwt from 'jsonwebtoken';

// ── Environment stubs (must be set before any app module is imported) ─────────
process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.JWT_EXPIRES_IN = '1h';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

// ── Mock the Supabase database layer ─────────────────────────────────────────
vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  testDatabaseConnection: vi.fn(),
  getSupabaseClient: vi.fn(),
}));

// ── Mock bcrypt ───────────────────────────────────────────────────────────────
vi.mock('bcryptjs', () => ({
  default: { compare: vi.fn(), hash: vi.fn() },
  compare: vi.fn(),
  hash: vi.fn(),
}));

import { getSupabaseClient } from '../../config/database.js';
import bcrypt from 'bcryptjs';
import app from '../../app.js';

// ─────────────────────────────────────────────────────────────────────────────
// HTTP helper — mirrors the supertest API we would use if it were available
// ─────────────────────────────────────────────────────────────────────────────

let server: http.Server;
let port: number;

/** Make a JSON POST request to the test server. */
function post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
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
    req.write(payload);
    req.end();
  });
}

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

/**
 * Build a Supabase query stub where .limit() resolves with `result`.
 * All chained methods (from/select/or) return `this` so the chain works.
 * data is wrapped in an array to match the real Supabase .limit() response.
 */
function buildQueryStub(result: { data: any; error: any }) {
  const limitResult = result.error
    ? { data: null, error: result.error }
    : { data: result.data ? [result.data] : [], error: null };
  return {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(limitResult),
  };
}

describe('POST /api/auth/login', () => {
  // Use resetAllMocks so that any queued mockReturnValueOnce calls from a
  // previous test are fully cleared before the next one runs.
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ── Success ──────────────────────────────────────────────────────────────

  it('returns 200 with a JWT token and user info on valid credentials', async () => {
    const fakeUser = {
      id: 'user-uuid-1',
      name: 'Alice',
      email: 'alice@example.com',
      password_hash: '$2a$10$hashedpassword',
      is_admin: false,
    };
    vi.mocked(getSupabaseClient).mockReturnValue(buildQueryStub({ data: fakeUser, error: null }) as any);
    vi.mocked(bcrypt.compare).mockResolvedValue(true as never);

    const { status, body } = await post('/api/auth/login', {
      email: 'alice@example.com',
      password: 'correctpassword',
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(typeof body.token).toBe('string');

    const decoded = jwt.verify(body.token, process.env.JWT_SECRET as string) as any;
    expect(decoded.user_id).toBe(fakeUser.id);
    expect(decoded.email).toBe(fakeUser.email);

    expect(body.user).toMatchObject({
      id: fakeUser.id,
      name: fakeUser.name,
      email: fakeUser.email,
      is_admin: false,
    });
  });

  it('also accepts login by username (name field)', async () => {
    const fakeUser = {
      id: 'user-uuid-2',
      name: 'Bob',
      email: 'bob@example.com',
      password_hash: '$2a$10$hashedpassword',
      is_admin: false,
    };
    // Single query with .or() finds the user by name
    vi.mocked(getSupabaseClient).mockReturnValue(buildQueryStub({ data: fakeUser, error: null }) as any);
    vi.mocked(bcrypt.compare).mockResolvedValue(true as never);

    const { status, body } = await post('/api/auth/login', {
      name: 'Bob',
      password: 'correctpassword',
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.user.name).toBe('Bob');
  });

  // ── Validation ───────────────────────────────────────────────────────────

  it('returns 400 when both name and email are omitted', async () => {
    const { status, body } = await post('/api/auth/login', { password: 'pass' });
    expect(status).toBe(400);
    expect(body.error).toMatch(/name\/email and password required/i);
  });

  it('returns 400 when password is omitted', async () => {
    const { status, body } = await post('/api/auth/login', { email: 'alice@example.com' });
    expect(status).toBe(400);
    expect(body.error).toMatch(/name\/email and password required/i);
  });

  // ── Auth failures ─────────────────────────────────────────────────────────

  it('returns 401 when the user is not found', async () => {
    vi.mocked(getSupabaseClient).mockReturnValue(
      buildQueryStub({ data: null, error: { message: 'not found' } }) as any
    );

    const { status, body } = await post('/api/auth/login', {
      email: 'ghost@example.com',
      password: 'whatever',
    });

    expect(status).toBe(401);
    expect(body.error).toMatch(/invalid credentials/i);
  });

  it('returns 401 when the password does not match', async () => {
    const fakeUser = {
      id: 'user-uuid-3',
      name: 'Carol',
      email: 'carol@example.com',
      password_hash: '$2a$10$hashedpassword',
      is_admin: false,
    };
    vi.mocked(getSupabaseClient).mockReturnValue(buildQueryStub({ data: fakeUser, error: null }) as any);
    vi.mocked(bcrypt.compare).mockResolvedValue(false as never);

    const { status, body } = await post('/api/auth/login', {
      email: 'carol@example.com',
      password: 'wrongpassword',
    });

    expect(status).toBe(401);
    expect(body.error).toMatch(/invalid credentials/i);
  });
});
