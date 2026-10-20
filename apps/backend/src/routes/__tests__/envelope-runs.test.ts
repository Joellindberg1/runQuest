/**
 * Kuvertet i /api/runs, steg 1 (ADR 007 Addendum 2026-10-20): `success` på varje svar, `code` på varje fel, och de gamla nycklarna (`runs`, `run`, `message`) kvar bredvid
 * `data` (dubbelsvar). `written: true` finns kvar bredvid koden `recalc_failed_after_write`. Ett test per kuvertvariant visar BÅDA formerna.
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
import { createFakeDb, type RecordedQuery, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });
beforeEach(() => { vi.clearAllMocks(); });

const token = mintToken({ user_id: 'user-1', group_id: 'group-1' });
const KEY = '3f2b8c1e-5d4a-4b7e-9c3a-1a2b3c4d5e6f';

const run = (over: Row = {}): Row => ({
  id: 'run-1', user_id: 'user-1', date: '2026-10-01', distance: 4, streak_day: 1, xp_gained: 0, multiplier: 1, base_xp: 0, km_xp: 0, distance_bonus: 0, streak_bonus: 0,
  source: 'manual', external_id: null, created_at: '2026-10-01T10:00:00Z', start_time: null, is_treadmill: null, ...over,
});

function use(tables: Record<string, Row[]> = {}, failWhen?: (q: RecordedQuery) => { message: string; code?: string } | null) {
  const data: Record<string, Row[]> = {
    runs: [run(), run({ id: 'run-2', date: '2026-10-02' })],
    users: [{ id: 'user-1', name: 'Alice', current_level: 3, total_xp: 100, profile_picture: null, group_id: 'group-1' }],
    user_boosts: [], event_entries: [], run_weather: [],
    ...tables,
  };
  const db = createFakeDb(data, { autoIds: true, failWhen });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as never);
  return data;
}

const reprocessUpdateFails = (q: RecordedQuery) => (q.table === 'runs' && q.mutation === 'update' ? { message: 'update failed with row value 12345678901' } : null);

describe('GET /api/runs/group-history', () => {
  it('answers the runs at the top level (old client) and in data (new client), with meta next to both', async () => {
    use({ runs: [run({ users: { name: 'Alice', current_level: 3, profile_picture: null, total_xp: 100, group_id: 'group-1' } })] });
    const res = await server.request('GET', '/api/runs/group-history', { token });
    if (res.status !== 200) throw new Error(`oväntat svar ${res.status}: ${JSON.stringify(res.body)}`);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.runs)).toBe(true);
    expect(res.body.data).toEqual({ runs: res.body.runs });
    expect(res.body.meta).toMatchObject({ limit: 100, offset: 0 });
    expect(Object.keys(res.body).sort()).toEqual(['data', 'meta', 'runs', 'success']);
  });

  it('answers 200 with empty data in the new envelope for a token without a group (fail-closed, not an error)', async () => {
    use();
    const res = await server.request('GET', '/api/runs/group-history', { token: mintToken({ user_id: 'user-1', group_id: null }) });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, runs: [], data: { runs: [] }, meta: { total: 0, limit: 100, offset: 0, has_more: false } });
  });

  it('answers 400 invalid_request with the validation text for a bad page', async () => {
    use();
    const res = await server.request('GET', '/api/runs/group-history?limit=0', { token });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, code: 'invalid_request' });
    expect(typeof res.body.error).toBe('string');
  });
});

describe('POST /api/runs', () => {
  it('answers message and run at the top level (old client) and run in data (new client)', async () => {
    use({ runs: [] });
    const res = await server.request('POST', '/api/runs', { token, body: { date: '2026-10-01', distance: 5 } });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Run created successfully');
    expect(res.body.run).toMatchObject({ distance: 5 });
    expect(res.body.data).toEqual({ run: res.body.run });
    expect(Object.keys(res.body).sort()).toEqual(['data', 'message', 'run', 'success']);
  });

  it('answers the same double envelope, status and run for an idempotent replay', async () => {
    const data = use({ runs: [] });
    const first = await server.request('POST', '/api/runs', { token, body: { date: '2026-10-01', distance: 5 }, headers: { 'Idempotency-Key': KEY } });
    const second = await server.request('POST', '/api/runs', { token, body: { date: '2026-10-01', distance: 5 }, headers: { 'Idempotency-Key': KEY } });
    expect(data.runs).toHaveLength(1);
    expect(second.status).toBe(first.status);
    expect(second.body.success).toBe(true);
    expect(second.body.data).toEqual({ run: second.body.run });
    expect(second.body.message).toBe(first.body.message);
    expect(second.body.run.id).toBe(first.body.run.id);
  });

  it('answers 500 recalc_failed_after_write with written: true next to it when the row was written but the recalculation failed', async () => {
    use({ runs: [] }, reprocessUpdateFails);
    const res = await server.request('POST', '/api/runs', { token, body: { date: '2026-10-01', distance: 5 } });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Run was created but XP recalculation failed', code: 'recalc_failed_after_write', written: true });
    expect(JSON.stringify(res.body)).not.toContain('12345678901');
  });

  it('answers a plain 500 internal_error without written when nothing was written', async () => {
    use({ runs: [] }, (q) => (q.table === 'runs' && q.mutation === 'insert' ? { message: 'insert failed' } : null));
    const res = await server.request('POST', '/api/runs', { token, body: { date: '2026-10-01', distance: 5 } });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to create run', code: 'internal_error' });
    expect(res.body).not.toHaveProperty('written');
  });

  it('answers 400 invalid_request for validation errors, including the Idempotency-Key format', async () => {
    use({ runs: [] });
    const missing = await server.request('POST', '/api/runs', { token, body: { date: '2026-10-01' } });
    expect(missing.status).toBe(400);
    expect(missing.body).toEqual({ success: false, error: 'Date and distance are required', code: 'invalid_request' });

    const badKey = await server.request('POST', '/api/runs', { token, body: { date: '2026-10-01', distance: 5 }, headers: { 'Idempotency-Key': 'not-a-uuid' } });
    expect(badKey.status).toBe(400);
    expect(badKey.body).toEqual({ success: false, error: 'Idempotency-Key must be a UUID v4', code: 'invalid_request' });
  });
});

describe('PUT /api/runs/:id', () => {
  it('answers message and run at the top level and run in data', async () => {
    use({ runs: [run({ source: 'manual' })] });
    const res = await server.request('PUT', '/api/runs/run-1', { token, body: { distance: 9, date: '2026-10-01' } });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Run updated successfully');
    expect(res.body.data).toEqual({ run: res.body.run });
    expect(res.body.run).toMatchObject({ id: 'run-1' });
  });

  it('answers 500 recalc_failed_after_write with written: true when the recalculation failed after the update', async () => {
    let n = 0;
    use({ runs: [run({ source: 'manual' }), run({ id: 'run-2', date: '2026-10-02', source: 'manual' })] },
      (q) => (q.table === 'runs' && q.mutation === 'update' && ++n > 1 ? { message: 'update failed' } : null));
    const res = await server.request('PUT', '/api/runs/run-1', { token, body: { distance: 9, date: '2026-10-01' } });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Run was updated but XP recalculation failed', code: 'recalc_failed_after_write', written: true });
  });

  it('keeps 404 not_found, 403 forbidden and 409 strava_read_only apart, with their present statuses', async () => {
    use({ runs: [run({ id: 'mine', source: 'manual' }), run({ id: 'theirs', user_id: 'user-2', source: 'manual' }), run({ id: 'strava-run', source: 'strava' })] });
    const missing = await server.request('PUT', '/api/runs/nope', { token, body: { distance: 9 } });
    const foreign = await server.request('PUT', '/api/runs/theirs', { token, body: { distance: 9 } });
    const strava = await server.request('PUT', '/api/runs/strava-run', { token, body: { distance: 9 } });
    expect([missing.status, foreign.status, strava.status]).toEqual([404, 403, 409]);
    expect(missing.body).toEqual({ success: false, error: 'Run not found', code: 'not_found' });
    expect(foreign.body).toEqual({ success: false, error: 'Not authorized to update this run', code: 'forbidden' });
    expect(strava.body).toEqual({ success: false, error: 'Strava runs are read-only', code: 'strava_read_only' });
  });
});

describe('DELETE /api/runs/:id', () => {
  it('answers message at the top level and data: null next to it', async () => {
    use({ runs: [run({ source: 'manual' })] });
    const res = await server.request('DELETE', '/api/runs/run-1', { token });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'Run deleted successfully', data: null });
  });

  it('answers 409 run_qualified_event for a run that qualified an event', async () => {
    use({ runs: [run({ source: 'manual' })], event_entries: [{ id: 'entry-1', run_id: 'run-1' }] });
    const res = await server.request('DELETE', '/api/runs/run-1', { token });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ success: false, error: "This run qualified an event and can't be deleted — edit it instead", code: 'run_qualified_event' });
  });

  it('answers 500 recalc_failed_after_write with written: true when the recalculation failed after the delete', async () => {
    use({ runs: [run({ source: 'manual' }), run({ id: 'run-2', date: '2026-10-02', source: 'manual' })] }, reprocessUpdateFails);
    const res = await server.request('DELETE', '/api/runs/run-1', { token });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Run was deleted but XP recalculation failed', code: 'recalc_failed_after_write', written: true });
  });

  it('keeps 404 not_found for an unknown run and 403 forbidden for another user run (the difference exists today and is kept)', async () => {
    use({ runs: [run({ id: 'theirs', user_id: 'user-9', source: 'manual' })] });
    const missing = await server.request('DELETE', '/api/runs/unknown', { token });
    const foreign = await server.request('DELETE', '/api/runs/theirs', { token });
    expect([missing.status, foreign.status]).toEqual([404, 403]);
    expect(missing.body).toEqual({ success: false, error: 'Run not found', code: 'not_found' });
    expect(foreign.body).toEqual({ success: false, error: 'Not authorized to delete this run', code: 'forbidden' });
  });
});
