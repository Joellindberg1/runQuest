/**
 * GET /api/badges/user/:userId och GET /api/badges/group (ADR 009 beslut 4 och 9): auth-guard,
 * uuid-validering, gruppavgränsning (404 med samma body som obefintlig), seen_tier bara för anroparen,
 * showcase skuret mot ägda serier, holders = tier eller högre, en enda user_badges-query, tom data utan grupp.
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

import { getSupabaseClient } from '../../config/database.js';
import app from '../../app.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });
afterEach(() => { vi.clearAllMocks(); });

const ME = '00000000-0000-4000-8000-000000000001';
const KARL = '00000000-0000-4000-8000-000000000002';
const ANNA = '00000000-0000-4000-8000-000000000003';
const OTHER_GROUP = '00000000-0000-4000-8000-000000000009';
const MISSING = '00000000-0000-4000-8000-0000000000ff';
const EARNED = '2026-10-01T10:00:00.000Z';

function badge(user_id: string, series: string, tier: number, over: Row = {}): Row {
  return { user_id, series, tier, seen_tier: 0, earned_at: EARNED, source_run_id: null, updated_at: EARNED, ...over };
}

function tables(over: Partial<Record<'users' | 'user_badges', Row[]>> = {}): Record<string, Row[]> {
  return {
    users: over.users ?? [
      { id: ME, name: 'Me', group_id: 'g1', displayed_badge_series: [] },
      { id: KARL, name: 'Karl', group_id: 'g1', displayed_badge_series: [] },
      { id: ANNA, name: 'Anna', group_id: 'g1', displayed_badge_series: [] },
      { id: OTHER_GROUP, name: 'Outsider', group_id: 'g2', displayed_badge_series: ['milestoner'] },
    ],
    user_badges: over.user_badges ?? [],
  };
}

function use(t: Record<string, Row[]>, options: Parameters<typeof createFakeDb>[1] = {}) {
  const db = createFakeDb(t, options);
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return db;
}

const asMe = (group_id: string | null = 'g1') => mintToken({ user_id: ME, group_id });
const getUser = (id: string, group_id: string | null = 'g1') =>
  server.request('GET', `/api/badges/user/${id}`, { token: asMe(group_id) });
const getGroup = (group_id: string | null = 'g1') =>
  server.request('GET', '/api/badges/group', { token: asMe(group_id) });

describe('auth', () => {
  it('GET /api/badges/user/:userId utan token → 401', async () => {
    const res = await server.request('GET', `/api/badges/user/${KARL}`);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: expect.any(String) });
  });
  it('GET /api/badges/group utan token → 401', async () => {
    const res = await server.request('GET', '/api/badges/group');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: expect.any(String) });
  });
});

describe('GET /api/badges/user/:userId', () => {
  it('ogiltigt uuid → 400 utan databasanrop', async () => {
    const db = use(tables());
    for (const bad of ['not-a-uuid', '123', `${KARL}x`]) {
      const res = await getUser(bad);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: expect.any(String) });
    }
    expect(db.queries).toHaveLength(0);
  });

  it('en medlem i en annan grupp → 404 med EXAKT samma body som en obefintlig användare', async () => {
    use(tables({ user_badges: [badge(OTHER_GROUP, 'milestoner', 3)] }));
    const otherGroup = await getUser(OTHER_GROUP);
    const missing = await getUser(MISSING);
    expect(otherGroup.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(otherGroup.body).toEqual(missing.body);
    expect(JSON.stringify(otherGroup.body)).not.toContain('milestoner');
  });

  it('läser aldrig user_badges för ett mål utanför gruppen', async () => {
    const db = use(tables({ user_badges: [badge(OTHER_GROUP, 'milestoner', 3)] }));
    await getUser(OTHER_GROUP);
    expect(db.queries.filter((q) => q.table === 'user_badges')).toHaveLength(0);
  });

  it('token utan grupp → 404 för andra användare', async () => {
    use(tables({ user_badges: [badge(KARL, 'milestoner', 1)] }));
    const res = await getUser(KARL, null);
    expect(res.status).toBe(404);
    expect(res.body).toEqual((await getUser(MISSING, null)).body);
  });

  it('egen profil → seen_tier med; token utan grupp (inaktuell, zon 8) blockerar inte ens egen data', async () => {
    use(tables({ user_badges: [badge(ME, 'milestoner', 3, { seen_tier: 2 })] }));
    const res = await getUser(ME, null);
    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([{ series: 'milestoner', tier: 3, earned_at: EARNED, seen_tier: 2 }]);
  });

  it('egen profil: svarsformen { success, data: { items, showcase } } utan meta', async () => {
    use(tables({
      users: [{ id: ME, name: 'Me', group_id: 'g1', displayed_badge_series: ['early_bird', 'milestoner'] }],
      user_badges: [badge(ME, 'milestoner', 4, { seen_tier: 4 }), badge(ME, 'early_bird', 1)],
    }));
    const res = await getUser(ME);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: {
        // BADGE_SERIES-ordning (milestoner före early_bird), inte radordningen i databasen
        items: [
          { series: 'milestoner', tier: 4, earned_at: EARNED, seen_tier: 4 },
          { series: 'early_bird', tier: 1, earned_at: EARNED, seen_tier: 0 },
        ],
        showcase: ['early_bird', 'milestoner'],
      },
    });
  });

  it('en annan medlems badges → UTAN seen_tier (nyckeln saknas helt) och utan interna fält', async () => {
    use(tables({ user_badges: [badge(KARL, 'milestoner', 2, { seen_tier: 1, source_run_id: 'run-9' })] }));
    const res = await getUser(KARL);
    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([{ series: 'milestoner', tier: 2, earned_at: EARNED }]);
    expect(Object.keys(res.body.data.items[0]).sort()).toEqual(['earned_at', 'series', 'tier']);
    expect(JSON.stringify(res.body)).not.toContain('run-9');
  });

  it('showcase är aldrig en ej ägd serie — ej ägda, okända och dubbletter skärs bort, ordningen behålls', async () => {
    use(tables({
      users: [
        { id: ME, name: 'Me', group_id: 'g1', displayed_badge_series: [] },
        { id: KARL, name: 'Karl', group_id: 'g1', displayed_badge_series: ['night_owl', 'speedster', 'milestoner', 'bogus', 'speedster'] },
      ],
      user_badges: [badge(KARL, 'speedster', 2), badge(KARL, 'milestoner', 1)],
    }));
    const res = await getUser(KARL);
    expect(res.body.data.showcase).toEqual(['speedster', 'milestoner']);
    for (const series of res.body.data.showcase) {
      expect(res.body.data.items.map((i: any) => i.series)).toContain(series);
    }
  });

  it('en användare utan badges → tom items och tom showcase', async () => {
    use(tables());
    const res = await getUser(ANNA);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ items: [], showcase: [] });
  });

  it('en lagrad serie som koden inte känner till visas inte', async () => {
    use(tables({ user_badges: [badge(KARL, 'socialite', 2), badge(KARL, 'milestoner', 1)] }));
    const res = await getUser(KARL);
    expect(res.body.data.items.map((i: any) => i.series)).toEqual(['milestoner']);
  });

  it('läser bara målets rader (user_badges filtreras på user_id)', async () => {
    const db = use(tables({ user_badges: [badge(KARL, 'milestoner', 1), badge(ANNA, 'early_bird', 5)] }));
    const res = await getUser(KARL);
    expect(res.body.data.items.map((i: any) => i.series)).toEqual(['milestoner']);
    const q = db.queries.find((x) => x.table === 'user_badges')!;
    expect(q.filters).toContainEqual({ op: 'eq', column: 'user_id', value: KARL });
  });

  it('databasfel → 500 { error } utan läckta detaljer', async () => {
    use(tables(), { errors: { user_badges: { message: 'secret db detail' } } });
    const res = await getUser(KARL);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: expect.any(String) });
    expect(JSON.stringify(res.body)).not.toContain('secret db detail');
  });
});

describe('GET /api/badges/group', () => {
  const groupTables = () => tables({
    users: [
      { id: ME, name: 'Me', group_id: 'g1', displayed_badge_series: ['milestoner'] },
      { id: KARL, name: 'Karl', group_id: 'g1', displayed_badge_series: ['early_bird', 'milestoner', 'night_owl'] },
      { id: ANNA, name: 'Anna', group_id: 'g1', displayed_badge_series: [] },
      { id: OTHER_GROUP, name: 'Outsider', group_id: 'g2', displayed_badge_series: ['milestoner'] },
    ],
    user_badges: [
      badge(ME, 'milestoner', 3),
      badge(KARL, 'milestoner', 1),
      badge(KARL, 'early_bird', 2),
      badge(OTHER_GROUP, 'milestoner', 6),
    ],
  });

  it('holders räknar tier eller högre (tier 3 räknas i 1–3)', async () => {
    use(groupTables());
    const res = await getGroup();
    expect(res.status).toBe(200);
    // ME = tier 3, KARL = tier 1 → tier 1: 2, tier 2–3: 1, tier 4–6: 0
    expect(res.body.data.holders.milestoner).toEqual({ 1: 2, 2: 1, 3: 1, 4: 0, 5: 0, 6: 0 });
    expect(res.body.data.holders.early_bird).toEqual({ 1: 1, 2: 1, 3: 0, 4: 0, 5: 0, 6: 0 });
    expect(res.body.data.holders.night_owl).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 });
  });

  it('meta.member_count stämmer och members innehåller alla i gruppen (även utan badges), sorterat på user_id', async () => {
    use(groupTables());
    const res = await getGroup();
    expect(res.body.success).toBe(true);
    expect(res.body.meta).toEqual({ member_count: 3 });
    expect(res.body.data.members.map((m: any) => m.user_id)).toEqual([ME, KARL, ANNA]);
    expect(Object.keys(res.body.data.members[0]).sort()).toEqual(['showcase', 'user_id']);
  });

  it('members[].showcase har {series, tier}, skuret mot ägda serier, i sparad ordning', async () => {
    use(groupTables());
    const res = await getGroup();
    const byId = Object.fromEntries(res.body.data.members.map((m: any) => [m.user_id, m.showcase]));
    // KARL valde early_bird, milestoner, night_owl men äger inte night_owl
    expect(byId[KARL]).toEqual([{ series: 'early_bird', tier: 2 }, { series: 'milestoner', tier: 1 }]);
    expect(byId[ME]).toEqual([{ series: 'milestoner', tier: 3 }]);
    expect(byId[ANNA]).toEqual([]);
  });

  it('en annan grupps medlemmar och badges syns aldrig (varken i members eller holders)', async () => {
    use(groupTables());
    const res = await getGroup();
    expect(JSON.stringify(res.body)).not.toContain(OTHER_GROUP);
    expect(res.body.data.holders.milestoner[6]).toBe(0);
    // Och med g2:s token ser man bara g2
    const g2 = await server.request('GET', '/api/badges/group', { token: mintToken({ user_id: OTHER_GROUP, group_id: 'g2' }) });
    expect(g2.body.meta).toEqual({ member_count: 1 });
    expect(g2.body.data.holders.milestoner[6]).toBe(1);
  });

  it('EN query mot user_badges för hela gruppen (ingen N+1) och en mot users', async () => {
    const db = use(groupTables());
    await getGroup();
    expect(db.queries.filter((q) => q.table === 'user_badges')).toHaveLength(1);
    expect(db.queries.filter((q) => q.table === 'users')).toHaveLength(1);
    const q = db.queries.find((x) => x.table === 'user_badges')!;
    expect(q.filters).toContainEqual({ op: 'in', column: 'user_id', value: expect.arrayContaining([ME, KARL, ANNA]) });
  });

  it('ingen grupp i token → tom lista, tomt rutnät och inga databasanrop', async () => {
    const db = use(groupTables());
    const res = await getGroup(null);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.members).toEqual([]);
    expect(res.body.meta).toEqual({ member_count: 0 });
    expect(Object.values(res.body.data.holders.milestoner).every((n) => n === 0)).toBe(true);
    expect(db.queries).toHaveLength(0);
  });

  it('en tom grupp (inga medlemmar i databasen) → tom lista utan user_badges-query', async () => {
    const db = use(tables({ users: [], user_badges: [badge(KARL, 'milestoner', 1)] }));
    const res = await getGroup('g1');
    expect(res.body.data.members).toEqual([]);
    expect(res.body.meta).toEqual({ member_count: 0 });
    expect(db.queries.filter((q) => q.table === 'user_badges')).toHaveLength(0);
  });

  it('medlemmar utan några badges → nollrutnät, inte fel', async () => {
    use(tables());
    const res = await getGroup();
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ member_count: 3 });
    expect(res.body.data.holders.milestoner).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 });
  });

  it('databasfel → 500 { error }', async () => {
    use(groupTables(), { errors: { user_badges: { message: 'secret db detail' } } });
    const res = await getGroup();
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('secret db detail');
  });
});
