/**
 * GET /api/news och POST /api/news/seen (ADR 008 beslut 8–9, utökat av ADR 011 beslut 4): auth-guard,
 * gruppavgränsning, keyset-paginering (inkl. tom sida), valideringsfel, oläst-predikatet (golv, news_read,
 * påslagna notisslag) och vattenmärkets monotoni.
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
import { logger } from '../../utils/logger.js';
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

  describe('oläst-predikatet (ADR 008 beslut 8, kvarstår i ADR 011 beslut 4)', () => {
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

  describe('oläst per notisslag, golv och news_read (ADR 011 beslut 4)', () => {
    const setting = (key: string, value: unknown, user_id = 'u1'): Row => ({ user_id, key, value });
    const withExtra = (activity: Row[], extra: Record<string, Row[]>, userOver: Row = {}) => ({
      ...tables(activity, userOver),
      ...extra,
    });

    it('räknaren följer påslagna slag: ett avstängt slag räknas aldrig och ger is_unread false', async () => {
      use(withExtra(
        [row(1), row(2), row(3, { type: 'event_open', actor_user_id: null })],
        // u2:s val gäller bara u2: event_open avstängt hos någon annan ändrar inget för u1
        { user_settings: [setting('notify.level_up_others', false), setting('notify.event_open', false, 'u2')] },
      ));
      const res = await get('/api/news');
      expect(res.body.data.items.map((i: any) => [i.id, i.is_unread])).toEqual([[3, true], [2, false], [1, false]]);
      expect(res.body.meta.unread_count).toBe(1);
    });

    it('GET returnerar fortfarande rader av avstängda slag (bara oläst-flaggan ändras)', async () => {
      use(withExtra([row(1), row(2)], { user_settings: [setting('notify.level_up_others', false)] }));
      const res = await get('/api/news');
      expect(res.body.data.items.map((i: any) => i.id)).toEqual([2, 1]);
      expect(res.body.data.items.every((i: any) => i.is_unread === false)).toBe(true);
      expect(res.body.meta.unread_count).toBe(0);
    });

    it('en rad i news_read ovanför golvet är inte oläst och räknas inte', async () => {
      use(withExtra(
        [row(1), row(2), row(3), row(4)],
        // 3 är kvitterad av u1; u2:s kvitto på 4 gäller inte u1
        { news_read: [{ user_id: 'u1', activity_id: 3 }, { user_id: 'u2', activity_id: 4 }] },
        { news_last_seen_id: 1 },
      ));
      const res = await get('/api/news');
      expect(res.body.data.items.map((i: any) => [i.id, i.is_unread])).toEqual([[4, true], [3, false], [2, true], [1, false]]);
      expect(res.body.meta.unread_count).toBe(2);
    });

    it('rader under eller på golvet är lästa', async () => {
      use(withExtra([row(1), row(2), row(3), row(4)], {}, { news_last_seen_id: 3 }));
      const res = await get('/api/news');
      expect(res.body.data.items.map((i: any) => [i.id, i.is_unread])).toEqual([[4, true], [3, false], [2, false], [1, false]]);
      expect(res.body.meta.unread_count).toBe(1);
    });

    it('backfill och rader före användarens created_at är aldrig olästa', async () => {
      use(withExtra([
        row(1, { is_backfill: true }),
        row(2, { created_at: '2025-12-31T23:59:59.000Z' }),
        row(3, { created_at: USER_CREATED }), // exakt vid registreringen är inte efter den
        row(4),
      ], {}));
      const res = await get('/api/news');
      expect(res.body.data.items.map((i: any) => [i.id, i.is_unread])).toEqual([[4, true], [3, false], [2, false], [1, false]]);
      expect(res.body.meta.unread_count).toBe(1);
    });

    it('egen handling är aldrig oläst, men en vunnen eller oavgjord utmaning där jag är aktör är det', async () => {
      use(withExtra([
        row(1, { type: 'level_up', actor_user_id: 'u1' }),
        row(2, { type: 'challenge_received', actor_user_id: 'u1', target_user_id: 'u2', payload: {} }),
        row(3, { type: 'challenge_won', actor_user_id: 'u1', target_user_id: 'u2', payload: {} }),
        row(4, { type: 'challenge_draw', actor_user_id: 'u1', target_user_id: 'u2', payload: {} }),
        row(5, { type: 'challenge_won', actor_user_id: 'u2', target_user_id: 'u1', payload: {} }),
      ], {}));
      const res = await get('/api/news');
      expect(res.body.data.items.map((i: any) => [i.id, i.is_unread])).toEqual([[5, true], [4, true], [3, true], [2, false], [1, false]]);
      expect(res.body.meta.unread_count).toBe(3);
    });

    it('en vunnen utmaning där jag är aktör följer reglaget för just det slaget', async () => {
      use(withExtra(
        [row(1, { type: 'challenge_won', actor_user_id: 'u1', target_user_id: 'u2', payload: {} })],
        { user_settings: [setting('notify.challenge_won_me', false)] },
      ));
      const res = await get('/api/news');
      expect(res.body.data.items[0].is_unread).toBe(false);
      expect(res.body.meta.unread_count).toBe(0);
    });

    it('okänd framtida typ räknas aldrig', async () => {
      use(withExtra([row(1), row(2, { type: 'some_future_kind' })], {}));
      const res = await get('/api/news');
      expect(res.status).toBe(200);
      expect(res.body.data.items.map((i: any) => [i.id, i.is_unread])).toEqual([[2, false], [1, true]]);
      expect(res.body.meta.unread_count).toBe(1);
    });

    it('unread_count mättas vid 500 (520 olästa kandidater ger 500)', async () => {
      const db = use(withExtra(Array.from({ length: 520 }, (_, i) => row(i + 1)), {}));
      const res = await get('/api/news');
      expect(res.body.meta.unread_count).toBe(500);
      // Kandidatläsningen är avgränsad (501 rader), inte en olimiterad läsning av hela loggen
      const activityReads = db.queries.filter((q) => q.table === 'activity_log');
      expect(activityReads.every((q) => q.limit !== null && q.limit <= 501)).toBe(true);
    });

    it('under taket räknas exakt: 499 olästa ger 499', async () => {
      use(withExtra(Array.from({ length: 499 }, (_, i) => row(i + 1)), {}));
      const res = await get('/api/news');
      expect(res.body.meta.unread_count).toBe(499);
    });

    it('unread_count är oberoende av type- och involves-filtret', async () => {
      use(withExtra([
        row(1, { type: 'level_up' }), row(2, { type: 'title_taken' }), row(3, { type: 'event_open', actor_user_id: null }),
      ], { user_settings: [setting('notify.title_others', false)] }));
      const all = await get('/api/news');
      const filtered = await get('/api/news?type=level_up&involves=me');
      expect(filtered.body.data.items).toHaveLength(1);
      expect(filtered.body.meta.unread_count).toBe(2);
      expect(filtered.body.meta.unread_count).toBe(all.body.meta.unread_count);
    });

    it('en användare utan inställningar ger samma räknare som före ändringen (defaults)', async () => {
      // Rader av flera roller; ingen user_settings-rad finns för u1, så varje slag är på. Före ändringen räknades allt
      // utom egna handlingar, och de här raderna räknas fortfarande på samma sätt.
      use(withExtra([
        row(1, { type: 'level_up', actor_user_id: 'u1' }),
        row(2, { type: 'level_up' }),
        row(3, { type: 'title_taken', target_user_id: 'u1', payload: { title_name: 'X' } }),
        row(4, { type: 'title_unlocked', actor_user_id: null }),
        row(5, { type: 'event_open', actor_user_id: null }),
        row(6, { type: 'release_published', actor_user_id: null }),
      ], { user_settings: [setting('notify.level_up_others', false, 'u2')] }));
      const res = await get('/api/news');
      expect(res.body.data.items.map((i: any) => [i.id, i.is_unread])).toEqual([
        [6, true], [5, true], [4, true], [3, true], [2, true], [1, false],
      ]);
      expect(res.body.meta.unread_count).toBe(5);
    });

    it('ett läsfel i user_settings faller tillbaka på defaults', async () => {
      const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
      try {
        use(
          withExtra([row(1), row(2)], { user_settings: [setting('notify.level_up_others', false)] }),
          { errors: { user_settings: { message: 'connection reset' } } },
        );
        const res = await get('/api/news');
        expect(res.status).toBe(200);
        // Det avstängda slaget kunde inte läsas, så defaulten (på) gäller
        expect(res.body.meta.unread_count).toBe(2);
        expect(res.body.data.items.map((i: any) => i.is_unread)).toEqual([true, true]);
        expect(error).toHaveBeenCalled();
      } finally {
        error.mockRestore();
      }
    });

    it('ett läsfel i news_read ger 500', async () => {
      const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
      try {
        use(withExtra([row(1)], { news_read: [] }), { errors: { news_read: { message: 'connection reset' } } });
        const res = await get('/api/news');
        expect(res.status).toBe(500);
        expect(res.body).toEqual({ error: 'Failed to fetch news' });
      } finally {
        error.mockRestore();
      }
    });

    it('kvittona är de senaste 501: äldre kvitton än kandidatfönstret tränger inte ut de som behövs', async () => {
      // 600 rader, de 550 äldsta kvitterade. Kandidaterna är id 100–600; olästa är 551–600. Utan senaste-först-fönstret
      // skulle de 501 ÄLDSTA kvittona (1–501) läsas och 502–550 räknas som olästa.
      const rows = Array.from({ length: 600 }, (_, i) => row(i + 1));
      const read = Array.from({ length: 550 }, (_, i) => ({ user_id: 'u1', activity_id: i + 1 }));
      const db = use(withExtra(rows, { news_read: read }));
      const res = await get('/api/news');
      expect(res.body.meta.unread_count).toBe(50);
      const readQuery = db.queries.find((q) => q.table === 'news_read')!;
      expect(readQuery.limit).toBe(501);
    });

    it('520 rader där de 100 äldsta är kvitterade ger rätt räknare', async () => {
      const rows = Array.from({ length: 520 }, (_, i) => row(i + 1));
      const read = Array.from({ length: 100 }, (_, i) => ({ user_id: 'u1', activity_id: i + 1 }));
      use(withExtra(rows, { news_read: read }));
      const res = await get('/api/news');
      // Kandidaterna är id 20–520 (501 rader); 81 av dem (20–100) är kvitterade
      expect(res.body.meta.unread_count).toBe(420);
    });

    it('ett kandidatfönster fullt av backfill-rader tränger inte ut de riktiga olästa', async () => {
      const rows = Array.from({ length: 600 }, (_, i) => row(i + 1, i + 1 > 50 ? { is_backfill: true } : {}));
      use(withExtra(rows, {}));
      const res = await get('/api/news');
      expect(res.body.meta.unread_count).toBe(50);
    });

    it('ett kandidatfönster fullt av rader från före registreringen tränger inte ut de riktiga olästa', async () => {
      const rows = Array.from({ length: 600 }, (_, i) =>
        row(i + 1, i + 1 > 50 ? { created_at: '2025-06-01T00:00:00.000Z' } : {}));
      use(withExtra(rows, {}));
      const res = await get('/api/news');
      expect(res.body.meta.unread_count).toBe(50);
    });

    it('en användare utan created_at får räknaren 0 och is_unread false (fail-closed)', async () => {
      use(withExtra([row(1), row(2)], {}, { created_at: null }));
      const res = await get('/api/news');
      expect(res.status).toBe(200);
      expect(res.body.data.items.map((i: any) => i.is_unread)).toEqual([false, false]);
      expect(res.body.meta.unread_count).toBe(0);
    });

    it('en annan användare i en annan grupp räknar med sina egna rader, inställningar och kvitton', async () => {
      use(withExtra(
        [
          row(1), // g1
          row(2, { group_id: 'g2' }),
          row(3, { group_id: 'g2', type: 'event_open', actor_user_id: null }),
          row(4, { group_id: 'g2' }),
          row(5, { group_id: 'g2' }),
        ],
        {
          user_settings: [
            setting('notify.level_up_others', false, 'u1'), // u1:s val ska inte påverka u3
            setting('notify.event_open', false, 'u3'),
          ],
          news_read: [{ user_id: 'u1', activity_id: 2 }, { user_id: 'u3', activity_id: 4 }],
        },
      ));
      const res = await get('/api/news', { user_id: 'u3', group_id: 'g2' });
      expect(res.body.data.items.map((i: any) => [i.id, i.is_unread])).toEqual([[5, true], [4, false], [3, false], [2, true]]);
      expect(res.body.meta.unread_count).toBe(2);
    });

    it('ett anrop läser news_read och user_settings en gång var, oberoende av antal rader', async () => {
      const db = use(withExtra(Array.from({ length: 40 }, (_, i) => row(i + 1)), {}));
      await get('/api/news');
      expect(db.queries.filter((q) => q.table === 'news_read')).toHaveLength(1);
      expect(db.queries.filter((q) => q.table === 'user_settings')).toHaveLength(1);
      expect(db.queries.filter((q) => q.table === 'activity_log')).toHaveLength(2); // sidan + kandidaterna
    });

    it('user_settings och news_read läses bara för anroparen', async () => {
      const db = use(withExtra([row(1)], {}));
      await get('/api/news');
      for (const table of ['news_read', 'user_settings']) {
        const q = db.queries.find((x) => x.table === table)!;
        expect(q.filters).toContainEqual({ op: 'eq', column: 'user_id', value: 'u1' });
      }
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

  it('databasfel vid läsning av användaren → 500 (inte 404): bara PGRST116 betyder "saknas"', async () => {
    use(tables([row(1)]), { errors: { users: { message: 'connection reset' } } });
    const res = await get('/api/news');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to fetch news' });
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

  it('kvarvarande oläst följer påslagna slag och news_read, som GET', async () => {
    const t = {
      ...feed(),
      // 3 är avstängt slag, 4 är kvitterad: bara 5 återstår efter up_to_id 2
      user_settings: [{ user_id: 'u1', key: 'notify.title_others', value: false }],
      news_read: [{ user_id: 'u1', activity_id: 4 }],
    };
    t.activity_log[2] = row(3, { type: 'title_unlocked', payload: { title_name: 'X' } });
    use(t);
    const res = await post({ up_to_id: 2 });
    expect(res.body).toEqual({ success: true, data: { last_seen_id: 2, unread_count: 1 } });
  });

  it('ett läsfel i news_read ger 500 även här', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    try {
      use({ ...feed(), news_read: [] }, { errors: { news_read: { message: 'connection reset' } } });
      const res = await post({});
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to update news state' });
    } finally {
      error.mockRestore();
    }
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

  it('databasfel vid läsning av användaren → 500 (inte 404)', async () => {
    use(feed(), { errors: { users: { message: 'connection reset' } } });
    const res = await post({});
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to update news state' });
  });

  it('höjningen är en enda villkorad UPDATE (null ELLER lägre) — ingen förlorad uppdatering vid race', async () => {
    const t = feed();
    const db = use(t);
    await post({ up_to_id: 4 });
    const write = db.queries.find((q) => q.table === 'users' && q.mutation === 'update')!;
    expect(write.filters).toContainEqual({ op: 'or', column: '', value: 'news_last_seen_id.is.null,news_last_seen_id.lt.4' });
    // och märket som redan står högre rörs inte av en lägre samtidig begäran
    t.users.find((u) => u.id === 'u1')!.news_last_seen_id = 5;
    const res = await post({ up_to_id: 3 });
    expect(res.body.data.last_seen_id).toBe(5);
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
