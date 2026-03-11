/**
 * Integration tests for challenge routes:
 *   POST /api/challenges/send
 *   PUT  /api/challenges/:id/respond
 *
 * Key invariants tested:
 *   - Auth guards on all endpoints
 *   - Validation of required fields
 *   - Cannot challenge yourself
 *   - Token ownership — cannot send another user's token
 *   - Token already sent cannot be reused
 *   - Double-challenge guard — neither party may have a pending/active challenge
 *   - Respond: invalid action rejected
 *   - Respond: only the opponent can respond to their own challenge
 *   - Legendary challenges cannot be declined
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

// ── Mock challenge service ────────────────────────────────────────────────────
vi.mock('../../services/challengeService.js', () => ({
  getProgressForChallenge: vi.fn().mockResolvedValue([]),
  settleChallenge: vi.fn().mockResolvedValue(undefined),
  reconcileTokensForLevel: vi.fn().mockResolvedValue(undefined),
}));

import { getSupabaseClient } from '../../config/database.js';
import app from '../../app.js';

// ── HTTP helpers ──────────────────────────────────────────────────────────────

let server: http.Server;
let port: number;

function httpRequest(
  method: 'POST' | 'PUT',
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
const put = (path: string, body: unknown, headers?: Record<string, string>) =>
  httpRequest('PUT', path, body, headers);

beforeAll(() => new Promise<void>((resolve) => {
  server = http.createServer(app);
  server.listen(0, '127.0.0.1', () => {
    port = (server.address() as any).port;
    resolve();
  });
}));

afterAll(() => new Promise<void>((resolve) => {
  server.close(() => resolve());
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const USER_ID = 'user-uuid-challenger';
const OPPONENT_ID = 'user-uuid-opponent';
const TOKEN_ID = 'token-uuid-1';
const CHALLENGE_ID = 'challenge-uuid-1';
const GROUP_ID = 'group-uuid-1';

function mintToken(userId = USER_ID) {
  return jwt.sign(
    { user_id: userId, name: 'TestUser', email: 'test@example.com', group_id: GROUP_ID },
    process.env.JWT_SECRET as string,
    { expiresIn: '1h' }
  );
}

const authHeader = { Authorization: `Bearer ${mintToken()}` };

const VALID_TOKEN = {
  id: TOKEN_ID, user_id: USER_ID, tier: 'minor', metric: 'km',
  duration_days: 7, reward_id: 'rwd-1', sent_at: null,
};
const CHALLENGER_USER = { id: USER_ID, current_level: 5, group_id: GROUP_ID };
const OPPONENT_USER   = { id: OPPONENT_ID, current_level: 3, group_id: GROUP_ID };
const VALID_REWARD = {
  winner_type: 'xp_boost', winner_delta: 1.1, winner_duration: 7,
  loser_type: 'xp_penalty', loser_delta: 0.9, loser_duration: 7,
};

/**
 * Build a Supabase stub for the /send endpoint.
 * Each table key overrides the default `.single()` return value.
 * `existingChallenges` controls what the double-challenge guard query returns.
 */
function buildSendStub(overrides: {
  token?: any;
  tokenError?: any;
  existingChallenges?: any[];
  challengeInsertError?: any;
} = {}) {
  const token = overrides.token ?? VALID_TOKEN;
  const existingChallenges = overrides.existingChallenges ?? [];

  // Track how many times `from('users')` has been called so we can
  // return challenger on the first call and opponent on the second.
  let userCallCount = 0;

  const makeChain = () => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    return chain;
  };

  return {
    from: vi.fn().mockImplementation((table: string) => {
      const chain = makeChain();

      switch (table) {
        case 'user_challenge_tokens': {
          chain.single = vi.fn().mockResolvedValue(
            overrides.tokenError
              ? { data: null, error: overrides.tokenError }
              : { data: token, error: null }
          );
          break;
        }
        case 'users': {
          userCallCount++;
          const userData = userCallCount % 2 === 1 ? CHALLENGER_USER : OPPONENT_USER;
          chain.single = vi.fn().mockResolvedValue({ data: userData, error: null });
          break;
        }
        case 'challenges': {
          // The double-challenge guard awaits the chain directly (no .single())
          chain.then = (resolve: (v: any) => void) =>
            resolve({ data: existingChallenges, error: null });
          // The insert path uses .single()
          chain.single = vi.fn().mockResolvedValue(
            overrides.challengeInsertError
              ? { data: null, error: overrides.challengeInsertError }
              : { data: { id: CHALLENGE_ID }, error: null }
          );
          break;
        }
        case 'challenge_rewards': {
          chain.single = vi.fn().mockResolvedValue({ data: VALID_REWARD, error: null });
          break;
        }
      }

      return chain;
    }),
  };
}

