/**
 * POST /api/news/read och pruningen i POST /api/news/seen (ADR 011 beslut 4): kvittering av enskilda rader,
 * gruppavgränsning, golvet, idempotens, att räknaren är exakt den som GET /api/news visar direkt efter skrivningen,
 * och att läst-status är privat. Oläst-predikatet i sig testas i shared och i news.test.ts; här testas routens koppling.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import express from 'express';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from '../../config/database.js';
import { createApp } from '../../app.js';
import { createNewsRouter } from '../news.js';
import { logger } from '../../utils/logger.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(createApp()); });
afterAll(async () => { await server.close(); });
afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });

const USER_CREATED = '2026-01-01T00:00:00.000Z';
const AFTER_USER = '2026-06-01T00:00:00.000Z';
const ME = 'u1';
const OTHER = 'u2';

function row(id: number, over: Row = {}): Row {
  return {
    id, group_id: 'g1', type: 'level_up', actor_user_id: OTHER, target_user_id: null, payload: { level: id }, payload_version: 1,
    dedupe_key: `k${id}`, is_backfill: false, occurred_at: AFTER_USER, created_at: AFTER_USER, ...over,
  };
}

interface World {
  activity_log: Row[];
  users: Row[];
  news_read: Row[];
  user_settings: Row[];
}

function world(activity: Row[], over: { floor?: number | null; news_read?: Row[]; user_settings?: Row[]; otherFloor?: number | null } = {}): World {
  return {
    activity_log: activity,
    users: [
      { id: ME, name: 'Me', profile_picture: null, group_id: 'g1', created_at: USER_CREATED, news_last_seen_id: over.floor ?? null },
      { id: OTHER, name: 'Karl', profile_picture: null, group_id: 'g1', created_at: USER_CREATED, news_last_seen_id: over.otherFloor ?? null },
      { id: 'u3', name: 'Outsider', profile_picture: null, group_id: 'g2', created_at: USER_CREATED, news_last_seen_id: null },
    ],
    news_read: over.news_read ?? [],
    user_settings: over.user_settings ?? [],
  };
}

function use(t: World, options: Parameters<typeof createFakeDb>[1] = {}) {
  // Samma primärnyckel som migrationen (user_id, activity_id): en upsert utan krock ska bli en ny rad, annars ingen.
  const db = createFakeDb(t as unknown as Record<string, Row[]>, { primaryKeys: { news_read: ['user_id', 'activity_id'] }, ...options });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as never);
  return db;
}

const token = (user_id = ME, group_id: string | null = 'g1') => mintToken({ user_id, group_id });
const read = (body: unknown, user_id = ME, group_id: string | null = 'g1') =>
  server.request('POST', '/api/news/read', { token: token(user_id, group_id), body });
const seen = (body: unknown = {}, user_id = ME) => server.request('POST', '/api/news/seen', { token: token(user_id), body });
const getNews = (user_id = ME) => server.request('GET', '/api/news', { token: token(user_id) });
const receipts = (t: World, user_id = ME) => t.news_read.filter((r) => r.user_id === user_id).map((r) => Number(r.activity_id)).sort((a, b) => a - b);

it('POST /news/read utan token ger 401', async () => {
  const db = use(world([row(1)]));
  const res = await server.request('POST', '/api/news/read', { body: { ids: [1] } });
  expect(res.status).toBe(401);
  expect(res.body).toEqual({ error: expect.any(String) });
  expect(db.queries).toEqual([]);
});

it('kvitterar en rad utan att röra äldre olästa rader', async () => {
  const t = world([row(1), row(2), row(3)]);
  use(t);
  const res = await read({ ids: [3] });

  expect(res.status).toBe(200);
  expect(res.body).toEqual({ success: true, data: { unread_count: 2 } });
  expect(receipts(t)).toEqual([3]);
  // De äldre raderna är fortfarande olästa i flödet, och golvet är orört
  const feed = await getNews();
  expect(feed.body.data.items.map((i: any) => [i.id, i.is_unread])).toEqual([[3, false], [2, true], [1, true]]);
  expect(t.users.find((u) => u.id === ME)!.news_last_seen_id).toBeNull();
});

it('är idempotent: samma id två gånger ger en rad och oförändrad räknare', async () => {
  const t = world([row(1), row(2), row(3)]);
  use(t);
  const first = await read({ ids: [2] });
  const second = await read({ ids: [2] });

  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  expect(second.body).toEqual(first.body);
  expect(first.body.data.unread_count).toBe(2);
  expect(receipts(t)).toEqual([2]);
});

it('ett id i en annan grupp ignoreras tyst (inget fel, ingen rad)', async () => {
  const t = world([row(1), row(2, { group_id: 'g2', actor_user_id: 'u3' }), row(3)]);
  use(t);
  const res = await read({ ids: [2, 99] }); // 2 finns i g2, 99 finns inte alls

  expect(res.status).toBe(200);
  expect(res.body).toEqual({ success: true, data: { unread_count: 2 } });
  expect(t.news_read).toEqual([]);

  // Det fungerar att blanda: det egna gruppens id skrivs, det andra ignoreras
  const mixed = await read({ ids: [2, 3] });
  expect(mixed.status).toBe(200);
  expect(receipts(t)).toEqual([3]);
});

it('ett id på eller under golvet ger ingen rad', async () => {
  const t = world([row(1), row(2), row(3), row(4)], { floor: 2 });
  use(t);
  const res = await read({ ids: [1, 2] });

  expect(res.status).toBe(200);
  expect(res.body.data.unread_count).toBe(2); // 3 och 4
  expect(t.news_read).toEqual([]);

  const above = await read({ ids: [2, 3] });
  expect(above.status).toBe(200);
  expect(receipts(t)).toEqual([3]);
});

it('tom lista, dubblerade id, icke-heltal, noll eller negativa och fler än 50 id ger 400', async () => {
  const t = world([row(1), row(2)]);
  const db = use(t);
  const fifty = Array.from({ length: 50 }, (_, i) => i + 1);
  const bad: Array<[string, unknown]> = [
    ['saknad kropp', undefined],
    ['ids saknas', {}],
    ['ids är inte en lista', { ids: 1 }],
    ['ids är en sträng', { ids: '1' }],
    ['tom lista', { ids: [] }],
    ['dubblerade id', { ids: [1, 1] }],
    ['decimaltal', { ids: [1.5] }],
    ['sträng i listan', { ids: ['1'] }],
    ['null i listan', { ids: [null] }],
    ['noll', { ids: [0] }],
    ['negativt', { ids: [-1] }],
    ['inte ett säkert heltal', { ids: [Number.MAX_SAFE_INTEGER + 2] }],
    ['51 id', { ids: [...fifty, 51] }],
  ];
  for (const [label, body] of bad) {
    const res = await read(body);
    expect(res.status, label).toBe(400);
    expect(res.body, label).toEqual({ error: expect.any(String) });
  }
  expect(db.queries.filter((q) => q.mutation)).toEqual([]);

  // Gränsfallen är giltiga: ett id och exakt 50 id
  expect((await read({ ids: [1] })).status).toBe(200);
  expect((await read({ ids: fifty })).status).toBe(200);
});

it('räknaren sjunker med ett per nyligen läst notis-rad', async () => {
  const t = world([row(1), row(2), row(3), row(4)]);
  use(t);
  expect((await getNews()).body.meta.unread_count).toBe(4);

  const one = await read({ ids: [4] });
  expect(one.body.data.unread_count).toBe(3);
  const two = await read({ ids: [3, 2] });
  expect(two.body.data.unread_count).toBe(1);
  // En redan läst rad i en senare batch sänker inte igen
  const again = await read({ ids: [2, 1] });
  expect(again.body.data.unread_count).toBe(0);

  // Exakt det GET /api/news visar direkt efter skrivningen
  expect((await getNews()).body.meta.unread_count).toBe(again.body.data.unread_count);
});

it('en avstängd eller egen rad påverkar inte räknaren när den kvitteras', async () => {
  const t = world(
    [
      row(1), // oläst notis
      row(2, { type: 'event_open', actor_user_id: null }), // oläst notis
      row(3, { actor_user_id: ME }), // egen handling: aldrig oläst
      row(4, { type: 'title_unlocked', payload: { title_name: 'X' } }), // avstängt slag
    ],
    { user_settings: [{ user_id: ME, key: 'notify.title_others', value: false }] },
  );
  use(t);
  const before = (await getNews()).body.meta.unread_count;
  expect(before).toBe(2);

  const res = await read({ ids: [3, 4] });
  expect(res.status).toBe(200);
  expect(res.body.data.unread_count).toBe(before);
  expect((await getNews()).body.meta.unread_count).toBe(before);
});

it('POST /news/seen höjer golvet och prunar news_read-rader på eller under nya golvet', async () => {
  const t = world([row(1), row(2), row(3), row(4), row(5)], {
    news_read: [
      { user_id: ME, activity_id: 1 },
      { user_id: ME, activity_id: 3 },
      { user_id: ME, activity_id: 4 },
      { user_id: OTHER, activity_id: 2 }, // någon annans kvitto rörs inte
    ],
  });
  use(t);
  const res = await seen({ up_to_id: 3 });

  expect(res.status).toBe(200);
  expect(res.body).toEqual({ success: true, data: { last_seen_id: 3, unread_count: 1 } }); // 5 (4 är kvitterad)
  expect(t.users.find((u) => u.id === ME)!.news_last_seen_id).toBe(3);
  expect(receipts(t)).toEqual([4]);
  expect(receipts(t, OTHER)).toEqual([2]);
});

it('golvet kan inte sänkas', async () => {
  const t = world([row(1), row(2), row(3), row(4), row(5)], {
    floor: 4,
    news_read: [{ user_id: ME, activity_id: 5 }],
  });
  use(t);
  const lower = await seen({ up_to_id: 2 });
  expect(lower.status).toBe(200);
  expect(lower.body.data.last_seen_id).toBe(4);
  expect(t.users.find((u) => u.id === ME)!.news_last_seen_id).toBe(4);
  // Ett kvitto ovanför golvet överlever ett försök att sänka det
  expect(receipts(t)).toEqual([5]);

  // /read lägger aldrig en rad på eller under golvet, så det kan inte heller användas för att "öppna" gamla rader
  const blocked = await read({ ids: [1, 2, 3, 4] });
  expect(blocked.status).toBe(200);
  expect(blocked.body.data.unread_count).toBe(0); // 5 är kvitterad, resten ligger under golvet
  expect(receipts(t)).toEqual([5]);
  expect(t.users.find((u) => u.id === ME)!.news_last_seen_id).toBe(4);
});

it('en användare kan inte kvittera eller se en annans läst-status', async () => {
  const t = world([row(1), row(2), row(3)], {
    news_read: [{ user_id: OTHER, activity_id: 1 }, { user_id: OTHER, activity_id: 2 }],
    otherFloor: 0,
  });
  use(t);

  // En user_id i kroppen ignoreras: raden skrivs för token-användaren, aldrig för den som anges
  const spoof = await read({ ids: [3], user_id: OTHER });
  expect(spoof.status).toBe(200);
  expect(receipts(t, ME)).toEqual([3]);
  expect(receipts(t, OTHER)).toEqual([1, 2]);

  // Svaret bär bara min egen räknare, inga id:n eller kvitton
  expect(Object.keys(spoof.body.data)).toEqual(['unread_count']);
  expect(spoof.body.data.unread_count).toBe(2); // 1 och 2 är olästa för mig trots att OTHER läst dem

  // Pruningen i /seen och /read rör bara anroparens egna rader
  await seen({ up_to_id: 3 }, ME);
  expect(receipts(t, OTHER)).toEqual([1, 2]);
  await read({ ids: [1] }, OTHER);
  expect(receipts(t, OTHER)).toEqual([1, 2]); // OTHER:s golv är 0: inget prunas, och 1 fanns redan
  expect(receipts(t, ME)).toEqual([]); // mitt golv är 3 efter /seen: mitt eget kvitto prunades
});

describe('POST /api/news/read: kvittering och rensning', () => {
  it('rensar anroparens kvitton på eller under golvet i samma anrop, men inte ovanför och inte andras', async () => {
    const t = world([row(1), row(2), row(3), row(4)], {
      floor: 2,
      news_read: [
        { user_id: ME, activity_id: 1 },
        { user_id: ME, activity_id: 2 },
        { user_id: ME, activity_id: 4 },
        { user_id: OTHER, activity_id: 1 },
      ],
    });
    use(t);
    const res = await read({ ids: [3] });

    expect(res.status).toBe(200);
    expect(receipts(t)).toEqual([3, 4]);
    expect(receipts(t, OTHER)).toEqual([1]);
  });

  it('upsert sker före rensningen och använder ignoreDuplicates på användare + rad', async () => {
    const t = world([row(1), row(2), row(3)], { floor: 1, news_read: [{ user_id: ME, activity_id: 1 }] });
    const db = use(t);
    const upserts: Array<{ rows: Row | Row[]; options: Record<string, unknown> | undefined }> = [];
    const client = vi.mocked(getSupabaseClient)() as any;
    const from = client.from;
    client.from = (table: string) => {
      const builder = from(table);
      const upsert = builder.upsert.bind(builder);
      builder.upsert = (rows: Row | Row[], opts?: Record<string, unknown>) => { upserts.push({ rows, options: opts }); return upsert(rows, opts); };
      return builder;
    };
    await read({ ids: [2, 3] });

    expect(upserts).toHaveLength(1);
    expect(upserts[0].options).toMatchObject({ onConflict: 'user_id,activity_id', ignoreDuplicates: true });
    expect(upserts[0].rows).toEqual([{ user_id: ME, activity_id: 2 }, { user_id: ME, activity_id: 3 }]);
    const mutations = db.queries.filter((q) => q.mutation).map((q) => q.mutation);
    expect(mutations).toEqual(['upsert', 'delete']);
  });

  it('slår upp id:n mot anroparens grupp i en fråga, även när bigint-id:n kommer som strängar', async () => {
    const t = world([row(1), row(2)]);
    const db = use(t);
    // PostgREST kan svara med en bigint som sträng: aktivitetsraderna returneras här med id som text
    const client = vi.mocked(getSupabaseClient)() as any;
    const from = client.from;
    client.from = (table: string) => {
      const builder = from(table);
      if (table !== 'activity_log') return builder;
      const run = builder.then.bind(builder);
      builder.then = (resolve: (v: any) => void, reject?: (e: unknown) => void) =>
        run((r: any) => resolve({ ...r, data: Array.isArray(r.data) ? r.data.map((x: Row) => ({ ...x, id: String(x.id) })) : r.data }), reject);
      return builder;
    };
    const res = await read({ ids: [1, 2] });

    expect(res.status).toBe(200);
    expect(receipts(t)).toEqual([1, 2]);
    expect(t.news_read.every((r) => typeof r.activity_id === 'number')).toBe(true);
    expect(res.body.data.unread_count).toBe(0);
    const lookups = db.queries.filter((q) => q.table === 'activity_log' && q.filters.some((f) => f.op === 'in'));
    expect(lookups).toHaveLength(1);
    expect(lookups[0].filters).toEqual(expect.arrayContaining([{ op: 'eq', column: 'group_id', value: 'g1' }]));
  });

  it('en token utan group_id ger räknaren 0 utan att skriva eller läsa något', async () => {
    const t = world([row(1)]);
    const db = use(t);
    const res = await read({ ids: [1] }, ME, null);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { unread_count: 0 } });
    expect(db.queries).toEqual([]);
    expect(t.news_read).toEqual([]);
  });

  it('en användare som inte finns ger 404 och ingen skrivning', async () => {
    const t = world([row(1)]);
    const db = use(t);
    const res = await read({ ids: [1] }, 'ghost');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'User not found' });
    expect(db.queries.filter((q) => q.mutation)).toEqual([]);
  });

  it('en misslyckad rensning loggas men ger ändå 200 med räknaren', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const t = world([row(1), row(2), row(3)], { floor: 1, news_read: [{ user_id: ME, activity_id: 1 }] });
    use(t, { failWhen: (q) => (q.mutation === 'delete' ? { message: 'delete failed' } : null) });
    const res = await read({ ids: [2] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { unread_count: 1 } });
    expect(receipts(t)).toEqual([1, 2]); // rensningen föll, upserten stod kvar
    expect(error).toHaveBeenCalled();
  });

  it('en misslyckad upsert ger 500 utan att läcka detaljer, och ingen rensning körs', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const t = world([row(1), row(2)]);
    const db = use(t, { failWhen: (q) => (q.mutation === 'upsert' ? { message: 'secret db detail' } : null) });
    const res = await read({ ids: [2] });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to update news state' });
    expect(JSON.stringify(res.body)).not.toContain('secret');
    expect(db.queries.filter((q) => q.mutation === 'delete')).toEqual([]);
    expect(error).toHaveBeenCalled();
  });

  it('ett fel i id-uppslagningen ger 500 utan skrivning', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    const t = world([row(1)]);
    const db = use(t, { failWhen: (q) => (q.table === 'activity_log' && q.filters.some((f) => f.op === 'in') ? { message: 'boom' } : null) });
    const res = await read({ ids: [1] });

    expect(res.status).toBe(500);
    expect(db.queries.filter((q) => q.mutation)).toEqual([]);
  });
});

describe('POST /api/news/seen: pruning är best-effort', () => {
  it('en misslyckad pruning loggas men golvet är höjt och svaret är 200', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const t = world([row(1), row(2), row(3)], { news_read: [{ user_id: ME, activity_id: 1 }] });
    use(t, { failWhen: (q) => (q.table === 'news_read' && q.mutation === 'delete' ? { message: 'delete failed' } : null) });
    const res = await seen({ up_to_id: 2 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { last_seen_id: 2, unread_count: 1 } });
    expect(t.users.find((u) => u.id === ME)!.news_last_seen_id).toBe(2);
    expect(error).toHaveBeenCalled();
  });

  it('en grupp utan rader höjer inget golv och prunar inget', async () => {
    const t = world([]);
    const db = use(t);
    const res = await seen({});
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ last_seen_id: null, unread_count: 0 });
    expect(db.queries.filter((q) => q.mutation)).toEqual([]);
  });
});

describe('rate limit på POST /api/news/read', () => {
  // Ett batchat gest-flöde (READ_FLUSH_MS = 300 ms) ger som mest ca 200 anrop per minut från en enda användare, och bara
  // när varje flush innehåller en ny oläst rad. Gränsen ligger över det taket så att den aldrig märks vid riktig användning.
  const LIMIT = 240;

  it('anrop utan token räknas inte: limitern sitter efter auth', async () => {
    use(world([row(1)]));
    const app = express();
    app.use(express.json());
    app.use('/api/news', createNewsRouter());
    const limited = await startServer(app);
    try {
      for (let i = 0; i < LIMIT + 1; i++) {
        expect((await limited.request('POST', '/api/news/read', { body: { ids: [1] } })).status).toBe(401);
      }
      expect((await limited.request('POST', '/api/news/read', { token: token(), body: { ids: [1] } })).status).toBe(200);
    } finally {
      await limited.close();
    }
  });

  it('stoppas med 429 efter 240 anrop per minut, GET och seen påverkas inte', async () => {
    use(world([row(1)]));
    const app = express();
    app.use(express.json());
    app.use('/api/news', createNewsRouter());
    const limited = await startServer(app);
    try {
      const statuses: number[] = [];
      for (let i = 0; i < LIMIT + 1; i++) {
        statuses.push((await limited.request('POST', '/api/news/read', { token: token(), body: { ids: [1] } })).status);
      }
      expect(statuses.slice(0, LIMIT).every((s) => s === 200)).toBe(true);
      expect(statuses[LIMIT]).toBe(429);
      expect((await limited.request('GET', '/api/news', { token: token() })).status).toBe(200);
      expect((await limited.request('POST', '/api/news/seen', { token: token(), body: {} })).status).toBe(200);
    } finally {
      await limited.close();
    }
  }, 60_000);
});
