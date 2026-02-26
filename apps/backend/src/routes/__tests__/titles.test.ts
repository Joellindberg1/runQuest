/**
 * Integration tests for GET /api/titles/leaderboard
 *
 * Uses Node's built-in http module to make real HTTP requests against a test
 * server instance of the Express app, with TitleLeaderboardService mocked.
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

// ── Hoist mock functions so they are available inside vi.mock() factories ─────
// vi.mock() calls are hoisted to the top of the file by Vitest, before any
// module-level variable declarations run. vi.hoisted() runs even earlier, so
// variables created there are safe to reference inside vi.mock() factories.
const {
  mockGetTitleLeaderboard,
  mockGetAllTitles,
  mockGetUserTitles,
  mockRefreshTitleLeaderboard,
  mockPopulateTitleLeaderboard,
} = vi.hoisted(() => ({
  mockGetTitleLeaderboard: vi.fn(),
  mockGetAllTitles: vi.fn(),
  mockGetUserTitles: vi.fn(),
  mockRefreshTitleLeaderboard: vi.fn(),
  mockPopulateTitleLeaderboard: vi.fn(),
}));

// ── Mock TitleLeaderboardService (both import paths used by titles.ts) ────────
vi.mock('../../services/titleLeaderboardService', () => ({
  TitleLeaderboardService: vi.fn().mockImplementation(() => ({
    getTitleLeaderboard: mockGetTitleLeaderboard,
    getAllTitles: mockGetAllTitles,
    getUserTitles: mockGetUserTitles,
    refreshTitleLeaderboard: mockRefreshTitleLeaderboard,
    populateTitleLeaderboard: mockPopulateTitleLeaderboard,
  })),
  titleLeaderboardService: {
    getTitleLeaderboard: mockGetTitleLeaderboard,
    getAllTitles: mockGetAllTitles,
    getUserTitles: mockGetUserTitles,
    refreshTitleLeaderboard: mockRefreshTitleLeaderboard,
    populateTitleLeaderboard: mockPopulateTitleLeaderboard,
  },
}));

vi.mock('../../services/titleLeaderboardService.js', () => ({
  TitleLeaderboardService: vi.fn().mockImplementation(() => ({
    getTitleLeaderboard: mockGetTitleLeaderboard,
    getAllTitles: mockGetAllTitles,
    getUserTitles: mockGetUserTitles,
    refreshTitleLeaderboard: mockRefreshTitleLeaderboard,
    populateTitleLeaderboard: mockPopulateTitleLeaderboard,
  })),
  titleLeaderboardService: {
    getTitleLeaderboard: mockGetTitleLeaderboard,
    getAllTitles: mockGetAllTitles,
    getUserTitles: mockGetUserTitles,
    refreshTitleLeaderboard: mockRefreshTitleLeaderboard,
    populateTitleLeaderboard: mockPopulateTitleLeaderboard,
  },
}));

import app from '../../app.js';

// ─────────────────────────────────────────────────────────────────────────────
// HTTP helpers
// ─────────────────────────────────────────────────────────────────────────────

let server: http.Server;
let port: number;

function get(
  path: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path, method: 'GET', headers },
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

function mintTestToken(userId = 'user-uuid-test') {
  return jwt.sign(
    { user_id: userId, name: 'TestUser', email: 'test@example.com' },
    process.env.JWT_SECRET as string,
    { expiresIn: '1h' }
  );
}

const FAKE_LEADERBOARD = [
  {
    id: 'title-1',
    name: 'Marathon Master',
    description: 'Run a marathon',
    unlock_requirement: 42.2,
    holder: {
      user_id: 'user-uuid-1',
      user_name: 'Alice',
      profile_picture: null,
      value: 250,
      earned_at: '2025-09-01T00:00:00.000Z',
    },
    runners_up: [
      {
        position: 2,
        user_id: 'user-uuid-2',
        user_name: 'Bob',
        profile_picture: null,
        value: 200,
        earned_at: '2025-09-05T00:00:00.000Z',
      },
    ],
  },
  {
    id: 'title-2',
    name: 'Speed Demon',
    description: 'Run 5 km in under 25 minutes',
    unlock_requirement: 5,
    holder: null,
    runners_up: [],
  },
];

describe('GET /api/titles/leaderboard', () => {
  const token = mintTestToken();
  const authHeader = { Authorization: `Bearer ${token}` };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Auth guard ───────────────────────────────────────────────────────────

  it('returns 401 when no Authorization header is provided', async () => {
    const { status } = await get('/api/titles/leaderboard');
    expect(status).toBe(401);
  });

  it('returns 403 when the token is invalid', async () => {
    const { status } = await get('/api/titles/leaderboard', {
      Authorization: 'Bearer not-a-valid-token',
    });
    expect(status).toBe(403);
  });

  // ── Success path ─────────────────────────────────────────────────────────

  it('returns 200 with the correct envelope shape', async () => {
    mockGetTitleLeaderboard.mockResolvedValue(FAKE_LEADERBOARD);

    const { status, body } = await get('/api/titles/leaderboard', authHeader);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toBeDefined();
    expect(body.meta.total_titles).toBe(FAKE_LEADERBOARD.length);
    expect(body.meta.cache_optimized).toBe(true);
    expect(typeof body.meta.timestamp).toBe('string');
  });

  it('returns each leaderboard entry with required fields', async () => {
    mockGetTitleLeaderboard.mockResolvedValue(FAKE_LEADERBOARD);

    const { status, body } = await get('/api/titles/leaderboard', authHeader);

    expect(status).toBe(200);
    const [entry] = body.data;
    expect(entry).toHaveProperty('id');
    expect(entry).toHaveProperty('name');
    expect(entry).toHaveProperty('description');
    expect(entry).toHaveProperty('holder');
    expect(entry).toHaveProperty('runners_up');
    expect(Array.isArray(entry.runners_up)).toBe(true);
  });

  it('correctly propagates holder data from the service', async () => {
    mockGetTitleLeaderboard.mockResolvedValue(FAKE_LEADERBOARD);

    const { status, body } = await get('/api/titles/leaderboard', authHeader);

    expect(status).toBe(200);
    const [entry] = body.data;
    expect(entry.holder).not.toBeNull();
    expect(entry.holder.user_name).toBe('Alice');
    expect(typeof entry.holder.value).toBe('number');
  });

  it('correctly handles a title with no current holder', async () => {
    mockGetTitleLeaderboard.mockResolvedValue(FAKE_LEADERBOARD);

    const { status, body } = await get('/api/titles/leaderboard', authHeader);

    expect(status).toBe(200);
    const noHolder = body.data.find((e: any) => e.id === 'title-2');
    expect(noHolder).toBeDefined();
    expect(noHolder.holder).toBeNull();
    expect(noHolder.runners_up).toHaveLength(0);
  });

  it('returns an empty array when the service returns no titles', async () => {
    mockGetTitleLeaderboard.mockResolvedValue([]);

    const { status, body } = await get('/api/titles/leaderboard', authHeader);

    expect(status).toBe(200);
    expect(body.data).toHaveLength(0);
    expect(body.meta.total_titles).toBe(0);
  });

  // ── Error path ───────────────────────────────────────────────────────────

  it('returns 500 when the service throws an error', async () => {
    mockGetTitleLeaderboard.mockRejectedValue(new Error('DB exploded'));

    const { status, body } = await get('/api/titles/leaderboard', authHeader);

    expect(status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/failed to fetch title leaderboard/i);
  });
});
