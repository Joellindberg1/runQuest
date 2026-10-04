/**
 * GET /api/news och POST /api/news/seen (ADR 008 beslut 8–9): auth-guard, gruppavgränsning, keyset-
 * paginering (inkl. tom sida), valideringsfel, oläst-predikatet och vattenmärkets monotoni.
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

const USER_CREATED = '2026-01-01T00:00:00.000Z';
const AFTER_USER = '2026-06-01T00:00:00.000Z';

function row(id: number, over: Row = {}): Row {
  return {
    id, group_id: 'g1', type: 'level_up', actor_user_id: 'u2', target_user_id: null, payload: { level: id }, payload_version: 1,
    dedupe_key: `k${id}`, is_backfill: false, occurred_at: AFTER_USER, created_at: AFTER_USER, ...over,
  };
}

function tables(activity: Row[], userOver: Row = {}): Record<string, Row[]> {
  return {
    activity_log: activity,
    users: [
      { id: 'u1', name: 'Me', profile_picture: null, group_id: 'g1', created_at: USER_CREATED, news_last_seen_id: null, ...userOver },
      { id: 'u2', name: 'Karl', profile_picture: 'karl.png', group_id: 'g1', created_at: USER_CREATED, news_last_seen_id: null },
      { id: 'u3', name: 'Other', profile_picture: null, group_id: 'g2', created_at: USER_CREATED, news_last_seen_id: null },
    ],
  };
}

function use(t: Record<string, Row[]>, options: Parameters<typeof createFakeDb>[1] = {}) {
  const db = createFakeDb(t, options);
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return db;
}

const get = (path: string, opts: { user_id?: string; group_id?: string | null } = {}) =>
  server.request('GET', path, { token: mintToken({ user_id: opts.user_id ?? 'u1', group_id: opts.group_id === undefined ? 'g1' : opts.group_id }) });
const post = (body?: unknown, opts: { user_id?: string; group_id?: string | null } = {}) =>
  server.request('POST', '/api/news/seen', {
    token: mintToken({ user_id: opts.user_id ?? 'u1', group_id: opts.group_id === undefined ? 'g1' : opts.group_id }),
    ...(body === undefined ? {} : { body }),
  });

describe('auth', () => {
  it('GET /api/news utan token → 401', async () => {
    const res = await server.request('GET', '/api/news');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: expect.any(String) });
  });
  it('POST /api/news/seen utan token → 401', async () => {
    const res = await server.request('POST', '/api/news/seen', { body: {} });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/news', () => {
  it('svarar { success, data: { items }, meta } sorterat på id fallande med actor/target-referenser', async () => {
    use(tables([
      row(1),
      row(2, { type: 'title_taken', actor_user_id: 'u2', target_user_id: 'u1', payload: { title_name: 'X' } }),
      row(3, { type: 'event_open', actor_user_id: null }),
    ]));
    const res = await get('/api/news');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.items.map((i: any) => i.id)).toEqual([3, 2, 1]);
    expect(res.body.meta).toEqual({ unread_count: 3, last_seen_id: null, has_more: false, next_before: null });

    const [event, taken] = res.body.data.items;
    expect(event).toMatchObject({ id: 3, type: 'event_open', actor: null, target: null, payload_version: 1, is_backfill: false });
    expect(taken.actor).toEqual({ id: 'u2', name: 'Karl', profile_picture: 'karl.png' });
    expect(taken.target).toEqual({ id: 'u1', name: 'Me', profile_picture: null });
    expect(taken.payload).toEqual({ title_name: 'X' });
    // Interna fält läcker inte
    for (const item of res.body.data.items) {
      expect(Object.keys(item).sort()).toEqual([
        'actor', 'id', 'is_backfill', 'is_unread', 'occurred_at', 'payload', 'payload_version', 'target', 'type',
      ]);
    }
  });

  it('saknad group_id i token → tom data utan databasanrop', async () => {
    const db = use(tables([row(1)]));
    const res = await get('/api/news', { group_id: null });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true, data: { items: [] }, meta: { unread_count: 0, last_seen_id: null, has_more: false, next_before: null },
    });
    expect(db.queries).toHaveLength(0);
  });

  it('visar aldrig en annan grupps rader (och räknar dem inte som olästa)', async () => {
    use(tables([row(1), row(2, { group_id: 'g2' }), row(3, { group_id: 'g2' })]));
    const res = await get('/api/news');
    expect(res.body.data.items.map((i: any) => i.id)).toEqual([1]);
    expect(res.body.meta.unread_count).toBe(1);
  });

  it('en grupp utan rader → tom lista och has_more false', async () => {
    use(tables([]));
    const res = await get('/api/news');
    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([]);
    expect(res.body.meta).toEqual({ unread_count: 0, last_seen_id: null, has_more: false, next_before: null });
  });

  describe('keyset-paginering', () => {
    const many = () => tables(Array.from({ length: 7 }, (_, i) => row(i + 1)));

    it('limit + has_more + next_before (id på sista raden)', async () => {
      use(many());
      const res = await get('/api/news?limit=3');
      expect(res.body.data.items.map((i: any) => i.id)).toEqual([7, 6, 5]);
      expect(res.body.meta).toMatchObject({ has_more: true, next_before: 5 });
    });

    it('?before=next_before ger nästa sida utan överlapp, till och med sista sidan', async () => {
      use(many());
      const page2 = await get('/api/news?limit=3&before=5');
      expect(page2.body.data.items.map((i: any) => i.id)).toEqual([4, 3, 2]);
      expect(page2.body.meta).toMatchObject({ has_more: true, next_before: 2 });

      const page3 = await get('/api/news?limit=3&before=2');
      expect(page3.body.data.items.map((i: any) => i.id)).toEqual([1]);
      expect(page3.body.meta).toMatchObject({ has_more: false, next_before: null });
    });

    it('exakt fullt sista sida (limit == antal kvar) → has_more false', async () => {
      use(many());
      const res = await get('/api/news?limit=2&before=3');
      expect(res.body.data.items.map((i: any) => i.id)).toEqual([2, 1]);
      expect(res.body.meta).toMatchObject({ has_more: false, next_before: null });
    });

    it('tom sida: before under äldsta raden → items [], has_more false, next_before null (inget fel)', async () => {
      use(many());
      const res = await get('/api/news?before=1');
      expect(res.status).toBe(200);
      expect(res.body.data.items).toEqual([]);
      expect(res.body.meta).toMatchObject({ has_more: false, next_before: null });
    });

    it('stabila sidor när nya rader tillkommer mellan anrop (keyset, inte offset)', async () => {
      const t = many();
      use(t);
      const first = await get('/api/news?limit=3');
      t.activity_log.push(row(8), row(9)); // nytt innehåll medan användaren bläddrar
      const second = await get(`/api/news?limit=3&before=${first.body.meta.next_before}`);
      expect(second.body.data.items.map((i: any) => i.id)).toEqual([4, 3, 2]);
    });

    it('?after=<id>: bara nyare rader, samma sortering (id fallande)', async () => {
      use(many());
      const res = await get('/api/news?after=4');
      expect(res.body.data.items.map((i: any) => i.id)).toEqual([7, 6, 5]);
      expect(res.body.meta).toMatchObject({ has_more: false, next_before: null });
    });

    it('?after med fler rader än limit → nyaste sidan och next_before för att fylla glappet', async () => {
      use(many());
      const res = await get('/api/news?after=1&limit=2');
      expect(res.body.data.items.map((i: any) => i.id)).toEqual([7, 6]);
      expect(res.body.meta).toMatchObject({ has_more: true, next_before: 6 });
    });

    it('?after från senaste id → tom lista (inget nytt)', async () => {
      use(many());
      const res = await get('/api/news?after=7');
      expect(res.body.data.items).toEqual([]);
      expect(res.body.meta.has_more).toBe(false);
    });
  });

  describe('valideringsfel → 400', () => {
    it.each([
      ['limit=0'], ['limit=101'], ['limit=-1'], ['limit=abc'], ['limit=1.5'],
      ['before=abc'], ['before=0'], ['before=-3'], ['after=x'], ['after=0'],
      ['before=5&after=2'],
      ['type=challenge_lost'], ['type=level_up,bogus'], ['type='], ['type=level_up,'], ['type=a&type=b'],
    ])('?%s', async (qs) => {
      use(tables([row(1)]));
      const res = await get(`/api/news?${qs}`);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: expect.any(String) });
    });

    it('giltiga gränsvärden: limit=1 och limit=100', async () => {
      use(tables([row(1), row(2)]));
      expect((await get('/api/news?limit=1')).body.data.items).toHaveLength(1);
      expect((await get('/api/news?limit=100')).status).toBe(200);
    });

    it('valideringen körs före gruppkontrollen (400 även utan group_id)', async () => {
      use(tables([]));
      const res = await get('/api/news?limit=0', { group_id: null });
      expect(res.status).toBe(400);
    });
  });

  describe('type-filter', () => {
    const mixed = () => tables([
      row(1, { type: 'level_up' }), row(2, { type: 'title_taken' }), row(3, { type: 'event_open', actor_user_id: null }), row(4, { type: 'level_up' }),
    ]);

    it('filtrerar på kommaseparerad lista', async () => {
      use(mixed());
      const res = await get('/api/news?type=level_up,event_open');
      expect(res.body.data.items.map((i: any) => i.id)).toEqual([4, 3, 1]);
    });

    it('unread_count räknas över ALLA typer, oberoende av filtret', async () => {
      use(mixed());
      const filtered = await get('/api/news?type=title_taken');
      expect(filtered.body.data.items).toHaveLength(1);
      expect(filtered.body.meta.unread_count).toBe(4);
    });

    it('has_more/next_before gäller det filtrerade flödet', async () => {
      use(mixed());
      const res = await get('/api/news?type=level_up&limit=1');
      expect(res.body.data.items.map((i: any) => i.id)).toEqual([4]);
      expect(res.body.meta).toMatchObject({ has_more: true, next_before: 4 });
    });
  });

  describe('oläst-predikatet (ADR 008 beslut 8)', () => {
    it('ovanför vattenmärket = oläst, vid/under = läst', async () => {
      use(tables([row(1), row(2), row(3), row(4)], { news_last_seen_id: 2 }));
      const res = await get('/api/news');
      expect(res.body.data.items.map((i: any) => [i.id, i.is_unread])).toEqual([[4, true], [3, true], [2, false], [1, false]]);
      expect(res.body.meta).toMatchObject({ unread_count: 2, last_seen_id: 2 });
    });

    it('egna handlingar visas men räknas inte som olästa', async () => {
      use(tables([row(1, { actor_user_id: 'u1' }), row(2, { actor_user_id: 'u2' }), row(3, { actor_user_id: null })]));
      const res = await get('/api/news');
      expect(res.body.data.items.map((i: any) => [i.id, i.is_unread])).toEqual([[3, true], [2, true], [1, false]]);
      expect(res.body.meta.unread_count).toBe(2); // rader utan aktör (events) räknas som olästa
    });

    it('backfill-rader är aldrig olästa (men syns i flödet)', async () => {
      use(tables([row(1, { is_backfill: true }), row(2)]));
      const res = await get('/api/news');
      expect(res.body.data.items.map((i: any) => [i.id, i.is_backfill, i.is_unread])).toEqual([[2, false, true], [1, true, false]]);
      expect(res.body.meta.unread_count).toBe(1);
    });

    it('rader loggade FÖRE användaren skapades är inte olästa (nya medlemmar ärver inte gamla nyheter)', async () => {
      use(tables([row(1, { created_at: '2025-12-31T23:59:59.000Z' }), row(2, { created_at: '2026-01-01T00:00:01.000Z' })]));
      const res = await get('/api/news');
      expect(res.body.data.items.map((i: any) => [i.id, i.is_unread])).toEqual([[2, true], [1, false]]);
      expect(res.body.meta.unread_count).toBe(1);
    });

    it('is_unread per rad och unread_count är konsekventa (alla predikat samtidigt)', async () => {
      use(tables([
        row(1), row(2, { is_backfill: true }), row(3, { actor_user_id: 'u1' }),
        row(4, { created_at: '2025-01-01T00:00:00.000Z' }), row(5), row(6, { actor_user_id: null }), row(7),
      ], { news_last_seen_id: 4 }));
      const res = await get('/api/news');
      const unreadRows = res.body.data.items.filter((i: any) => i.is_unread).map((i: any) => i.id);
      expect(unreadRows).toEqual([7, 6, 5]);
      expect(res.body.meta.unread_count).toBe(unreadRows.length);
    });
  });

  it('en raderad användare (FK satt till null) renderas som actor null', async () => {
    use(tables([row(1, { actor_user_id: null, type: 'level_up' })]));
    const res = await get('/api/news');
    expect(res.body.data.items[0].actor).toBeNull();
  });

  it('användare saknas i databasen → 404', async () => {
    const t = tables([row(1)]);
    t.users = [];
    use(t);
    const res = await get('/api/news');
    expect(res.status).toBe(404);
  });

  it('databasfel → 500 { error } utan att läcka felmeddelandet', async () => {
    use(tables([row(1)]), { errors: { activity_log: { message: 'relation "activity_log" secret detail' } } });
    const res = await get('/api/news');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to fetch news' });
  });
});

describe('POST /api/news/seen', () => {
  const feed = () => tables([row(1), row(2), row(3), row(4), row(5), row(6, { group_id: 'g2' })]);

  it('utan up_to_id: sätter märket till senaste raden i gruppen och nollar oläst', async () => {
    const t = feed();
    use(t);
    const res = await post({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { last_seen_id: 5, unread_count: 0 } });
    expect(t.users.find((u) => u.id === 'u1')!.news_last_seen_id).toBe(5);
  });

  it('kroppen får saknas helt', async () => {
    use(feed());
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.body.data.last_seen_id).toBe(5);
  });

  it('en annan grupps rader påverkar inte senaste id', async () => {
    const t = feed(); // id 6 tillhör g2
    use(t);
    const res = await post({});
    expect(res.body.data.last_seen_id).toBe(5);
  });

  it('up_to_id: sätter märket dit och returnerar kvarvarande oläst', async () => {
    const t = feed();
    use(t);
    const res = await post({ up_to_id: 3 });
    expect(res.body).toEqual({ success: true, data: { last_seen_id: 3, unread_count: 2 } });
  });

  it('monotont: ett lägre up_to_id sänker aldrig märket', async () => {
    const t = tables([row(1), row(2), row(3), row(4), row(5)], { news_last_seen_id: 4 });
    use(t);
    const res = await post({ up_to_id: 2 });
    expect(res.status).toBe(200);
    expect(res.body.data.last_seen_id).toBe(4);
    expect(t.users.find((u) => u.id === 'u1')!.news_last_seen_id).toBe(4);
    expect(res.body.data.unread_count).toBe(1); // rad 5
  });

  it('monotont över en sekvens: 5 → 3 → 4 → alltid max', async () => {
    const t = tables([1, 2, 3, 4, 5, 6].map((i) => row(i)));
    use(t);
    const seen = async (n: number) => (await post({ up_to_id: n })).body.data.last_seen_id;
    expect(await seen(5)).toBe(5);
    expect(await seen(3)).toBe(5);
    expect(await seen(4)).toBe(5);
    expect(await seen(6)).toBe(6);
  });

  it('en omkastad request skriver inget alls när märket inte höjs', async () => {
    const t = tables([row(1), row(2), row(3)], { news_last_seen_id: 3 });
    const db = use(t);
    await post({ up_to_id: 1 });
    const writes = db.queries.filter((q) => q.table === 'users' && q.select === null);
    expect(writes).toHaveLength(0);
  });

  it('upprepad Mark all read är idempotent', async () => {
    const t = feed();
    use(t);
    await post({});
    const res = await post({});
    expect(res.body.data).toEqual({ last_seen_id: 5, unread_count: 0 });
  });

  it('up_to_id bortom flödet kläms till senaste raden (tystar inte framtida nyheter)', async () => {
    const t = feed();
    use(t);
    const res = await post({ up_to_id: 999_999 });
    expect(res.body.data.last_seen_id).toBe(5);
    t.activity_log.push(row(7));
    const next = await get('/api/news');
    expect(next.body.meta.unread_count).toBe(1);
  });

  it('tomt flöde: märket förblir null, oläst 0', async () => {
    use(tables([]));
    const res = await post({});
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ last_seen_id: null, unread_count: 0 });
  });

  it('skriver bara anroparens egen rad', async () => {
    const t = feed();
    use(t);
    await post({});
    expect(t.users.find((u) => u.id === 'u2')!.news_last_seen_id).toBeNull();
    expect(t.users.find((u) => u.id === 'u3')!.news_last_seen_id).toBeNull();
  });

  it('saknad group_id → nuvarande märke och oläst 0, ingen skrivning', async () => {
    const t = tables([row(1)], { news_last_seen_id: 1 });
    const db = use(t);
    const res = await post({}, { group_id: null });
    expect(res.body).toEqual({ success: true, data: { last_seen_id: 1, unread_count: 0 } });
    expect(db.queries.some((q) => q.table === 'activity_log')).toBe(false);
  });

  it.each([[0], [-1], [1.5], ['5'], [null], [true], [{}], [[]]])('ogiltigt up_to_id %j → 400', async (bad) => {
    use(feed());
    const res = await post({ up_to_id: bad });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String) });
  });

  it('användare saknas → 404', async () => {
    const t = feed();
    t.users = [];
    use(t);
    const res = await post({});
    expect(res.status).toBe(404);
  });

  it('databasfel → 500 { error } utan att läcka detaljer', async () => {
    use(feed(), { errors: { activity_log: { message: 'secret detail' } } });
    const res = await post({});
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to update news state' });
  });

  it('flödet: efter seen är is_unread false för allt tidigare men nya rader blir olästa igen', async () => {
    const t = feed();
    use(t);
    await post({});
    t.activity_log.push(row(7, { actor_user_id: 'u2' }));
    const res = await get('/api/news');
    expect(res.body.data.items.map((i: any) => [i.id, i.is_unread]).slice(0, 2)).toEqual([[7, true], [5, false]]);
    expect(res.body.meta).toMatchObject({ unread_count: 1, last_seen_id: 5 });
  });
});
