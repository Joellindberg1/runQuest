/**
 * Kuvertet i /api/events, steg 1 (ADR 007 Addendum 2026-10-20): de nakna svaren `{ events }` och `{ events, meta }` får `success: true` och `data` BREDVID de gamla nycklarna
 * (namnet `events` och camelCase inom data är oförändrat), och varje fel bär `code`. Utan grupp svarar en läsning 200 med tom data i samma kuvert (A6), aldrig ett fel.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));
const draw = vi.hoisted(() => vi.fn());
vi.mock('../../scheduler/eventScheduler.js', () => ({ scheduleDailyParticipationEventTest: draw }));

import { getSupabaseClient } from '../../config/database.js';
import app from '../../app.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });
afterEach(() => { vi.clearAllMocks(); });

const G1 = 'group-1';
const ME = 'u-anna';
const token = () => mintToken({ user_id: ME, group_id: G1 });

function useDb(tables: Record<string, Row[]>, options?: Parameters<typeof createFakeDb>[1]) {
  const db = createFakeDb(tables, options);
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as never);
  return db;
}

const template = { name: 'Morning Run', icon: 'sun', description: 'Run before noon', min_km: 3, reward_xp: 20, reward_xp_1st: 50, reward_xp_2nd: 30, reward_xp_3rd: 10, requires_weather: null };
const event = (id: string, extra: Row = {}): Row => ({
  id, group_id: G1, type: 'participation', metric: 'km', status: 'active', starts_at: '2026-10-04T00:00:00Z', ends_at: '2026-10-04T23:59:59Z', event_templates: template, ...extra,
});
const tables = (events: Row[]): Record<string, Row[]> => ({ users: [{ id: ME, name: 'Anna', group_id: G1 }], events, event_entries: [{ id: 'e1', event_id: 'ev-1', user_id: ME, rank: null, xp_awarded: 20, qualified_at: '2026-10-04T09:00:00Z', total_value: null }] });

describe('GET /api/events', () => {
  it('answers events at the top level (old client) and in data (new client)', async () => {
    useDb(tables([event('ev-1')]));
    const res = await server.request('GET', '/api/events', { token: token() });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0]).toMatchObject({ id: 'ev-1', participantCount: 1, memberCount: 1 });
    expect(res.body.data).toEqual({ events: res.body.events });
    expect(Object.keys(res.body).sort()).toEqual(['data', 'events', 'success']);
  });

  it('answers 200 with empty events in both forms when there are no events, and when the token has no group', async () => {
    useDb(tables([]));
    const none = await server.request('GET', '/api/events', { token: token() });
    expect(none.status).toBe(200);
    expect(none.body).toEqual({ success: true, events: [], data: { events: [] } });

    const noGroup = await server.request('GET', '/api/events', { token: mintToken({ user_id: ME, group_id: null }) });
    expect(noGroup.status).toBe(200);
    expect(noGroup.body).toEqual({ success: true, events: [], data: { events: [] } });
  });

  it('answers 500 internal_error with a fixed text when the database fails', async () => {
    useDb(tables([event('ev-1')]), { errors: { events: { message: 'permission denied for relation events with row 12345678901' } } });
    const res = await server.request('GET', '/api/events', { token: token() });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to fetch events', code: 'internal_error' });
  });
});

describe('GET /api/events/history', () => {
  const settled = (id: string) => event(id, { status: 'settled' });

  it('answers events at the top level and in data, with meta at the top level next to both', async () => {
    useDb(tables([settled('ev-1')]));
    const res = await server.request('GET', '/api/events/history', { token: token() });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.data).toEqual({ events: res.body.events });
    expect(res.body.meta).toEqual({ total: 1, limit: 30, offset: 0, has_more: false });
    expect(Object.keys(res.body).sort()).toEqual(['data', 'events', 'meta', 'success']);
  });

  it('answers 200 with empty events, data and meta when the token has no group (fail-closed, not an error)', async () => {
    useDb(tables([settled('ev-1')]));
    const res = await server.request('GET', '/api/events/history', { token: mintToken({ user_id: ME, group_id: null }) });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, events: [], data: { events: [] }, meta: { total: 0, limit: 30, offset: 0, has_more: false } });
  });

  it('answers 400 invalid_request for a bad page and 500 internal_error with a fixed text when the database fails', async () => {
    useDb(tables([settled('ev-1')]));
    const bad = await server.request('GET', '/api/events/history?limit=0', { token: token() });
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({ success: false, code: 'invalid_request' });

    useDb(tables([settled('ev-1')]), { errors: { events: { message: 'boom with row 12345678901' } } });
    const broken = await server.request('GET', '/api/events/history', { token: token() });
    expect(broken.status).toBe(500);
    expect(broken.body).toEqual({ success: false, error: 'Failed to fetch history', code: 'internal_error' });
  });
});

describe('POST /api/events/admin/trigger-daily-draw', () => {
  const result = { fired: true, picked: 'Morning Run', stormQualifies: false, totalWeight: 3, pool: [{ name: 'Morning Run', weight: 3, sharePct: 100 }] };

  it('answers the draw at the top level (old client) and in data (new client)', async () => {
    useDb({ users: [{ id: ME, is_admin: true, group_id: G1 }] });
    draw.mockResolvedValue(result);
    const res = await server.request('POST', '/api/events/admin/trigger-daily-draw', { token: token() });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, ...result, data: result });
  });

  it('answers 500 internal_error with a fixed text when the draw throws', async () => {
    useDb({ users: [{ id: ME, is_admin: true, group_id: G1 }] });
    draw.mockRejectedValue(new Error('weather api said lat 57.70887'));
    const res = await server.request('POST', '/api/events/admin/trigger-daily-draw', { token: token() });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Internal server error', code: 'internal_error' });
  });
});
