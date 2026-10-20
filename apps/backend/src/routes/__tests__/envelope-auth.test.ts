/**
 * Kuvertet i auth-routrarna, steg 1 (ADR 007 Addendum 2026-10-20): varje svar bär `success`, varje fel bär `code`, och de gamla toppnivånycklarna ligger kvar
 * bredvid `data` (dubbelsvar). Ett test per kuvertvariant visar BÅDA formerna: den gamla klientens nycklar och den nya klientens `data`.
 * Säkerhet (punkt 5): login svarar byte för byte lika för okänt konto, fel lösenord och databasfel.
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
import { invalidateXpConfigCache } from '../../services/xpConfig.js';
import app from '../../app.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });

const GROUP = 'group-1';
const SETTINGS_ID = '7c1d5c3e-0b4a-4c8e-9f3a-2d6e8b1a9f00';

function tables(): Record<string, Row[]> {
  return {
    users: [
      { id: 'user-1', name: 'Alice', email: 'alice@example.com', password_hash: '$2a$10$FAKE_HASH_for_tests_only_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', is_admin: false, group_id: GROUP },
      { id: 'admin-1', name: 'Boss', email: 'boss@example.com', password_hash: '$2a$10$FAKE_HASH_for_tests_only_yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy', is_admin: true, group_id: GROUP },
    ],
    admin_settings: [{
      id: SETTINGS_ID, base_xp: 15, xp_per_km: 2, bonus_5km: 5, bonus_10km: 15, bonus_15km: 25, bonus_20km: 50, min_run_distance: '1.00', updated_at: '2026-09-01T00:00:00Z',
    }],
    streak_multipliers: [{ id: 'm-5', days: 5, multiplier: '1.10' }],
  };
}

let data: Record<string, Row[]>;
function useDb(initial: Record<string, Row[]> = tables(), options?: Parameters<typeof createFakeDb>[1]) {
  data = initial;
  const db = createFakeDb(data, options);
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as never);
  return db;
}

beforeEach(() => {
  vi.resetAllMocks();
  invalidateXpConfigCache();
  vi.mocked(bcrypt.hash).mockResolvedValue('$2a$10$FAKE_NEW_HASH_for_tests_only_not_a_real_hash_xxxxxxxxxxxx' as never);
  vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
});

const userToken = () => mintToken({ user_id: 'user-1', group_id: GROUP });
const adminToken = () => mintToken({ user_id: 'admin-1', group_id: GROUP });

describe('POST /api/auth/login', () => {
  it('answers the double envelope: token and user at the top level (old client) and in data (new client)', async () => {
    useDb();
    const res = await server.request('POST', '/api/auth/login', { body: { email: 'alice@example.com', password: 'right-password' } });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.user).toEqual({ id: 'user-1', name: 'Alice', email: 'alice@example.com', is_admin: false });
    expect(res.body.data).toEqual({ token: res.body.token, user: res.body.user });
    expect(Object.keys(res.body).sort()).toEqual(['data', 'success', 'token', 'user']);
  });

  it('answers byte for byte the same 401 invalid_credentials for an unknown account, a wrong password and a database error', async () => {
    useDb();
    const unknown = await server.request('POST', '/api/auth/login', { body: { email: 'nobody@example.com', password: 'whatever-password' } });

    vi.mocked(bcrypt.compare).mockResolvedValue(false as never);
    const wrong = await server.request('POST', '/api/auth/login', { body: { email: 'alice@example.com', password: 'wrong-password' } });

    useDb(tables(), { errors: { users: { message: 'connection reset by peer with row values alice@example.com' } } });
    const broken = await server.request('POST', '/api/auth/login', { body: { email: 'alice@example.com', password: 'whatever-password' } });

    const expected = { success: false, error: 'Invalid credentials', code: 'invalid_credentials' };
    for (const res of [unknown, wrong, broken]) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual(expected);
    }
    expect(JSON.stringify(unknown.body)).toBe(JSON.stringify(wrong.body));
    expect(JSON.stringify(unknown.body)).toBe(JSON.stringify(broken.body));
  });

  it('does the same bcrypt work for an unknown account, a wrong password and a database error (the timing of the login is unchanged)', async () => {
    useDb();
    await server.request('POST', '/api/auth/login', { body: { email: 'nobody@example.com', password: 'p' } });
    const unknownCalls = vi.mocked(bcrypt.compare).mock.calls.length;

    vi.mocked(bcrypt.compare).mockClear();
    vi.mocked(bcrypt.compare).mockResolvedValue(false as never);
    await server.request('POST', '/api/auth/login', { body: { email: 'alice@example.com', password: 'p' } });
    const wrongCalls = vi.mocked(bcrypt.compare).mock.calls.length;

    vi.mocked(bcrypt.compare).mockClear();
    useDb(tables(), { errors: { users: { message: 'down' } } });
    await server.request('POST', '/api/auth/login', { body: { email: 'alice@example.com', password: 'p' } });
    const brokenCalls = vi.mocked(bcrypt.compare).mock.calls.length;

    expect([unknownCalls, wrongCalls, brokenCalls]).toEqual([1, 1, 1]);
  });

  it('answers 400 with the default code for a missing field', async () => {
    useDb();
    const res = await server.request('POST', '/api/auth/login', { body: { email: 'alice@example.com' } });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'Name/email and password required', code: 'invalid_request' });
  });
});

describe('POST /api/auth/change-password', () => {
  it('answers { success, message } with data: null next to it', async () => {
    useDb();
    const res = await server.request('POST', '/api/auth/change-password', { token: userToken(), body: { currentPassword: 'old-password', newPassword: 'new-password-1' } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'Password changed successfully', data: null });
  });

  it('answers 401 current_password_incorrect for a wrong current password (does not log the session out)', async () => {
    useDb();
    vi.mocked(bcrypt.compare).mockResolvedValue(false as never);
    const res = await server.request('POST', '/api/auth/change-password', { token: userToken(), body: { currentPassword: 'wrong', newPassword: 'new-password-1' } });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ success: false, error: 'Current password is incorrect', code: 'current_password_incorrect' });
  });
});

describe('the authentication middleware', () => {
  it('answers 401 unauthorized for a missing header and a missing token', async () => {
    useDb();
    const none = await server.request('GET', '/api/auth/users-with-runs');
    expect(none.status).toBe(401);
    expect(none.body).toEqual({ success: false, error: 'Authorization header required', code: 'unauthorized' });

    const empty = await server.request('GET', '/api/auth/users-with-runs', { headers: { Authorization: 'Bearer' } });
    expect(empty.status).toBe(401);
    expect(empty.body).toEqual({ success: false, error: 'Token required', code: 'unauthorized' });
  });

  it('answers 401 token_invalid for an invalid token: the code the client logs the session out on', async () => {
    useDb();
    const res = await server.request('GET', '/api/auth/users-with-runs', { token: 'not-a-real-token' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ success: false, error: 'Invalid token', code: 'token_invalid' });
  });

  it('answers 403 admin_required for a non-admin on an admin route', async () => {
    useDb();
    const res = await server.request('GET', '/api/auth/admin-settings', { token: userToken() });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ success: false, error: 'Admin access required', code: 'admin_required' });
  });

  it('answers 500 internal_error with a fixed text when the admin check cannot read the database', async () => {
    useDb(tables(), { errors: { users: { message: 'secret row value 12345678901' } } });
    const res = await server.request('GET', '/api/auth/admin-settings', { token: adminToken() });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to verify admin status', code: 'internal_error' });
  });
});

describe('POST /api/auth/recalculate-totals', () => {
  it('answers the double envelope: message, userId and timestamp at the top level, userId and timestamp in data', async () => {
    useDb();
    const res = await server.request('POST', '/api/auth/recalculate-totals', { token: userToken() });
    // utan runs-tabell är omräkningen en no-op i fakeDb; det som prövas här är formen
    if (res.status === 200) {
      expect(res.body).toMatchObject({ success: true, message: 'User totals recalculated successfully', userId: 'user-1' });
      expect(res.body.data).toEqual({ userId: 'user-1', timestamp: res.body.timestamp });
    } else {
      expect(res.body).toEqual({ success: false, error: 'Failed to recalculate user totals', code: 'internal_error' });
    }
  });
});

describe('PUT /api/auth/admin-settings and /api/auth/streak-multipliers', () => {
  it('answers the settings row in data and keeps the old message next to it', async () => {
    useDb();
    const res = await server.request('PUT', '/api/auth/admin-settings', { token: adminToken(), body: { base_xp: 16, xp_per_km: 2 } });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Admin settings updated successfully');
    expect(res.body.data).toMatchObject({ id: SETTINGS_ID, base_xp: 16 });
  });

  it('answers the ladder in data and keeps the old message next to it', async () => {
    useDb();
    const res = await server.request('PUT', '/api/auth/streak-multipliers', { token: adminToken(), body: { multipliers: [{ days: 5, multiplier: 1.1 }, { days: 10, multiplier: 1.2 }] } });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Streak multipliers updated successfully');
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('answers 400 invalid_request with the validation text built from the caller input', async () => {
    useDb();
    const res = await server.request('PUT', '/api/auth/streak-multipliers', { token: adminToken(), body: { multipliers: [] } });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'multipliers must be a non-empty array', code: 'invalid_request' });
  });
});

describe('PUT /api/auth/me/displayed-titles and PUT /api/auth/users/:id/password', () => {
  it('answers { success, data: null } for the displayed titles', async () => {
    useDb();
    const res = await server.request('PUT', '/api/auth/me/displayed-titles', { token: userToken(), body: { title_ids: [] } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: null });
  });

  it('answers { success, message } with data: null next to it for the password reset', async () => {
    useDb();
    const res = await server.request('PUT', '/api/auth/users/00000000-0000-4000-8000-000000000001/password', { token: adminToken(), body: { newPassword: 'new-password-1' } });
    // användaren finns inte i fixturen: 404 med standardkoden; formen är det som prövas
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'User not found', code: 'not_found' });

    data.users.push({ id: '00000000-0000-4000-8000-000000000001', name: 'Target', email: 't@example.com', password_hash: 'x', group_id: GROUP });
    const ok = await server.request('PUT', '/api/auth/users/00000000-0000-4000-8000-000000000001/password', { token: adminToken(), body: { newPassword: 'new-password-1' } });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ success: true, message: 'Password reset successfully', data: null });
  });

  it('answers the same 404 for a user in another group as for an id that does not exist, byte for byte', async () => {
    useDb();
    data.users.push({ id: '00000000-0000-4000-8000-0000000000aa', name: 'Other', email: 'o@example.com', password_hash: 'x', group_id: 'group-2' });
    const otherGroup = await server.request('PUT', '/api/auth/users/00000000-0000-4000-8000-0000000000aa/password', { token: adminToken(), body: { newPassword: 'new-password-1' } });
    const missing = await server.request('PUT', '/api/auth/users/00000000-0000-4000-8000-0000000000bb/password', { token: adminToken(), body: { newPassword: 'new-password-1' } });
    expect(otherGroup.status).toBe(404);
    expect(JSON.stringify(otherGroup.body)).toBe(JSON.stringify(missing.body));
    expect(otherGroup.body).toEqual({ success: false, error: 'User not found', code: 'not_found' });
  });
});

describe('admin without a group', () => {
  it('answers 403 group_required for a write and 200 with empty data for a read', async () => {
    useDb();
    const token = mintToken({ user_id: 'admin-1', group_id: null });
    const write = await server.request('POST', '/api/auth/users', { token, body: { name: 'New', email: 'n@example.com', password: 'password-123' } });
    expect(write.status).toBe(403);
    expect(write.body).toEqual({ success: false, error: 'Admin must belong to a group', code: 'group_required' });

    const read = await server.request('GET', '/api/auth/users', { token });
    expect(read.status).toBe(200);
    expect(read.body).toEqual({ success: true, data: [] });
  });
});

describe('POST /api/auth/users', () => {
  it('answers 409 user_exists with one text for a name and an e-mail that already exist', async () => {
    useDb();
    const byName = await server.request('POST', '/api/auth/users', { token: adminToken(), body: { name: 'Alice', email: 'new@example.com', password: 'password-123' } });
    const byEmail = await server.request('POST', '/api/auth/users', { token: adminToken(), body: { name: 'Newname', email: 'alice@example.com', password: 'password-123' } });
    expect(byName.status).toBe(409);
    expect(byName.body).toEqual({ success: false, error: 'User with this name or email already exists', code: 'user_exists' });
    expect(JSON.stringify(byName.body)).toBe(JSON.stringify(byEmail.body));
  });
});
