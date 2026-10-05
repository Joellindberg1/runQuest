/**
 * ADR 007 B7–B8:
 *   GET /api/events          — participantCount/memberCount för ALLA eventtyper
 *   GET /api/events/history  — offset-paginering + meta, participantCount/memberCount
 * Fake-DB som tillämpar filter.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';

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
import app from '../../app.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });
afterEach(() => { vi.clearAllMocks(); });

const G1 = 'group-1';
const G2 = 'group-2';
const ME = 'u-anna';

function useDb(tables: Record<string, Row[]>, options?: Parameters<typeof createFakeDb>[1]) {
  const db = createFakeDb(tables, options);
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return db;
}

const template = { name: 'Morning Run', icon: 'sun', description: 'Run before noon', min_km: 3, reward_xp: 20, reward_xp_1st: 50, reward_xp_2nd: 30, reward_xp_3rd: 10, requires_weather: null };

function event(id: string, group_id: string, extra: Row = {}): Row {
  return {
    id,
    group_id,
    type: 'participation',
    metric: 'km',
    status: 'active',
    starts_at: '2026-10-04T00:00:00Z',
    ends_at: '2026-10-04T23:59:59Z',
    event_templates: template,
    ...extra,
  };
}

function entry(event_id: string, user_id: string, extra: Row = {}): Row {
  return { id: `${event_id}-${user_id}`, event_id, user_id, rank: null, xp_awarded: 20, qualified_at: '2026-10-04T09:00:00Z', total_value: null, ...extra };
}

// Gruppen har 4 medlemmar; främlingen ligger i en annan grupp
const users = () => [
  { id: ME, name: 'Anna', group_id: G1 },
  { id: 'u-bertil', name: 'Bertil', group_id: G1 },
  { id: 'u-cecilia', name: 'Cecilia', group_id: G1 },
  { id: 'u-david', name: 'David', group_id: G1 },
  { id: 'u-x', name: 'Främling', group_id: G2 },
  { id: 'u-y', name: 'Främling2', group_id: G2 },
];

describe('GET /api/events — participantCount och memberCount', () => {
  const token = () => mintToken({ user_id: ME, group_id: G1 });

  it('kräver token (401)', async () => {
    expect((await server.request('GET', '/api/events')).status).toBe(401);
  });

  it('participation-event: participantCount ur event_entries, memberCount = gruppens storlek', async () => {
    useDb({
      users: users(),
      events: [event('ev-1', G1), event('ev-2', G1, { starts_at: '2026-10-05T00:00:00Z', status: 'scheduled' })],
      event_entries: [
        entry('ev-1', ME),
        entry('ev-1', 'u-bertil'),
        entry('ev-1', 'u-cecilia'),
        entry('ev-2', 'u-david'),
      ],
    });
    const res = await server.request('GET', '/api/events', { token: token() });
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.events.map((e: any) => [e.id, e]));
    expect(byId['ev-1'].participantCount).toBe(3);
    expect(byId['ev-1'].memberCount).toBe(4); // främlingarna (annan grupp) räknas inte
    expect(byId['ev-2'].participantCount).toBe(1);
    expect(byId['ev-2'].memberCount).toBe(4);
  });

  it('event utan deltagare ger participantCount 0', async () => {
    useDb({ users: users(), events: [event('ev-1', G1)], event_entries: [] });
    const res = await server.request('GET', '/api/events', { token: token() });
    expect(res.body.events[0].participantCount).toBe(0);
    expect(res.body.events[0].memberCount).toBe(4);
  });

  it('competition-event: participantCount oförändrat (längd på live-leaderboarden), memberCount tillkommer', async () => {
    useDb({
      users: users(),
      events: [event('ev-c', G1, { type: 'competition', status: 'active' })],
      event_entries: [entry('ev-c', ME, { xp_awarded: null }), entry('ev-c', 'u-bertil', { xp_awarded: null })],
      runs: [],
    });
    const res = await server.request('GET', '/api/events', { token: token() });
    const ev = res.body.events[0];
    expect(ev.leaderboard).toHaveLength(2);
    expect(ev.participantCount).toBe(2);
    expect(ev.memberCount).toBe(4);
  });

  it('samma användare räknas en gång även med dubbla entries', async () => {
    useDb({
      users: users(),
      events: [event('ev-1', G1)],
      event_entries: [entry('ev-1', ME), { ...entry('ev-1', ME), id: 'dup' }],
    });
    const res = await server.request('GET', '/api/events', { token: token() });
    expect(res.body.events[0].participantCount).toBe(1);
  });

  it('gruppisolering: annan grupps events och deltagare påverkar aldrig svaret', async () => {
    useDb({
      users: users(),
      events: [event('mine', G1), event('theirs', G2)],
      event_entries: [entry('mine', ME), entry('theirs', 'u-x'), entry('theirs', 'u-y')],
    });
    const res = await server.request('GET', '/api/events', { token: token() });
    expect(res.body.events.map((e: any) => e.id)).toEqual(['mine']);
    expect(res.body.events[0].participantCount).toBe(1);
    expect(res.body.events[0].memberCount).toBe(4);
    expect(JSON.stringify(res.body)).not.toContain('Främling');
  });

  it('befintliga fält (camelCase, myEntry, template) bevaras', async () => {
    useDb({ users: users(), events: [event('ev-1', G1)], event_entries: [entry('ev-1', ME)] });
    const res = await server.request('GET', '/api/events', { token: token() });
    const ev = res.body.events[0];
    expect(ev).toMatchObject({ id: 'ev-1', type: 'participation', startsAt: '2026-10-04T00:00:00Z', template: { name: 'Morning Run', rewardXp: 20 } });
    expect(ev.myEntry).toMatchObject({ qualified: true, xpAwarded: 20 });
    expect(ev.leaderboard).toBeNull();
  });

  it('saknad group_id ger tom lista', async () => {
    useDb({ users: users(), events: [event('ev-1', G1)], event_entries: [] });
    const res = await server.request('GET', '/api/events', { token: mintToken({ user_id: ME, group_id: null }) });
    expect(res.body).toEqual({ events: [] });
  });
});

describe('GET /api/events/history — paginering, meta och counts', () => {
  const token = () => mintToken({ user_id: ME, group_id: G1 });
  const settled = (id: string, group_id: string, ends_at: string, extra: Row = {}) =>
    event(id, group_id, { status: 'settled', ends_at, starts_at: ends_at, ...extra });

  it('kräver token (401)', async () => {
    expect((await server.request('GET', '/api/events/history')).status).toBe(401);
  });

  it('utan parametrar: nyckeln events oförändrad, default limit 30, additivt meta', async () => {
    const evs = Array.from({ length: 35 }, (_, i) => settled(`ev-${String(i).padStart(2, '0')}`, G1, `2026-08-${String((i % 28) + 1).padStart(2, '0')}T20:00:00Z`));
    useDb({ users: users(), events: evs, event_entries: [] });
    const res = await server.request('GET', '/api/events/history', { token: token() });
    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(30);
    expect(res.body.meta).toEqual({ total: 35, limit: 30, offset: 0, has_more: true });
    expect(res.body.success).toBeUndefined();
  });

  it('sorterar ends_at desc, id desc — lika ends_at ger deterministisk ordning över sidgräns', async () => {
    const same = '2026-09-10T20:00:00Z';
    useDb({
      users: users(),
      events: [
        settled('a', G1, '2026-09-01T20:00:00Z'),
        settled('b', G1, same),
        settled('c', G1, same),
        settled('d', G1, same),
        settled('e', G1, '2026-09-20T20:00:00Z'),
      ],
      event_entries: [],
    });
    const get = (qs: string) => server.request('GET', `/api/events/history?${qs}`, { token: token() });
    const ids = (r: any) => r.body.events.map((e: any) => e.id);
    const p1 = await get('limit=2&offset=0');
    const p2 = await get('limit=2&offset=2');
    const p3 = await get('limit=2&offset=4');
    expect(ids(p1)).toEqual(['e', 'd']);
    expect(ids(p2)).toEqual(['c', 'b']);
    expect(ids(p3)).toEqual(['a']);
    expect(p1.body.meta).toEqual({ total: 5, limit: 2, offset: 0, has_more: true });
    expect(p2.body.meta).toEqual({ total: 5, limit: 2, offset: 2, has_more: true });
    expect(p3.body.meta).toEqual({ total: 5, limit: 2, offset: 4, has_more: false });
  });

  it('participantCount/memberCount per event: "4 av 6 klarade det"', async () => {
    useDb({
      users: users(),
      events: [settled('p', G1, '2026-09-02T20:00:00Z'), settled('c', G1, '2026-09-01T20:00:00Z', { type: 'competition' })],
      event_entries: [
        entry('p', ME),
        entry('p', 'u-bertil'),
        entry('p', 'u-cecilia'),
        entry('c', ME, { rank: 1, total_value: 20 }),
        entry('c', 'u-david', { rank: 2, total_value: 10 }),
      ],
    });
    const res = await server.request('GET', '/api/events/history', { token: token() });
    const byId = Object.fromEntries(res.body.events.map((e: any) => [e.id, e]));
    expect(byId.p.participantCount).toBe(3);
    expect(byId.p.memberCount).toBe(4);
    expect(byId.c.participantCount).toBe(2);
    expect(byId.c.memberCount).toBe(4);
  });

  it('gruppisolering: annan grupps settled events syns aldrig och räknas inte i total', async () => {
    useDb({
      users: users(),
      events: [settled('mine', G1, '2026-09-02T20:00:00Z'), settled('theirs', G2, '2026-09-03T20:00:00Z'), event('open', G1)],
      event_entries: [entry('mine', ME), entry('theirs', 'u-x')],
    });
    const res = await server.request('GET', '/api/events/history', { token: token() });
    expect(res.body.events.map((e: any) => e.id)).toEqual(['mine']);
    expect(res.body.meta.total).toBe(1);
    expect(JSON.stringify(res.body)).not.toContain('Främling');
  });

  it('bygger entries/leaderboard bara för sidans event', async () => {
    const db = useDb({
      users: users(),
      events: [settled('a', G1, '2026-09-01T20:00:00Z'), settled('b', G1, '2026-09-02T20:00:00Z'), settled('c', G1, '2026-09-03T20:00:00Z')],
      event_entries: [entry('a', ME), entry('b', ME), entry('c', ME)],
    });
    await server.request('GET', '/api/events/history?limit=1&offset=1', { token: token() });
    const entryQueries = db.queries.filter((q) => q.table === 'event_entries');
    expect(entryQueries.length).toBeGreaterThan(0);
    for (const q of entryQueries) {
      const inFilter = q.filters.find((f) => f.op === 'in' && f.column === 'event_id');
      expect(inFilter?.value).toEqual(['b']);
    }
  });

  it('offset bortom slutet ger tom sida med korrekt total', async () => {
    useDb({ users: users(), events: [settled('a', G1, '2026-09-01T20:00:00Z')], event_entries: [] });
    const res = await server.request('GET', '/api/events/history?limit=6&offset=30', { token: token() });
    expect(res.status).toBe(200);
    expect(res.body.events).toEqual([]);
    expect(res.body.meta).toEqual({ total: 1, limit: 6, offset: 30, has_more: false });
  });

  it('saknad group_id ger tom lista med meta', async () => {
    useDb({ users: users(), events: [settled('a', G1, '2026-09-01T20:00:00Z')], event_entries: [] });
    const res = await server.request('GET', '/api/events/history?limit=6', { token: mintToken({ user_id: ME, group_id: null }) });
    expect(res.body.events).toEqual([]);
    expect(res.body.meta).toEqual({ total: 0, limit: 6, offset: 0, has_more: false });
  });

  it.each(['limit=0', 'limit=51', 'limit=abc', 'offset=-1', 'offset=1.5'])('ogiltig pagination (%s) ger 400', async (qs) => {
    useDb({ users: users(), events: [], event_entries: [] });
    const res = await server.request('GET', `/api/events/history?${qs}`, { token: token() });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String) });
  });

  it('ogiltig pagination ger 400 även utan group_id (validering före gruppkontroll)', async () => {
    useDb({ users: users(), events: [], event_entries: [] });
    const res = await server.request('GET', '/api/events/history?limit=0', { token: mintToken({ user_id: ME, group_id: null }) });
    expect(res.status).toBe(400);
  });

  it('DB-fel ger 500 med { error }', async () => {
    useDb({ users: users(), events: [], event_entries: [] }, { errors: { events: { message: 'boom' } } });
    const res = await server.request('GET', '/api/events/history', { token: token() });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: expect.any(String) });
  });
});
