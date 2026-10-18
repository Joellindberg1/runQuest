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
import { createFakeDb, type Row } from './helpers/fakeDb.js';

// ── HTTP helpers ──────────────────────────────────────────────────────────────

let server: http.Server;
let port: number;

function httpRequest(
  method: 'GET' | 'POST' | 'PUT',
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
const get = (path: string, headers?: Record<string, string>) =>
  httpRequest('GET', path, undefined, headers);
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

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OPPONENT_ID = '22222222-2222-4222-8222-222222222222';
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

  it('returns 401 when the token is invalid (authentication, not authorization)', async () => {
    const { status } = await post(
      '/api/challenges/send',
      { token_id: TOKEN_ID, opponent_id: OPPONENT_ID },
      { Authorization: 'Bearer bad-token' }
    );
    expect(status).toBe(401);
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

  it('returns 400 and never builds a filter from opponent_id when it is not a uuid', async () => {
    const stub = buildSendStub();
    vi.mocked(getSupabaseClient).mockReturnValue(stub as any);
    const injection = 'x,id.neq.0';
    const { status, body } = await post(
      '/api/challenges/send',
      { token_id: TOKEN_ID, opponent_id: injection },
      authHeader
    );
    expect(status).toBe(400);
    expect(body.error).toMatch(/opponent_id must be a valid uuid/i);
    // Ingen databasfråga alls: varken users.eq eller challenges.or får ha sett strängen.
    expect(stub.from).not.toHaveBeenCalled();
  });

  it('returns 400 when opponent_id is not a string', async () => {
    const stub = buildSendStub();
    vi.mocked(getSupabaseClient).mockReturnValue(stub as any);
    const { status } = await post(
      '/api/challenges/send',
      { token_id: TOKEN_ID, opponent_id: { id: OPPONENT_ID } },
      authHeader
    );
    expect(status).toBe(400);
    expect(stub.from).not.toHaveBeenCalled();
  });

  it('returns 404 when a valid uuid opponent_id does not exist', async () => {
    const stub: any = buildSendStub();
    const baseFrom = stub.from.getMockImplementation()!;
    let usersCalls = 0;
    stub.from.mockImplementation((table: string) => {
      const chain = baseFrom(table);
      if (table === 'users') {
        usersCalls++;
        if (usersCalls === 2) chain.single = vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } });
      }
      return chain;
    });
    vi.mocked(getSupabaseClient).mockReturnValue(stub);
    const { status, body } = await post(
      '/api/challenges/send',
      { token_id: TOKEN_ID, opponent_id: '33333333-3333-4333-8333-333333333333' },
      authHeader
    );
    expect(status).toBe(404);
    expect(body.error).toMatch(/opponent not found/i);
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

// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/challenges/group-stats', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  const member = (id: string, name: string, wins: number, draws: number, losses: number): Row => ({
    id, name, group_id: GROUP_ID, wins, draws, losses, challenge_active: false, current_level: 4, profile_picture: null,
  });

  async function stats(users: Row[]) {
    const db = createFakeDb({ users, challenges: [] });
    vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
    const res = await get('/api/challenges/group-stats', authHeader);
    expect(res.status).toBe(200);
    return res.body.data as Array<Record<string, any>>;
  }

  it('group-stats ger deterministisk ordning vid lika poäng och vinster', async () => {
    // Samma ställning 1-0-1 för alla fyra: namn stigande utan hänsyn till skiftläge, därefter id. Databasens ordning är medvetet omvänd.
    const data = await stats([
      member('u-4', 'Zelda', 1, 0, 1),
      member('u-3', 'anna', 1, 0, 1),
      member('u-2', 'Anna', 1, 0, 1),
      member('u-1', 'bertil', 1, 0, 1),
    ]);

    expect(data.map((s) => s.user_id)).toEqual(['u-2', 'u-3', 'u-1', 'u-4']);

    // Samma resultat när databasen svarar i motsatt ordning.
    const reversed = await stats([
      member('u-1', 'bertil', 1, 0, 1),
      member('u-2', 'Anna', 1, 0, 1),
      member('u-3', 'anna', 1, 0, 1),
      member('u-4', 'Zelda', 1, 0, 1),
    ]);
    expect(reversed.map((s) => s.user_id)).toEqual(['u-2', 'u-3', 'u-1', 'u-4']);
  });

  it('group-stats rankar spelade före ospelade och jämför oavrundade poäng', async () => {
    const data = await stats([
      member('u-fresh', 'Anna', 0, 0, 0),
      member('u-8', 'Bertil', 8, 9, 9), // (8 + 4,5) / 26 = 0,4808
      member('u-0', 'Cecilia', 0, 26, 1), // 13 / 27 = 0,4815: båda visas som 0,481 men Cecilia ligger över
      member('u-lost', 'David', 0, 0, 4), // 0 poäng men har spelat: över den som inte spelat
    ]);

    expect(data.map((s) => s.user_id)).toEqual(['u-0', 'u-8', 'u-lost', 'u-fresh']);
    expect(data.slice(0, 2).map((s) => s.points)).toEqual([0.481, 0.481]);
  });

  it('group-stats behåller svarsformen och avrundade points', async () => {
    const data = await stats([member('u-1', 'Anna', 2, 0, 1), member('u-2', 'Bertil', 0, 0, 0)]);

    expect(data).toEqual([
      {
        user_id: 'u-1', name: 'Anna', wins: 2, draws: 0, losses: 1, total: 3, points: 0.667,
        challenge_active: false, has_pending_challenge: false, current_level: 4, profile_picture: null,
      },
      {
        user_id: 'u-2', name: 'Bertil', wins: 0, draws: 0, losses: 0, total: 0, points: 0,
        challenge_active: false, has_pending_challenge: false, current_level: 4, profile_picture: null,
      },
    ]);
  });
});
