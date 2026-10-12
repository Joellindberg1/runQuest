/**
 * GET /api/config/levels (RUN-110, ADR 004/007) — nivåtabellen via backenden så att
 * frontenden slipper läsa level_requirements direkt med anon-nyckeln.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from '../../config/database.js';
import { levelService } from '../../services/levelService.js';
import { FALLBACK_LEVEL_REQUIREMENTS, type LevelsApiResponse } from '@runquest/shared';
import app from '../../app.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });

// levelService är en singleton med init-cache; varje test startar från kall cache.
const resetLevelService = () => {
  (levelService as any).initialized = false;
  (levelService as any).levelRequirements = [];
};
beforeEach(resetLevelService);
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); resetLevelService(); });

function useDb(tables: Record<string, Row[]>, options?: Parameters<typeof createFakeDb>[1]) {
  const db = createFakeDb(tables, options);
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return db;
}

describe('GET /api/config/levels', () => {
  it('kräver token (401) — inte publik', async () => {
    const res = await server.request('GET', '/api/config/levels');
    expect(res.status).toBe(401);
  });

  it('ger alla rader som { success, data: [{ level, xp_required }] } sorterat på level', async () => {
    useDb({
      level_requirements: [
        { level: 3, xp_required: 102, id: 'x3', created_at: '2026-01-01' },
        { level: 1, xp_required: 0, id: 'x1', created_at: '2026-01-01' },
        { level: 2, xp_required: 50, id: 'x2', created_at: '2026-01-01' },
      ],
    });
    const res = await server.request('GET', '/api/config/levels', { token: mintToken() });
    expect(res.status).toBe(200);
    const body: LevelsApiResponse = res.body;
    expect(body).toEqual({
      success: true,
      data: [
        { level: 1, xp_required: 0 },
        { level: 2, xp_required: 50 },
        { level: 3, xp_required: 102 },
      ],
    });
  });

  it('sorterar på level även om servicen skulle ge osorterat, och släpper igenom bara level + xp_required', async () => {
    vi.spyOn(levelService, 'getAllLevelRequirements').mockResolvedValue([
      { level: 2, xp_required: 50, secret: 'nej' } as any,
      { level: 1, xp_required: 0 },
    ]);
    const res = await server.request('GET', '/api/config/levels', { token: mintToken() });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ level: 1, xp_required: 0 }, { level: 2, xp_required: 50 }]);
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });

  it('kräver inte group_id (nivåtabellen är global)', async () => {
    useDb({ level_requirements: [{ level: 1, xp_required: 0 }] });
    const res = await server.request('GET', '/api/config/levels', { token: mintToken({ group_id: null }) });
    expect(res.status).toBe(200);
  });

  it('DB-fel i läsningen ger servicens fallback-tabell (ADR 004), inte 500', async () => {
    useDb({ level_requirements: [] }, { errors: { level_requirements: { message: 'down' } } });
    const res = await server.request('GET', '/api/config/levels', { token: mintToken() });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(FALLBACK_LEVEL_REQUIREMENTS);
  });

  it('oväntat fel i servicen ger 500 { error } utan detaljer', async () => {
    vi.spyOn(levelService, 'getAllLevelRequirements').mockRejectedValue(
      new Error('connect ECONNREFUSED db.internal:5432 password=hunter2'),
    );
    const res = await server.request('GET', '/api/config/levels', { token: mintToken() });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to fetch level requirements' });
    expect(JSON.stringify(res.body)).not.toContain('ECONNREFUSED');
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });
});
