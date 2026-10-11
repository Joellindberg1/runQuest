/**
 * PUT /api/badges/showcase och POST /api/badges/seen (ADR 009 beslut 4 och 5, RUN-121): auth-guard,
 * servervalidering av valet (≤ 3, unika, kända, ägda), en enradsuppdatering av anroparens egen rad,
 * seen_tier idempotent/monotont, compare-and-set mot samtidig nedgradering (CHECK seen_tier <= tier),
 * aldrig en annan användares rad.
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

const ME = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const EARNED = '2026-10-01T10:00:00.000Z';

function badge(user_id: string, series: string, tier: number, over: Row = {}): Row {
  return { user_id, series, tier, seen_tier: 0, earned_at: EARNED, source_run_id: null, updated_at: EARNED, ...over };
}

function tables(user_badges: Row[] = [], mine: string[] = []): Record<string, Row[]> {
  return {
    users: [
      { id: ME, name: 'Me', group_id: 'g1', displayed_badge_series: mine },
      { id: OTHER, name: 'Other', group_id: 'g1', displayed_badge_series: ['milestoner'] },
    ],
    user_badges,
  };
}

function use(t: Record<string, Row[]>, options: Parameters<typeof createFakeDb>[1] = {}) {
  const db = createFakeDb(t, options);
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return db;
}

const asMe = (group_id: string | null = 'g1') => mintToken({ user_id: ME, group_id });
const putShowcase = (body: unknown, token: string | null = asMe()) =>
  server.request('PUT', '/api/badges/showcase', { token: token ?? undefined, body });
const postSeen = (body: unknown = {}, token: string | null = asMe()) =>
  server.request('POST', '/api/badges/seen', { token: token ?? undefined, body });
const writes = (db: ReturnType<typeof use>, table: string) =>
  db.queries.filter((q) => q.table === table && q.mutation);

const OWNED = () => [badge(ME, 'milestoner', 3), badge(ME, 'early_bird', 1), badge(ME, 'speedster', 2), badge(ME, 'night_owl', 1)];

describe('auth', () => {
  it('PUT /api/badges/showcase utan token → 401 utan databasanrop', async () => {
    const db = use(tables(OWNED()));
    const res = await putShowcase({ series: [] }, null);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: expect.any(String) });
    expect(db.queries).toHaveLength(0);
  });
  it('POST /api/badges/seen utan token → 401 utan databasanrop', async () => {
    const db = use(tables(OWNED()));
    const res = await postSeen({}, null);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: expect.any(String) });
    expect(db.queries).toHaveLength(0);
  });
});

describe('PUT /api/badges/showcase', () => {
  it('giltigt val sparas i angiven ordning, svar { success, data: { showcase } } och nästa GET returnerar det', async () => {
    const t = tables(OWNED());
    use(t);
    const res = await putShowcase({ series: ['speedster', 'milestoner', 'early_bird'] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { showcase: ['speedster', 'milestoner', 'early_bird'] } });
    expect(t.users.find((u) => u.id === ME)!.displayed_badge_series).toEqual(['speedster', 'milestoner', 'early_bird']);

    const get = await server.request('GET', `/api/badges/user/${ME}`, { token: asMe() });
    expect(get.body.data.showcase).toEqual(['speedster', 'milestoner', 'early_bird']);
  });

  it('EN update av anroparens egen users-rad (filtrerad på id = anroparen), inga andra skrivningar', async () => {
    const db = use(tables(OWNED()));
    await putShowcase({ series: ['milestoner'] });
    const w = db.queries.filter((q) => q.mutation);
    expect(w).toHaveLength(1);
    expect(w[0].table).toBe('users');
    expect(w[0].mutation).toBe('update');
    expect(w[0].filters).toEqual([{ op: 'eq', column: 'id', value: ME }]);
  });

  it('rör aldrig en annan användares showcase', async () => {
    const t = tables(OWNED());
    use(t);
    await putShowcase({ series: ['early_bird'] });
    expect(t.users.find((u) => u.id === OTHER)!.displayed_badge_series).toEqual(['milestoner']);
  });

  it('tom lista rensar valet', async () => {
    const t = tables(OWNED(), ['milestoner', 'early_bird']);
    use(t);
    const res = await putShowcase({ series: [] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { showcase: [] } });
    expect(t.users.find((u) => u.id === ME)!.displayed_badge_series).toEqual([]);
  });

  it('en serie räcker, och exakt 3 är tillåtet', async () => {
    use(tables(OWNED()));
    expect((await putShowcase({ series: ['night_owl'] })).status).toBe(200);
    expect((await putShowcase({ series: ['night_owl', 'speedster', 'early_bird'] })).status).toBe(200);
  });

  describe.each([
    ['4 serier', { series: ['milestoner', 'early_bird', 'speedster', 'night_owl'] }],
    ['dubbletter', { series: ['milestoner', 'milestoner'] }],
    ['okänd serie', { series: ['milestoner', 'bogus'] }],
    ['ej ägd serie', { series: ['milestoner', 'climber'] }],
    ['series saknas', {}],
    ['series är inte en array', { series: 'milestoner' }],
    ['series innehåller icke-strängar', { series: ['milestoner', 3] }],
    ['series innehåller null', { series: [null] }],
    ['body saknas', undefined],
  ])('ogiltigt val: %s', (_name, body) => {
    it('→ 400 { error }, ingen skrivning och tidigare val orört', async () => {
      const t = tables(OWNED(), ['early_bird']);
      const db = use(t);
      const res = await putShowcase(body);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: expect.any(String) });
      expect(writes(db, 'users')).toHaveLength(0);
      expect(t.users.find((u) => u.id === ME)!.displayed_badge_series).toEqual(['early_bird']);
    });
  });

  it('en serie som bara en ANNAN användare äger räknas som ej ägd → 400', async () => {
    const t = tables([badge(OTHER, 'speedster', 4), badge(ME, 'milestoner', 1)]);
    const db = use(t);
    const res = await putShowcase({ series: ['speedster'] });
    expect(res.status).toBe(400);
    expect(writes(db, 'users')).toHaveLength(0);
  });

  it('ägarskap läses för anroparen (user_badges filtrerad på user_id = anroparen)', async () => {
    const db = use(tables(OWNED()));
    await putShowcase({ series: ['milestoner'] });
    const q = db.queries.find((x) => x.table === 'user_badges')!;
    expect(q.filters).toContainEqual({ op: 'eq', column: 'user_id', value: ME });
  });

  it('en lagrad serie koden inte känner till kan inte väljas', async () => {
    const t = tables([badge(ME, 'socialite', 2)]);
    use(t);
    expect((await putShowcase({ series: ['socialite'] })).status).toBe(400);
  });

  it('tom lista behöver inte läsa user_badges', async () => {
    const db = use(tables(OWNED()));
    await putShowcase({ series: [] });
    expect(db.queries.filter((q) => q.table === 'user_badges')).toHaveLength(0);
  });

  it('egen data: token utan grupp (inaktuell, zon 8) blockerar inte', async () => {
    use(tables(OWNED()));
    const res = await putShowcase({ series: ['milestoner'] }, asMe(null));
    expect(res.status).toBe(200);
  });

  it('databasfel vid läsning eller skrivning → 500 { error } utan läckta detaljer', async () => {
    use(tables(OWNED()), { errors: { user_badges: { message: 'secret db detail' } } });
    const read = await putShowcase({ series: ['milestoner'] });
    expect(read.status).toBe(500);
    expect(JSON.stringify(read.body)).not.toContain('secret db detail');

    use(tables(OWNED()), { failWhen: (q) => (q.mutation === 'update' ? { message: 'secret db detail' } : null) });
    const write = await putShowcase({ series: ['milestoner'] });
    expect(write.status).toBe(500);
    expect(write.body).toEqual({ error: expect.any(String) });
    expect(JSON.stringify(write.body)).not.toContain('secret db detail');
  });
});

describe('POST /api/badges/seen', () => {
  const seenOf = (t: Record<string, Row[]>, user: string, series: string) =>
    t.user_badges.find((r) => r.user_id === user && r.series === series)!.seen_tier;

  it('utan series: sätter seen_tier = tier för alla anroparens rader; svar { success, data: { updated } }', async () => {
    const t = tables([badge(ME, 'milestoner', 3), badge(ME, 'early_bird', 1, { seen_tier: 1 }), badge(ME, 'speedster', 2, { seen_tier: 1 })]);
    use(t);
    const res = await postSeen({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { updated: ['milestoner', 'speedster'] } });
    expect(seenOf(t, ME, 'milestoner')).toBe(3);
    expect(seenOf(t, ME, 'early_bird')).toBe(1);
    expect(seenOf(t, ME, 'speedster')).toBe(2);
  });

  it('body saknas helt = alla', async () => {
    const t = tables([badge(ME, 'milestoner', 2)]);
    use(t);
    const res = await postSeen(undefined);
    expect(res.status).toBe(200);
    expect(seenOf(t, ME, 'milestoner')).toBe(2);
  });

  it('idempotent: andra anropet ändrar inget och skriver ingenting', async () => {
    const t = tables([badge(ME, 'milestoner', 3), badge(ME, 'early_bird', 2)]);
    const db = use(t);
    await postSeen({});
    const afterFirst = JSON.stringify(t.user_badges);
    db.queries.length = 0;
    const second = await postSeen({});
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ success: true, data: { updated: [] } });
    expect(JSON.stringify(t.user_badges)).toBe(afterFirst);
    expect(writes(db, 'user_badges')).toHaveLength(0);
  });

  it('sänker aldrig seen_tier och rör inte updated_at/earned_at', async () => {
    const t = tables([badge(ME, 'milestoner', 3, { seen_tier: 3 })]);
    const db = use(t);
    await postSeen({ series: ['milestoner'] });
    expect(seenOf(t, ME, 'milestoner')).toBe(3);
    expect(writes(db, 'user_badges')).toHaveLength(0);

    const t2 = tables([badge(ME, 'milestoner', 3, { seen_tier: 1 })]);
    const db2 = use(t2);
    await postSeen({});
    const upd = writes(db2, 'user_badges')[0];
    expect(upd.mutation).toBe('update');
    expect(t2.user_badges[0]).toMatchObject({ seen_tier: 3, earned_at: EARNED, updated_at: EARNED, tier: 3 });
  });

  it('bara angivna serier uppdateras', async () => {
    const t = tables([badge(ME, 'milestoner', 3), badge(ME, 'early_bird', 2), badge(ME, 'speedster', 2)]);
    use(t);
    const res = await postSeen({ series: ['early_bird', 'speedster'] });
    expect(res.body.data.updated).toEqual(['early_bird', 'speedster']);
    expect(seenOf(t, ME, 'milestoner')).toBe(0);
    expect(seenOf(t, ME, 'early_bird')).toBe(2);
    expect(seenOf(t, ME, 'speedster')).toBe(2);
  });

  it('dubbletter i series är harmlösa; en känd men ej ägd serie är en no-op, inte ett fel', async () => {
    const t = tables([badge(ME, 'milestoner', 2)]);
    use(t);
    const res = await postSeen({ series: ['milestoner', 'milestoner', 'climber'] });
    expect(res.status).toBe(200);
    expect(res.body.data.updated).toEqual(['milestoner']);
  });

  it('series: [] är uttryckligen "inga" → no-op (inte "alla")', async () => {
    const t = tables([badge(ME, 'milestoner', 2)]);
    const db = use(t);
    const res = await postSeen({ series: [] });
    expect(res.status).toBe(200);
    expect(res.body.data.updated).toEqual([]);
    expect(seenOf(t, ME, 'milestoner')).toBe(0);
    expect(writes(db, 'user_badges')).toHaveLength(0);
  });

  it('rör aldrig en annan användares rad (OTHER med samma serie), varken med eller utan series', async () => {
    const t = tables([badge(ME, 'milestoner', 3), badge(OTHER, 'milestoner', 3), badge(OTHER, 'early_bird', 2)]);
    use(t);
    await postSeen({});
    await postSeen({ series: ['milestoner'] });
    expect(seenOf(t, ME, 'milestoner')).toBe(3);
    expect(seenOf(t, OTHER, 'milestoner')).toBe(0);
    expect(seenOf(t, OTHER, 'early_bird')).toBe(0);
  });

  it('varje update är compare-and-set: user_id = anroparen, series och tier = den lästa tiern', async () => {
    const db = use(tables([badge(ME, 'milestoner', 3), badge(ME, 'early_bird', 2)]));
    await postSeen({});
    const updates = writes(db, 'user_badges');
    expect(updates).toHaveLength(2);
    for (const u of updates) {
      const cols = u.filters.map((f) => f.column).sort();
      expect(cols).toEqual(['series', 'tier', 'user_id']);
      expect(u.filters.every((f) => f.op === 'eq')).toBe(true);
      expect(u.filters).toContainEqual({ op: 'eq', column: 'user_id', value: ME });
    }
    expect(updates[0].filters).toContainEqual({ op: 'eq', column: 'series', value: 'milestoner' });
    expect(updates[0].filters).toContainEqual({ op: 'eq', column: 'tier', value: 3 });
  });

  it('samtidig nedgradering mellan läsning och update → ingen 500 och seen_tier > tier skrivs aldrig', async () => {
    const t = tables([badge(ME, 'milestoner', 3), badge(ME, 'early_bird', 2)]);
    let downgraded = false;
    use(t, {
      // Vid första user_badges-updaten har evaluateBadges hunnit sänka milestoner till tier 1.
      failWhen: (q) => {
        if (q.table === 'user_badges' && q.mutation === 'update' && !downgraded) {
          downgraded = true;
          t.user_badges.find((r) => r.series === 'milestoner')!.tier = 1;
        }
        return null;
      },
    });
    const res = await postSeen({});
    expect(res.status).toBe(200);
    for (const r of t.user_badges) expect(r.seen_tier).toBeLessThanOrEqual(r.tier);
    expect(seenOf(t, ME, 'milestoner')).toBe(0);
    expect(res.body.data.updated).toEqual(['early_bird']);
  });

  it('en rad som raderats mellan läsning och update → ingen 500', async () => {
    const t = tables([badge(ME, 'milestoner', 3)]);
    use(t, {
      failWhen: (q) => {
        if (q.table === 'user_badges' && q.mutation === 'update') t.user_badges.length = 0;
        return null;
      },
    });
    const res = await postSeen({});
    expect(res.status).toBe(200);
    expect(res.body.data.updated).toEqual([]);
  });

  describe.each([
    ['okänd serie', { series: ['milestoner', 'bogus'] }],
    ['series är inte en array', { series: 'milestoner' }],
    ['icke-sträng', { series: [1] }],
    ['null i listan', { series: [null] }],
  ])('ogiltig body: %s', (_name, body) => {
    it('→ 400 { error } och ingen skrivning', async () => {
      const t = tables([badge(ME, 'milestoner', 3)]);
      const db = use(t);
      const res = await postSeen(body);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: expect.any(String) });
      expect(writes(db, 'user_badges')).toHaveLength(0);
      expect(seenOf(t, ME, 'milestoner')).toBe(0);
    });
  });

  it('en lagrad serie koden inte känner till rörs inte vid "alla"', async () => {
    const t = tables([badge(ME, 'socialite', 2), badge(ME, 'milestoner', 1)]);
    use(t);
    const res = await postSeen({});
    expect(res.body.data.updated).toEqual(['milestoner']);
    expect(seenOf(t, ME, 'socialite')).toBe(0);
  });

  it('läser bara anroparens rader (user_badges filtrerad på user_id)', async () => {
    const db = use(tables([badge(ME, 'milestoner', 1)]));
    await postSeen({});
    const q = db.queries.find((x) => x.table === 'user_badges' && !x.mutation)!;
    expect(q.filters).toContainEqual({ op: 'eq', column: 'user_id', value: ME });
  });

  it('databasfel vid läsning eller skrivning → 500 { error } utan läckta detaljer', async () => {
    use(tables([badge(ME, 'milestoner', 3)]), { errors: { user_badges: { message: 'secret db detail' } } });
    const read = await postSeen({});
    expect(read.status).toBe(500);
    expect(JSON.stringify(read.body)).not.toContain('secret db detail');

    use(tables([badge(ME, 'milestoner', 3)]), { failWhen: (q) => (q.mutation === 'update' ? { message: 'secret db detail' } : null) });
    const write = await postSeen({});
    expect(write.status).toBe(500);
    expect(write.body).toEqual({ error: expect.any(String) });
    expect(JSON.stringify(write.body)).not.toContain('secret db detail');
  });

  it('en popup-cykel: GET ger tier > seen_tier, POST /seen, nästa GET ger seen_tier = tier', async () => {
    use(tables([badge(ME, 'milestoner', 3)]));
    const before = await server.request('GET', `/api/badges/user/${ME}`, { token: asMe() });
    expect(before.body.data.items[0]).toMatchObject({ tier: 3, seen_tier: 0 });
    await postSeen({ series: ['milestoner'] });
    const after = await server.request('GET', `/api/badges/user/${ME}`, { token: asMe() });
    expect(after.body.data.items[0]).toMatchObject({ tier: 3, seen_tier: 3 });
  });
});
