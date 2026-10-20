/**
 * Login ska göra samma bcrypt-arbete oavsett utfall, annars skiljer sig svarstiden mellan
 * okänt konto och fel lösenord. Beviset är antalet anrop till bcrypt.compare, aldrig väggklocka.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.JWT_EXPIRES_IN = '1h';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

vi.mock('bcryptjs', () => ({
  default: { compare: vi.fn(), hash: vi.fn() },
  compare: vi.fn(),
  hash: vi.fn(),
}));

import { getSupabaseClient } from '../../config/database.js';
import bcrypt from 'bcryptjs';
import app from '../../app.js';

const FAKE_DUMMY_HASH = '$2a$10$FAKE_DUMMY_HASH_for_tests_only_not_a_real_hash_xxxxxxxxxxxx';
const FAKE_USER_HASH = '$2a$10$FAKE_USER_HASH_for_tests_only_not_a_real_hash_yyyyyyyyyyyyy';

let server: http.Server;
let port: number;

function post(path: string, body: unknown): Promise<{ status: number; raw: string }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1', port, path, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, raw }));
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

beforeAll(() => new Promise<void>((resolve) => {
  server = http.createServer(app);
  server.listen(0, '127.0.0.1', () => {
    port = (server.address() as { port: number }).port;
    resolve();
  });
}));

afterAll(() => new Promise<void>((resolve) => { server.close(() => resolve()); }));

function stubLookup(limitResult: { data: unknown[] | null; error: unknown }) {
  return {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(limitResult),
  };
}

const unknownAccount = () => stubLookup({ data: [], error: null });
const wrongPassword = () => stubLookup({
  data: [{ id: 'user-uuid-1', name: 'Alice', email: 'alice@example.com', password_hash: FAKE_USER_HASH, is_admin: false, group_id: null }],
  error: null,
});
const lookupFails = () => stubLookup({ data: null, error: { message: 'connection reset', code: '08006' } });

const cases: Array<[string, () => ReturnType<typeof stubLookup>]> = [
  ['unknown account', unknownAccount],
  ['wrong password', wrongPassword],
  ['database error in the lookup', lookupFails],
];

describe('POST /api/auth/login bcrypt work', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(bcrypt.hash).mockResolvedValue(FAKE_DUMMY_HASH as never);
    vi.mocked(bcrypt.compare).mockResolvedValue(false as never);
  });

  it.each(cases)('calls bcrypt.compare exactly once for %s', async (_label, makeStub) => {
    vi.mocked(getSupabaseClient).mockReturnValue(makeStub() as never);

    await post('/api/auth/login', { email: 'someone@example.com', password: 'a-wrong-password' });

    expect(vi.mocked(bcrypt.compare)).toHaveBeenCalledTimes(1);
  });

  it('answers byte-identically for unknown account, wrong password and database error', async () => {
    const answers: Array<{ status: number; raw: string }> = [];
    for (const [, makeStub] of cases) {
      vi.mocked(getSupabaseClient).mockReturnValue(makeStub() as never);
      answers.push(await post('/api/auth/login', { email: 'someone@example.com', password: 'a-wrong-password' }));
    }

    expect(answers[0].status).toBe(401);
    expect(answers[0].raw).toBe(JSON.stringify({ error: 'Invalid credentials' }));
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
  });

  it('compares against the fixed dummy hash when the account is unknown or the lookup fails', async () => {
    for (const makeStub of [unknownAccount, lookupFails]) {
      vi.mocked(getSupabaseClient).mockReturnValue(makeStub() as never);
      vi.mocked(bcrypt.compare).mockClear();

      await post('/api/auth/login', { email: 'someone@example.com', password: 'a-wrong-password' });

      expect(vi.mocked(bcrypt.compare)).toHaveBeenCalledWith('a-wrong-password', FAKE_DUMMY_HASH);
    }
  });

  it('compares against the real hash when the account exists', async () => {
    vi.mocked(getSupabaseClient).mockReturnValue(wrongPassword() as never);

    await post('/api/auth/login', { email: 'alice@example.com', password: 'a-wrong-password' });

    expect(vi.mocked(bcrypt.compare)).toHaveBeenCalledWith('a-wrong-password', FAKE_USER_HASH);
  });
});
