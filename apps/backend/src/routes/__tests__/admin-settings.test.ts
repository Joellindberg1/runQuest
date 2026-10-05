/**
 * Admin-endpointsen för XP-inställningar och streak-trappan (issue #13).
 * Fixturerna speglar prod-schemat: id är uuid (inte 1), och admin_settings har
 * ingen kolumn streak_multipliers — multiplikatorerna bor i egen tabell (ADR 004).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
import app from '../../app.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });
beforeEach(() => { invalidateXpConfigCache(); });
afterEach(() => { vi.clearAllMocks(); });

const SETTINGS_ID = '7c1d5c3e-0b4a-4c8e-9f3a-2d6e8b1a9f00';
const HASH = '$2a$10$secretSecretSecretSecretSecretSecretSecretSecretSecretSe';
const adminToken = () => mintToken({ user_id: 'admin-1' });

const baselineColumns = (table: string): string[] => {
  const sql = readFileSync(fileURLToPath(new URL('../../../migrations/000_baseline.sql', import.meta.url)), 'utf8');
  const block = sql.match(new RegExp(`create table public\\.${table} \\(([\\s\\S]*?)\\n\\);`))?.[1] ?? '';
  return block.split('\n').map((line) => line.trim().split(/\s+/)[0]).filter((name) => /^[a-z_][a-z0-9_]*$/.test(name));
};

function tables(): Record<string, Row[]> {
  return {
    users: [{ id: 'admin-1', is_admin: true }],
    admin_settings: [{
      id: SETTINGS_ID, admin_password_hash: HASH, base_xp: 15, xp_per_km: 2, bonus_5km: 5, bonus_10km: 15,
      bonus_15km: 25, bonus_20km: 50, min_run_distance: '1.00', updated_at: '2026-09-01T00:00:00Z',
    }],
    streak_multipliers: [
      { id: 'm-5', days: 5, multiplier: '1.10' },
      { id: 'm-15', days: 15, multiplier: '1.20' },
      { id: 'm-30', days: 30, multiplier: '1.30' },
    ],
  };
}

function useDb(data: Record<string, Row[]>, options?: Parameters<typeof createFakeDb>[1]) {
  const db = createFakeDb(data, options);
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return db;
}

describe('GET/PUT /api/auth/admin-settings', () => {
  it('kräver admin', async () => {
    useDb({ ...tables(), users: [{ id: 'user-1', is_admin: false }] });
    const res = await server.request('GET', '/api/auth/admin-settings', { token: mintToken() });
    expect(res.status).toBe(403);
  });

  it('selectar bara kolumner som finns i admin_settings (ingen streak_multipliers-kolumn)', async () => {
    const db = useDb(tables());
    await server.request('GET', '/api/auth/admin-settings', { token: adminToken() });
    await server.request('PUT', '/api/auth/admin-settings', { token: adminToken(), body: { base_xp: 16, xp_per_km: 2 } });

    const real = baselineColumns('admin_settings');
    expect(real).toContain('base_xp');
    const selects = db.queries.filter((q) => q.table === 'admin_settings' && q.select && q.select !== '*');
    expect(selects.length).toBeGreaterThan(0);
    for (const q of selects) {
      for (const col of q.select!.split(',').map((c) => c.trim())) expect(real).toContain(col);
    }
  });

  it('GET ger inställningarna utan lösenordshashen', async () => {
    useDb(tables());
    const res = await server.request('GET', '/api/auth/admin-settings', { token: adminToken() });
    expect(res.status).toBe(200);
    expect(res.body.data.base_xp).toBe(15);
    expect(JSON.stringify(res.body)).not.toContain('admin_password_hash');
  });

  it('PUT uppdaterar den enda raden även när id är ett uuid', async () => {
    const data = tables();
    useDb(data);
    const res = await server.request('PUT', '/api/auth/admin-settings', {
      token: adminToken(), body: { base_xp: 18, xp_per_km: 3, bonus_5km: 6 },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.base_xp).toBe(18);
    expect(data.admin_settings[0]).toMatchObject({ base_xp: 18, xp_per_km: 3, bonus_5km: 6 });
    expect(JSON.stringify(res.body)).not.toContain('admin_password_hash');
  });

  it('PUT utan base_xp ger 400 och ändrar ingenting', async () => {
    const data = tables();
    useDb(data);
    const res = await server.request('PUT', '/api/auth/admin-settings', { token: adminToken(), body: { xp_per_km: 3 } });
    expect(res.status).toBe(400);
    expect(data.admin_settings[0].xp_per_km).toBe(2);
  });
});

describe('PUT /api/auth/streak-multipliers', () => {
  const put = (multipliers: unknown) =>
    server.request('PUT', '/api/auth/streak-multipliers', { token: adminToken(), body: { multipliers } });

  it('ersätter trappan: ändrade steg uppdateras, nya läggs till, borttagna försvinner', async () => {
    const data = tables();
    useDb(data);
    const res = await put([{ days: 5, multiplier: 1.15 }, { days: 30, multiplier: 1.3 }, { days: 60, multiplier: 1.5 }]);
    expect(res.status).toBe(200);
    const ladder = [...data.streak_multipliers].sort((a, b) => a.days - b.days).map((r) => [r.days, Number(r.multiplier)]);
    expect(ladder).toEqual([[5, 1.15], [30, 1.3], [60, 1.5]]);
  });

  it('trappan blir aldrig tom: misslyckas sparningen av nya steg finns den gamla kvar orörd', async () => {
    const data = tables();
    useDb(data, { failWhen: (q) => (q.table === 'streak_multipliers' && q.mutation === 'upsert' ? { message: 'boom' } : null) });
    const res = await put([{ days: 7, multiplier: 1.4 }]);
    expect(res.status).toBe(500);
    expect(data.streak_multipliers.map((r) => r.days)).toEqual([5, 15, 30]);
  });

  it('misslyckas borttagningen av gamla steg finns både gamla och nya kvar — aldrig en tom trappa', async () => {
    const data = tables();
    useDb(data, { failWhen: (q) => (q.table === 'streak_multipliers' && q.mutation === 'delete' ? { message: 'boom' } : null) });
    const res = await put([{ days: 7, multiplier: 1.4 }]);
    expect(res.status).toBe(500);
    expect(data.streak_multipliers.length).toBeGreaterThan(0);
    expect(data.streak_multipliers.map((r) => r.days)).toContain(7);
  });

  it.each([
    ['inte en lista', 'nope'],
    ['tom lista', []],
    ['dubbla dagar', [{ days: 5, multiplier: 1.1 }, { days: 5, multiplier: 1.2 }]],
    ['dag under 1', [{ days: 0, multiplier: 1.1 }]],
    ['dag som inte är heltal', [{ days: 2.5, multiplier: 1.1 }]],
    ['multiplikator under 1', [{ days: 5, multiplier: 0.9 }]],
    ['multiplikator som inte är tal', [{ days: 5, multiplier: 'mycket' }]],
  ])('avvisar %s med 400 utan att röra tabellen', async (_label, body) => {
    const data = tables();
    const db = useDb(data);
    const res = await put(body);
    expect(res.status).toBe(400);
    expect(data.streak_multipliers.map((r) => r.days)).toEqual([5, 15, 30]);
    expect(db.queries.some((q) => q.table === 'streak_multipliers' && q.mutation)).toBe(false);
  });
});
