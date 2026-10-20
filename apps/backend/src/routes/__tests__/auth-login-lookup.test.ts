/**
 * Login ska göra lika många databasuppslag oavsett utfall (annars skiljer sig svarstiden med en rundtur mellan känt och
 * okänt konto), utan att ändra vem som hittas: e-post först, sedan namn, exakt matchning, e-post vinner över namn.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

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
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });

const user = (id: string, name: string, email: string): Row => ({
  id, name, email, password_hash: `$2a$10$FAKE_HASH_of_${id}_for_tests_only_not_real_xxxxxxxxxxxx`, is_admin: false, group_id: null,
});

const USERS: Row[] = [
  user('u-alice', 'Alice', 'alice@example.com'),
  user('u-bob', 'Bob', 'bob@example.com'),
  // Någons namn som också är en annan persons e-postadress: e-posten ska vinna.
  user('u-carol', 'carol@example.com', 'carol-real@example.com'),
  user('u-dave', 'Dave', 'carol@example.com'),
];

function useDb(options: Parameters<typeof createFakeDb>[1] = {}) {
  const db = createFakeDb({ users: USERS }, options);
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as never);
  return db;
}

const login = (identifier: { email?: string; name?: string }) =>
  server.request('POST', '/api/auth/login', { body: { ...identifier, password: 'whatever-password' } });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(bcrypt.hash).mockResolvedValue('$2a$10$FAKE_DUMMY_HASH_for_tests_only_not_a_real_hash_xxxxxxxxxxxx' as never);
  vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
});

describe('POST /api/auth/login lookups', () => {
  it('makes the same number of lookups for a known account by email, a known account by name, an unknown account and a database error', async () => {
    const counts: number[] = [];
    for (const [identifier, options] of [
      [{ email: 'alice@example.com' }, {}],
      [{ name: 'Bob' }, {}],
      [{ email: 'ghost@example.com' }, {}],
      [{ email: 'alice@example.com' }, { errors: { users: { message: 'connection reset' } } }],
    ] as const) {
      const db = useDb(options);
      await login(identifier);
      counts.push(db.queries.filter((q) => q.table === 'users').length);
    }

    expect(new Set(counts).size).toBe(1);
    expect(counts[0]).toBeGreaterThan(0);
  });

  it('finds a user by email', async () => {
    useDb();
    const { status, body } = await login({ email: 'alice@example.com' });

    expect(status).toBe(200);
    expect(body.user.id).toBe('u-alice');
  });

  it('finds a user by name', async () => {
    useDb();
    const { status, body } = await login({ name: 'Bob' });

    expect(status).toBe(200);
    expect(body.user.id).toBe('u-bob');
  });

  it('lets an email win over a name when the same text is both', async () => {
    useDb();
    const { status, body } = await login({ email: 'carol@example.com' });

    expect(status).toBe(200);
    expect(body.user.id).toBe('u-dave');
  });

  it('matches exactly, so a different letter case finds nobody', async () => {
    const db = useDb();
    for (const identifier of [{ email: 'ALICE@example.com' }, { name: 'alice' }, { name: 'BOB' }]) {
      const { status } = await login(identifier);
      expect(status).toBe(401);
    }
    const values = db.queries.flatMap((q) => q.filters.map((f) => f.value));
    expect(values).toEqual(expect.arrayContaining(['ALICE@example.com', 'alice', 'BOB']));
    expect(values).not.toContain('alice@example.com');
  });

  it('passes the input as one parameterised value, never as part of a filter expression', async () => {
    const db = useDb();
    const hostile = 'x,id.neq.0),or(email.like.%';
    const { status } = await login({ email: hostile });

    expect(status).toBe(401);
    for (const q of db.queries) {
      expect(q.filters.every((f) => f.op === 'eq')).toBe(true);
      expect(q.filters.map((f) => f.value)).toEqual([hostile]);
    }
  });

  it('treats a failing name lookup as no match, and ignores it after an email hit', async () => {
    useDb({ failWhen: (q) => (q.filters.some((f) => f.column === 'name') ? { message: 'name lookup failed' } : null) });

    const byEmail = await login({ email: 'alice@example.com' });
    const byName = await login({ name: 'Bob' });

    expect(byEmail.status).toBe(200);
    expect(byEmail.body.user.id).toBe('u-alice');
    expect(byName.status).toBe(401);
  });
});
