/** GET /api/admin/waitlist: bara för admin; nyast först; bara de fyra fälten som listan behöver. */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from '../../config/database.js';
import app from '../../app.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });
afterEach(() => { vi.clearAllMocks(); });

const signups = (): Row[] => [
  { id: 'w-1', email: 'first@example.com', created_at: '2026-10-01T08:00:00.000Z', source: 'landing', consent_version: 'draft-2026-10-13' },
  { id: 'w-3', email: 'third@example.com', created_at: '2026-10-03T08:00:00.000Z', source: 'landing', consent_version: 'draft-2026-10-13' },
  { id: 'w-2', email: 'second@example.com', created_at: '2026-10-02T08:00:00.000Z', source: 'landing', consent_version: 'draft-2026-10-13' },
];

function useDb(users: Row[], waitlist: Row[] = signups(), options?: Parameters<typeof createFakeDb>[1]) {
  const db = createFakeDb({ users, waitlist_signups: waitlist }, options);
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return db;
}

describe('GET /api/admin/waitlist', () => {
  it('admin waitlist list requires admin (401 without token, 403 for a regular user)', async () => {
    useDb([{ id: 'user-1', is_admin: false }, { id: 'admin-1', is_admin: true }]);

    const anonymous = await server.request('GET', '/api/admin/waitlist');
    expect(anonymous.status).toBe(401);
    expect(JSON.stringify(anonymous.body)).not.toContain('@example.com');

    const regular = await server.request('GET', '/api/admin/waitlist', { token: mintToken({ user_id: 'user-1' }) });
    expect(regular.status).toBe(403);
    expect(JSON.stringify(regular.body)).not.toContain('@example.com');

    const admin = await server.request('GET', '/api/admin/waitlist', { token: mintToken({ user_id: 'admin-1' }) });
    expect(admin.status).toBe(200);
  });

  it('admin waitlist list returns signups newest first with total', async () => {
    useDb([{ id: 'admin-1', is_admin: true }]);
    const res = await server.request('GET', '/api/admin/waitlist', { token: mintToken({ user_id: 'admin-1' }) });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: {
        total: 3,
        entries: [
          { id: 'w-3', email: 'third@example.com', created_at: '2026-10-03T08:00:00.000Z', source: 'landing' },
          { id: 'w-2', email: 'second@example.com', created_at: '2026-10-02T08:00:00.000Z', source: 'landing' },
          { id: 'w-1', email: 'first@example.com', created_at: '2026-10-01T08:00:00.000Z', source: 'landing' },
        ],
      },
    });
  });

  it('admin waitlist list returns an empty list with total 0 when nobody has signed up', async () => {
    useDb([{ id: 'admin-1', is_admin: true }], []);
    const res = await server.request('GET', '/api/admin/waitlist', { token: mintToken({ user_id: 'admin-1' }) });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { entries: [], total: 0 } });
  });

  it('admin waitlist list answers 500 without details when the read fails', async () => {
    useDb([{ id: 'admin-1', is_admin: true }], signups(), { errors: { waitlist_signups: { message: 'secret detail first@example.com' } } });
    const res = await server.request('GET', '/api/admin/waitlist', { token: mintToken({ user_id: 'admin-1' }) });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: expect.any(String) });
    expect(JSON.stringify(res.body)).not.toContain('first@example.com');
  });
});
