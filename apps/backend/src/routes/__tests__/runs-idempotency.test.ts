/**
 * Idempotensnyckel på POST /api/runs: samma Idempotency-Key skapar aldrig en andra runda (en användare som
 * skickar igen efter ett svar som aldrig nådde fram får inte en dubblett).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));
vi.mock('../../utils/calculateUserTotals.js', () => ({ calculateUserTotals: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../services/eventService.js', () => ({
  checkEventQualification: vi.fn().mockResolvedValue(undefined),
  maybeCreateEvent: vi.fn(),
  activateScheduledEvents: vi.fn(),
  settleCompetitionEvents: vi.fn(),
  settleExpiredParticipationEvents: vi.fn(),
}));
vi.mock('../../services/weatherService.js', () => ({
  WeatherService: { fetchAndSaveWeatherForRuns: vi.fn().mockResolvedValue(undefined), backfillMissingWeather: vi.fn() },
}));
vi.mock('../../services/xpConfig.js', async () => {
  const shared = await import('@runquest/shared');
  return {
    getXpConfig: vi.fn(async () => ({
      settings: shared.DEFAULT_ADMIN_SETTINGS,
      streak_multipliers: shared.DEFAULT_STREAK_MULTIPLIERS,
      meta: { settings_source: 'defaults', multipliers_source: 'defaults' },
    })),
    invalidateXpConfigCache: vi.fn(),
  };
});

import { getSupabaseClient } from '../../config/database.js';
import app from '../../app.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });
beforeEach(() => { vi.clearAllMocks(); });

const KEY = '3f2b8c1e-5d4a-4b7e-9c3a-1a2b3c4d5e6f';
const token = mintToken({ user_id: 'user-1', group_id: 'group-1' });

function use(runs: Row[] = []) {
  const tables: Record<string, Row[]> = { runs, user_boosts: [] };
  const db = createFakeDb(tables, { autoIds: true });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return tables;
}

const post = (headers: Record<string, string> = {}) =>
  server.request('POST', '/api/runs', { token, body: { date: '2026-10-02', distance: 5 }, headers });

describe('POST /api/runs med Idempotency-Key', () => {
  it('två anrop med samma nyckel ger en enda runda', async () => {
    const tables = use();
    const first = await post({ 'Idempotency-Key': KEY });
    const second = await post({ 'Idempotency-Key': KEY });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(tables.runs).toHaveLength(1);
  });
});