/**
 * Build a Supabase stub for the /respond endpoint.
 */
function buildRespondStub(challenge: any) {
  const makeChain = () => ({
    select: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: challenge, error: challenge ? null : { message: 'not found' } }),
  });

  return { from: vi.fn().mockImplementation(() => makeChain()) };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/challenges/send', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  // ── Auth ─────────────────────────────────────────────────────────────────

  it('returns 401 when no Authorization header is provided', async () => {
    const { status } = await post('/api/challenges/send', { token_id: TOKEN_ID, opponent_id: OPPONENT_ID });
    expect(status).toBe(401);
  });

  it('returns 403 when the token is invalid', async () => {
    const { status } = await post(
      '/api/challenges/send',
      { token_id: TOKEN_ID, opponent_id: OPPONENT_ID },
      { Authorization: 'Bearer bad-token' }
    );
    expect(status).toBe(403);
  });

  // ── Validation ───────────────────────────────────────────────────────────

  it('returns 400 when token_id is missing', async () => {
    const { status, body } = await post(
      '/api/challenges/send',
      { opponent_id: OPPONENT_ID },
      authHeader
    );
    expect(status).toBe(400);
    expect(body.error).toMatch(/token_id and opponent_id are required/i);
  });

  it('returns 400 when opponent_id is missing', async () => {
    const { status, body } = await post(
      '/api/challenges/send',
      { token_id: TOKEN_ID },
      authHeader
    );
    expect(status).toBe(400);
    expect(body.error).toMatch(/token_id and opponent_id are required/i);
  });

  it('returns 400 when challenging yourself', async () => {
    const { status, body } = await post(
      '/api/challenges/send',
      { token_id: TOKEN_ID, opponent_id: USER_ID },
      authHeader
    );
    expect(status).toBe(400);
    expect(body.error).toMatch(/cannot challenge yourself/i);
  });

  // ── Token ownership ───────────────────────────────────────────────────────

  it('returns 403 when token does not belong to the authenticated user', async () => {
    vi.mocked(getSupabaseClient).mockReturnValue(
      buildSendStub({ token: { ...VALID_TOKEN, user_id: 'other-user' } }) as any
    );
    const { status, body } = await post(
      '/api/challenges/send',
      { token_id: TOKEN_ID, opponent_id: OPPONENT_ID },
      authHeader
    );
    expect(status).toBe(403);
    expect(body.error).toMatch(/does not belong to you/i);
  });

  it('returns 400 when token has already been sent', async () => {
    vi.mocked(getSupabaseClient).mockReturnValue(
      buildSendStub({ token: { ...VALID_TOKEN, sent_at: '2025-01-01T00:00:00Z' } }) as any
    );
    const { status, body } = await post(
      '/api/challenges/send',
      { token_id: TOKEN_ID, opponent_id: OPPONENT_ID },
      authHeader
    );
    expect(status).toBe(400);
    expect(body.error).toMatch(/already been sent/i);
  });

  // ── Double-challenge guard ────────────────────────────────────────────────

  it('returns 400 when the challenger already has an active challenge', async () => {
    vi.mocked(getSupabaseClient).mockReturnValue(
      buildSendStub({
        existingChallenges: [
          { id: 'ch-existing', challenger_id: USER_ID, opponent_id: 'someone-else' }
        ],
      }) as any
    );
    const { status, body } = await post(
      '/api/challenges/send',
      { token_id: TOKEN_ID, opponent_id: OPPONENT_ID },
      authHeader
    );
    expect(status).toBe(400);
    expect(body.error).toMatch(/already have an active or pending challenge/i);
  });

  it('returns 400 when the opponent already has an active challenge', async () => {
    vi.mocked(getSupabaseClient).mockReturnValue(
      buildSendStub({
        existingChallenges: [
          { id: 'ch-existing', challenger_id: 'someone-else', opponent_id: OPPONENT_ID }
        ],
      }) as any
    );
    const { status, body } = await post(
      '/api/challenges/send',
      { token_id: TOKEN_ID, opponent_id: OPPONENT_ID },
      authHeader
    );
    expect(status).toBe(400);
    expect(body.error).toMatch(/opponent already has an active or pending challenge/i);
  });

  // ── Success ───────────────────────────────────────────────────────────────

  it('returns 201 and the new challenge id on success', async () => {
    vi.mocked(getSupabaseClient).mockReturnValue(buildSendStub() as any);
    const { status, body } = await post(
      '/api/challenges/send',
      { token_id: TOKEN_ID, opponent_id: OPPONENT_ID },
      authHeader
    );
    expect(status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.challenge_id).toBe(CHALLENGE_ID);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('PUT /api/challenges/:id/respond', () => {
  const opponentToken = mintToken(OPPONENT_ID);
  const opponentHeader = { Authorization: `Bearer ${opponentToken}` };

  beforeEach(() => { vi.clearAllMocks(); });

  // ── Auth ─────────────────────────────────────────────────────────────────

  it('returns 401 when no Authorization header is provided', async () => {
    const { status } = await put(`/api/challenges/${CHALLENGE_ID}/respond`, { action: 'accept' });
    expect(status).toBe(401);
  });

  // ── Validation ───────────────────────────────────────────────────────────

  it('returns 400 when action is not accept or decline', async () => {
    const { status, body } = await put(
      `/api/challenges/${CHALLENGE_ID}/respond`,
      { action: 'ignore' },
      opponentHeader
    );
    expect(status).toBe(400);
    expect(body.error).toMatch(/accept.*decline/i);
  });

  // ── Authorization ─────────────────────────────────────────────────────────

  it('returns 404 when challenge is not found or user is not the opponent', async () => {
    vi.mocked(getSupabaseClient).mockReturnValue(buildRespondStub(null) as any);
    const { status, body } = await put(
      `/api/challenges/${CHALLENGE_ID}/respond`,
      { action: 'accept' },
      opponentHeader
    );
    expect(status).toBe(404);
    expect(body.error).toMatch(/not found/i);
  });

  // ── Business rules ────────────────────────────────────────────────────────

  it('returns 400 when declining a legendary challenge', async () => {
    const legendaryChallenge = {
      id: CHALLENGE_ID, tier: 'legendary', status: 'pending',
      challenger_id: USER_ID, opponent_id: OPPONENT_ID,
      duration_days: 30,
    };
    vi.mocked(getSupabaseClient).mockReturnValue(buildRespondStub(legendaryChallenge) as any);
    const { status, body } = await put(
      `/api/challenges/${CHALLENGE_ID}/respond`,
      { action: 'decline' },
      opponentHeader
    );
    expect(status).toBe(400);
    expect(body.error).toMatch(/legendary.*cannot be declined/i);
  });

  // ── Success paths ─────────────────────────────────────────────────────────

  it('returns 200 when accepting a minor challenge', async () => {
    const minorChallenge = {
      id: CHALLENGE_ID, tier: 'minor', status: 'pending',
      challenger_id: USER_ID, opponent_id: OPPONENT_ID,
      duration_days: 7,
    };
    vi.mocked(getSupabaseClient).mockReturnValue(buildRespondStub(minorChallenge) as any);
    const { status, body } = await put(
      `/api/challenges/${CHALLENGE_ID}/respond`,
      { action: 'accept' },
      opponentHeader
    );
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('returns 200 when declining a non-legendary challenge', async () => {
    const minorChallenge = {
      id: CHALLENGE_ID, tier: 'minor', status: 'pending',
      challenger_id: USER_ID, opponent_id: OPPONENT_ID,
      duration_days: 7,
    };
    vi.mocked(getSupabaseClient).mockReturnValue(buildRespondStub(minorChallenge) as any);
    const { status, body } = await put(
      `/api/challenges/${CHALLENGE_ID}/respond`,
      { action: 'decline' },
      opponentHeader
    );
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });
});
