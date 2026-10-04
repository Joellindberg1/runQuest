/**
 * GET /api/config/xp (ADR 007 B4) — läsbar för alla inloggade, aldrig
 * admin_password_hash. Källan är services/xpConfig.ts (EN källa, även för runs.ts).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  testDatabaseConnection: vi.fn(),
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from '../../config/database.js';
import { invalidateXpConfigCache } from '../../services/xpConfig.js';
import { DEFAULT_ADMIN_SETTINGS, DEFAULT_STREAK_MULTIPLIERS } from '@runquest/shared';
import app from '../../app.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });
beforeEach(() => { invalidateXpConfigCache(); });
afterEach(() => { vi.clearAllMocks(); });

const HASH = '$2a$10$secretSecretSecretSecretSecretSecretSecretSecretSecretSe';

/** Raden som en `select('*')` skulle ge — inkl. hemligheten som aldrig får ut. */
const adminRow = (): Row => ({
  id: 1, base_xp: 20, xp_per_km: 3, bonus_5km: 6, bonus_10km: 16, bonus_15km: 26, bonus_20km: 51,
  min_run_distance: '1.50', admin_password_hash: HASH, updated_at: '2026-09-01T00:00:00Z',
});

function useDb(tables: Record<string, Row[]>, options?: Parameters<typeof createFakeDb>[1]) {
  const db = createFakeDb(tables, options);
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return db;
}

describe('GET /api/config/xp', () => {
  it('kräver token (401) — inte publik', async () => {
    const res = await server.request('GET', '/api/config/xp');
    expect(res.status).toBe(401);
  });

  it('läcker aldrig admin_password_hash, id eller tidsstämplar — även när DB-raden innehåller dem', async () => {
    useDb({
      admin_settings: [adminRow()],
      streak_multipliers: [{ id: 7, days: 5, multiplier: '1.10' }],
    });
    const res = await server.request('GET', '/api/config/xp', { token: mintToken() });

    expect(res.status).toBe(200);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('admin_password_hash');
    expect(raw).not.toContain(HASH);
    expect(raw).not.toContain('updated_at');
    expect(Object.keys(res.body.data.settings).sort()).toEqual([
      'base_xp', 'bonus_10km', 'bonus_15km', 'bonus_20km', 'bonus_5km', 'min_run_distance', 'xp_per_km',
    ]);
  });

  it('selectar en explicit kolumnlista — aldrig * och aldrig admin_password_hash', async () => {
    const db = useDb({ admin_settings: [adminRow()], streak_multipliers: [] });
    await server.request('GET', '/api/config/xp', { token: mintToken() });
    const q = db.queries.find((x) => x.table === 'admin_settings')!;
    expect(q.select).toBe('base_xp, xp_per_km, bonus_5km, bonus_10km, bonus_15km, bonus_20km, min_run_distance');
    expect(q.select).not.toContain('*');
    expect(q.select).not.toContain('admin_password_hash');
  });

  it('ger effektiva värden som tal, multiplikatorer stigande på days och meta source db', async () => {
    useDb({
      admin_settings: [adminRow()],
      streak_multipliers: [
        { id: 2, days: 15, multiplier: '1.20' },
        { id: 1, days: 5, multiplier: '1.10' },
      ],
    });
    const res = await server.request('GET', '/api/config/xp', { token: mintToken() });
    expect(res.body).toEqual({
      success: true,
      data: {
        settings: {
          base_xp: 20, xp_per_km: 3, bonus_5km: 6, bonus_10km: 16, bonus_15km: 26, bonus_20km: 51, min_run_distance: 1.5,
        },
        streak_multipliers: [{ days: 5, multiplier: 1.1 }, { days: 15, multiplier: 1.2 }],
      },
      meta: { settings_source: 'db', multipliers_source: 'db' },
    });
  });

  it('faller tillbaka på shared-defaults per del och anger det i meta', async () => {
    useDb({ admin_settings: [], streak_multipliers: [] });
    const res = await server.request('GET', '/api/config/xp', { token: mintToken() });
    expect(res.status).toBe(200);
    expect(res.body.data.settings).toEqual(DEFAULT_ADMIN_SETTINGS);
    expect(res.body.data.streak_multipliers).toEqual(DEFAULT_STREAK_MULTIPLIERS);
    expect(res.body.meta).toEqual({ settings_source: 'defaults', multipliers_source: 'defaults' });
  });

  it('DB-fel på ena delen ger defaults för den delen och db för den andra', async () => {
    useDb(
      { admin_settings: [adminRow()], streak_multipliers: [] },
      { errors: { streak_multipliers: { message: 'down' } } },
    );
    const res = await server.request('GET', '/api/config/xp', { token: mintToken() });
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ settings_source: 'db', multipliers_source: 'defaults' });
    expect(res.body.data.settings.base_xp).toBe(20);
  });

  it('kräver inte group_id (konfigen är global)', async () => {
    useDb({ admin_settings: [adminRow()], streak_multipliers: [] });
    const res = await server.request('GET', '/api/config/xp', { token: mintToken({ group_id: null }) });
    expect(res.status).toBe(200);
  });

  it('cachar i TTL (andra anropet läser inte DB) och invalidateXpConfigCache tvingar omläsning', async () => {
    const db = useDb({ admin_settings: [adminRow()], streak_multipliers: [{ id: 1, days: 5, multiplier: 1.1 }] });
    const token = mintToken();
    await server.request('GET', '/api/config/xp', { token });
    const afterFirst = db.queries.length;
    await server.request('GET', '/api/config/xp', { token });
    expect(db.queries.length).toBe(afterFirst);

    invalidateXpConfigCache();
    await server.request('GET', '/api/config/xp', { token });
    expect(db.queries.length).toBeGreaterThan(afterFirst);
  });

  describe('invalidering vid adminändringar', () => {
    const adminToken = () => mintToken({ user_id: 'admin-1' });
    const adminTables = () => ({
      users: [{ id: 'admin-1', is_admin: true }],
      admin_settings: [adminRow()],
      streak_multipliers: [{ id: 1, days: 5, multiplier: 1.1 }],
    });

    it('PUT /auth/admin-settings gör att nästa läsning ger de nya värdena (inte 60 s gammal cache)', async () => {
      useDb(adminTables());
      const before = await server.request('GET', '/api/config/xp', { token: adminToken() });
      expect(before.body.data.settings.base_xp).toBe(20);

      const put = await server.request('PUT', '/api/auth/admin-settings', {
        token: adminToken(), body: { base_xp: 99, xp_per_km: 3 },
      });
      expect(put.status).toBe(200);

      const after = await server.request('GET', '/api/config/xp', { token: adminToken() });
      expect(after.body.data.settings.base_xp).toBe(99);
    });

    it('PUT /auth/streak-multipliers gör att nästa läsning ger de nya multiplikatorerna', async () => {
      useDb(adminTables());
      await server.request('GET', '/api/config/xp', { token: adminToken() });

      const put = await server.request('PUT', '/api/auth/streak-multipliers', {
        token: adminToken(), body: { multipliers: [{ days: 3, multiplier: 1.5 }] },
      });
      expect(put.status).toBe(200);

      const after = await server.request('GET', '/api/config/xp', { token: adminToken() });
      expect(after.body.data.streak_multipliers).toEqual([{ days: 3, multiplier: 1.5 }]);
    });
  });
});
