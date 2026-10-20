/**
 * GET/PUT /api/settings (ADR 011 beslut 2): användarinställningar, en rad per nyckel.
 * Registrets regler (resolveSettings, customisedKeys, sanitizePatch) testas i packages/shared; här testas
 * routens koppling: auth, att bara anroparens egna rader läses/skrivs, en upsert per PUT, radering vid null,
 * felhantering och rate limit.
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

import { SETTING_DEFINITIONS, type SettingDefinition } from '@runquest/shared';
import { getSupabaseClient } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import { createApp } from '../../app.js';
import { createSettingsRouter } from '../settings.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(createApp()); });
afterAll(async () => { await server.close(); });
afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });

const ME = 'u1';
const OTHER = 'u2';
const KEY_A = 'notify.title_others';
const KEY_B = 'notify.level_up_others';
const ALL_KEYS = SETTING_DEFINITIONS.map((d) => d.key);

function use(rows: Row[] = [], options: Parameters<typeof createFakeDb>[1] = {}) {
  const tables: Record<string, Row[]> = { user_settings: rows };
  // Samma primärnyckel som migrationen: (user_id, key). Utan onConflict-träff skulle en upsert bli en dubblett.
  const db = createFakeDb(tables, { primaryKeys: { user_settings: ['user_id', 'key'] }, ...options });
  // fakeDb faller tillbaka på primärnyckeln när onConflict saknas, så upsertens argument spelas in här.
  const upserts: Array<{ rows: Row | Row[]; options: { onConflict?: string } | undefined }> = [];
  const client = {
    ...db.client,
    from: (table: string) => {
      const builder = db.client.from(table);
      const upsert = builder.upsert.bind(builder);
      builder.upsert = (rows: Row | Row[], opts?: { onConflict?: string }) => {
        upserts.push({ rows, options: opts });
        return upsert(rows, opts);
      };
      return builder;
    },
  };
  vi.mocked(getSupabaseClient).mockReturnValue(client as never);
  return { db, tables, upserts };
}

const stored = (user_id: string, key: string, value: unknown): Row => ({ user_id, key, value, updated_at: '2026-01-01T00:00:00.000Z' });
const token = (user_id = ME, group_id: string | null = 'g1') => mintToken({ user_id, group_id });
const get = (user_id = ME) => server.request('GET', '/api/settings', { token: token(user_id) });
const put = (body: unknown, user_id = ME) => server.request('PUT', '/api/settings', { token: token(user_id), body });
const mutations = (db: ReturnType<typeof use>['db']) => db.queries.filter((q) => q.mutation);

describe('GET /api/settings', () => {
  it('GET utan token ger 401', async () => {
    const { db } = use();
    const res = await server.request('GET', '/api/settings');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ success: false, error: expect.any(String), code: 'unauthorized' });
    expect(db.queries).toEqual([]);
  });

  it('GET ger defaults för en ny användare och tom customised', async () => {
    use();
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Object.keys(res.body.data.values).sort()).toEqual([...ALL_KEYS].sort());
    for (const def of SETTING_DEFINITIONS) expect(res.body.data.values[def.key]).toBe(def.default);
    expect(res.body.meta).toEqual({ customised: [] });
  });

  it('en användare ser och skriver aldrig en annans värden', async () => {
    const { db, tables } = use([stored(OTHER, KEY_A, false), stored(OTHER, KEY_B, false)]);

    // Läsning: den andras rader syns varken som värde eller som anpassade.
    const seen = await get(ME);
    expect(seen.body.data.values[KEY_A]).toBe(true);
    expect(seen.body.meta.customised).toEqual([]);
    const read = db.queries.find((q) => q.table === 'user_settings' && !q.mutation)!;
    expect(read.filters).toContainEqual({ op: 'eq', column: 'user_id', value: ME });

    // Skrivning och återställning rör bara den egna raden, även för en nyckel båda har.
    const own = await put({ values: { [KEY_A]: true, [KEY_B]: null } }, ME);
    expect(own.status).toBe(200);
    expect(tables.user_settings).toContainEqual(stored(OTHER, KEY_A, false));
    expect(tables.user_settings).toContainEqual(stored(OTHER, KEY_B, false));
    expect(tables.user_settings.filter((r) => r.user_id === ME).map((r) => r.key)).toEqual([KEY_A]);

    // Den andra användaren ser fortfarande sina egna värden.
    const theirs = await get(OTHER);
    expect(theirs.body.data.values[KEY_A]).toBe(false);
    expect(theirs.body.meta.customised.sort()).toEqual([KEY_A, KEY_B].sort());
  });

  it('GET fungerar för en token utan group_id (inställningar är per användare)', async () => {
    use([stored(ME, KEY_A, false)]);
    const res = await server.request('GET', '/api/settings', { token: token(ME, null) });
    expect(res.status).toBe(200);
    expect(res.body.data.values[KEY_A]).toBe(false);
    expect(res.body.meta.customised).toEqual([KEY_A]);
  });

  it('GET loggar ett lagrat värde med fel typ som varning och faller tillbaka på default', async () => {
    use([stored(ME, KEY_A, 'nej')]);
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.data.values[KEY_A]).toBe(true);
    expect(res.body.meta.customised).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls[0])).toContain(KEY_A);
  });

  it('GET ger 500 och loggar felet när user_settings inte kan läsas', async () => {
    use([], { errors: { user_settings: { message: 'relation "user_settings" does not exist' } } });
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const res = await get();
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: expect.any(String), code: 'internal_error' });
    expect(res.body.error).not.toContain('user_settings');
    expect(error).toHaveBeenCalled();
  });
});

describe('PUT /api/settings', () => {
  it('PUT utan token ger 401 och skriver ingenting', async () => {
    const { db } = use();
    const res = await server.request('PUT', '/api/settings', { body: { values: { [KEY_A]: false } } });
    expect(res.status).toBe(401);
    expect(db.queries).toEqual([]);
  });

  it('PUT sparar ett värde och GET visar det som anpassat', async () => {
    const { tables } = use();
    const res = await put({ values: { [KEY_A]: false } });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.values[KEY_A]).toBe(false);
    expect(res.body.meta).toEqual({ customised: [KEY_A] });
    expect(tables.user_settings).toEqual([expect.objectContaining({ user_id: ME, key: KEY_A, value: false, updated_at: expect.any(String) })]);

    const after = await get();
    expect(after.body.data.values[KEY_A]).toBe(false);
    expect(after.body.data.values[KEY_B]).toBe(true);
    expect(after.body.meta.customised).toEqual([KEY_A]);
  });

  it('PUT med flera nycklar skriver med EN upsert på user_id,key', async () => {
    const { db, tables, upserts } = use();
    const res = await put({ values: { [KEY_A]: false, [KEY_B]: false } });
    expect(res.status).toBe(200);
    const writes = mutations(db);
    expect(writes.map((q) => q.mutation)).toEqual(['upsert']);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].options).toEqual({ onConflict: 'user_id,key' });
    expect(upserts[0].rows).toEqual([
      { user_id: ME, key: KEY_A, value: false, updated_at: expect.any(String) },
      { user_id: ME, key: KEY_B, value: false, updated_at: expect.any(String) },
    ]);
    expect(tables.user_settings.map((r) => r.key).sort()).toEqual([KEY_A, KEY_B].sort());
  });

  it('PUT svarar med customised i registrets ordning, inte i body-ordningen', async () => {
    use();
    // KEY_B står före KEY_A i body men efter i registret.
    const res = await put({ values: { [KEY_B]: false, [KEY_A]: false } });
    expect(ALL_KEYS.indexOf(KEY_A)).toBeLessThan(ALL_KEYS.indexOf(KEY_B));
    expect(res.body.meta.customised).toEqual([KEY_A, KEY_B]);
    expect((await get()).body.meta.customised).toEqual([KEY_A, KEY_B]);
  });

  it('PUT skriver alltid token-användarens rader, aldrig ett user_id ur body', async () => {
    const { tables } = use([stored(OTHER, KEY_A, true), stored(OTHER, KEY_B, true)]);
    const res = await put({ user_id: OTHER, values: { [KEY_A]: false, [KEY_B]: null } }, ME);
    expect(res.status).toBe(200);
    expect(tables.user_settings).toContainEqual(stored(OTHER, KEY_A, true));
    expect(tables.user_settings).toContainEqual(stored(OTHER, KEY_B, true));
    expect(tables.user_settings.filter((r) => r.user_id === ME)).toEqual([
      expect.objectContaining({ user_id: ME, key: KEY_A, value: false }),
    ]);
    expect(tables.user_settings).toHaveLength(3);
  });

  it('PUT med user_id som inställningsnyckel ger 400 och skriver ingenting', async () => {
    const { db } = use();
    const res = await put({ values: { user_id: OTHER, [KEY_A]: false } });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: expect.any(String), code: 'invalid_request' });
    expect(mutations(db)).toEqual([]);
  });

  it('PUT med två null-nycklar återställer båda', async () => {
    const { db, tables } = use([stored(ME, KEY_A, false), stored(ME, KEY_B, false), stored(OTHER, KEY_A, false)]);
    const res = await put({ values: { [KEY_A]: null, [KEY_B]: null } });
    expect(res.status).toBe(200);
    expect(tables.user_settings).toEqual([stored(OTHER, KEY_A, false)]);
    expect(res.body.meta.customised).toEqual([]);
    const deletes = mutations(db).filter((q) => q.mutation === 'delete');
    expect(deletes).toHaveLength(1);
    expect(deletes[0].filters).toContainEqual({ op: 'in', column: 'key', value: [KEY_A, KEY_B] });
  });

  it('PUT med null återställer till default och raderar raden', async () => {
    const { db, tables } = use([stored(ME, KEY_A, false), stored(ME, KEY_B, false)]);
    const res = await put({ values: { [KEY_A]: null } });
    expect(res.status).toBe(200);
    expect(res.body.data.values[KEY_A]).toBe(true);
    expect(res.body.meta.customised).toEqual([KEY_B]);
    expect(tables.user_settings.map((r) => r.key)).toEqual([KEY_B]);

    const del = mutations(db);
    expect(del.map((q) => q.mutation)).toEqual(['delete']);
    expect(del[0].filters).toEqual(expect.arrayContaining([
      { op: 'eq', column: 'user_id', value: ME },
      { op: 'in', column: 'key', value: [KEY_A] },
    ]));
  });

  it('PUT med både värden och återställning gör en upsert och en delete', async () => {
    const { db, tables } = use([stored(ME, KEY_B, false)]);
    const res = await put({ values: { [KEY_A]: false, [KEY_B]: null } });
    expect(res.status).toBe(200);
    expect(mutations(db).map((q) => q.mutation).sort()).toEqual(['delete', 'upsert']);
    expect(tables.user_settings.map((r) => r.key)).toEqual([KEY_A]);
    expect(res.body.meta.customised).toEqual([KEY_A]);
  });

  it('PUT med tom patch är en no-op utan skrivning och svarar som GET', async () => {
    const { db } = use([stored(ME, KEY_A, false)]);
    const res = await put({ values: {} });
    expect(res.status).toBe(200);
    expect(mutations(db)).toEqual([]);
    expect(res.body.data.values[KEY_A]).toBe(false);
    expect(res.body.meta.customised).toEqual([KEY_A]);
  });

  it('PUT med okänd nyckel ger 400 och skriver ingenting', async () => {
    const { db, tables } = use([stored(ME, KEY_B, false)]);
    // Allt eller inget: den giltiga nyckeln i samma patch skrivs inte heller.
    const res = await put({ values: { [KEY_A]: false, 'notify.does_not_exist': true } });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: expect.stringContaining('notify.does_not_exist'), code: 'invalid_request' });
    expect(mutations(db)).toEqual([]);
    expect(tables.user_settings).toEqual([stored(ME, KEY_B, false)]);
  });

  it('PUT med fel värdetyp ger 400', async () => {
    const { db } = use();
    const res = await put({ values: { [KEY_A]: 'yes' } });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: expect.stringContaining(KEY_A), code: 'invalid_request' });
    expect(mutations(db)).toEqual([]);
  });

  it('PUT med en body utan values ger 400', async () => {
    const { db } = use();
    for (const body of [{}, { values: [KEY_A] }, { values: 'x' }, { [KEY_A]: false }]) {
      const res = await put(body);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ success: false, error: expect.any(String), code: 'invalid_request' });
    }
    expect(mutations(db)).toEqual([]);
  });

  it('PUT med fler än 40 nycklar ger 400', async () => {
    const { db } = use();
    const values = Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`notify.k${i}`, true]));
    const res = await put({ values });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('40');
    expect(mutations(db)).toEqual([]);
  });

  // fakeDb är synkron och interfolierar inte anropen, så testet kan inte bevisa en kapplöpning. Atomiciteten bärs av
  // att varje PUT gör EN upsert på (user_id, key) utan läs-och-skriv-steg; det låser testet "med flera nycklar skriver
  // med EN upsert" ovan. Här visas bara att två PUT i följd/parallellt inte skriver över varandras nycklar.
  it('två samtidiga PUT med olika nycklar behåller båda', async () => {
    const { tables } = use();
    const [first, second] = await Promise.all([
      put({ values: { [KEY_A]: false } }),
      put({ values: { [KEY_B]: false } }),
    ]);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(tables.user_settings.map((r) => [r.key, r.value]).sort()).toEqual([[KEY_B, false], [KEY_A, false]].sort());
    const after = await get();
    expect(after.body.meta.customised.sort()).toEqual([KEY_A, KEY_B].sort());
  });

  it('ett uttryckligt värde lika med defaulten behålls och räknas som anpassat', async () => {
    const { tables } = use();
    const defaultOfA = SETTING_DEFINITIONS.find((d) => d.key === KEY_A)!.default;
    const res = await put({ values: { [KEY_A]: defaultOfA } });
    expect(res.status).toBe(200);
    expect(tables.user_settings).toEqual([expect.objectContaining({ user_id: ME, key: KEY_A, value: defaultOfA })]);
    expect(res.body.meta.customised).toEqual([KEY_A]);
    const after = await get();
    expect(after.body.meta.customised).toEqual([KEY_A]);
  });

  it('PUT upsertar en befintlig rad på plats i stället för att skapa en dubblett', async () => {
    const { tables } = use([stored(ME, KEY_A, false)]);
    const res = await put({ values: { [KEY_A]: true } });
    expect(res.status).toBe(200);
    expect(tables.user_settings).toHaveLength(1);
    expect(tables.user_settings[0]).toMatchObject({ user_id: ME, key: KEY_A, value: true });
    expect(tables.user_settings[0].updated_at).not.toBe('2026-01-01T00:00:00.000Z');
  });

  it('PUT fungerar för en token utan group_id', async () => {
    const { tables } = use();
    const res = await server.request('PUT', '/api/settings', { token: token(ME, null), body: { values: { [KEY_A]: false } } });
    expect(res.status).toBe(200);
    expect(tables.user_settings).toEqual([expect.objectContaining({ user_id: ME, key: KEY_A })]);
  });

  it('PUT ger 500 och loggar felet när skrivningen misslyckas', async () => {
    const secret = 'duplicate key value violates constraint "user_settings_pkey" secret-detail-42';
    use([], { failWhen: (q) => (q.mutation === 'upsert' ? { message: secret } : null) });
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const res = await put({ values: { [KEY_A]: false } });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: expect.any(String), code: 'internal_error' });
    expect(JSON.stringify(res.body)).not.toContain('secret-detail-42');
    expect(error).toHaveBeenCalled();
  });

  it('PUT ger 500 utan läckor när läsningen efter en lyckad skrivning misslyckas', async () => {
    const { tables } = use([], { failWhen: (q) => (!q.mutation && q.table === 'user_settings' ? { message: 'secret-read-77' } : null) });
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    const res = await put({ values: { [KEY_A]: false } });
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('secret-read-77');
    // Skrivningen hann gå igenom; svaret är 500 eftersom nuläget inte kunde läsas tillbaka.
    expect(tables.user_settings).toEqual([expect.objectContaining({ user_id: ME, key: KEY_A, value: false })]);
  });

  it('PUT ger 500 och raderar inget när upserten misslyckas', async () => {
    const { tables } = use([stored(ME, KEY_B, false)], { failWhen: (q) => (q.mutation === 'upsert' ? { message: 'boom' } : null) });
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    const res = await put({ values: { [KEY_A]: false, [KEY_B]: null } });
    expect(res.status).toBe(500);
    expect(tables.user_settings).toEqual([stored(ME, KEY_B, false)]);
  });
});

describe('PUT /api/settings med ett annat register än det riktiga', () => {
  // Det riktiga registret har bara användarnycklar; en gruppnyckel finns bara i testet, via fabrikens parameter.
  const groupKey: SettingDefinition = { key: 'group.digest', scope: 'group', type: 'boolean', default: false };
  let factoryServer: TestServer;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/settings', createSettingsRouter([...SETTING_DEFINITIONS, groupKey]));
    factoryServer = await startServer(app);
  });
  afterAll(async () => { await factoryServer.close(); });

  it('PUT med en gruppscope-nyckel ger 400', async () => {
    const { db, tables } = use();
    const res = await factoryServer.request('PUT', '/api/settings', { token: token(), body: { values: { [KEY_A]: false, [groupKey.key]: true } } });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: expect.stringContaining(groupKey.key), code: 'invalid_request' });
    expect(mutations(db)).toEqual([]);
    expect(tables.user_settings).toEqual([]);
  });

  it('GET visar aldrig en gruppscope-nyckel', async () => {
    use();
    const res = await factoryServer.request('GET', '/api/settings', { token: token() });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data.values)).not.toContain(groupKey.key);
  });
});

describe('rate limit på PUT /api/settings', () => {
  it('anrop utan token räknas inte: limitern sitter efter auth', async () => {
    const { tables } = use();
    const app = express();
    app.use(express.json());
    app.use('/api/settings', createSettingsRouter());
    const limited = await startServer(app);
    try {
      for (let i = 0; i < 61; i++) {
        const res = await limited.request('PUT', '/api/settings', { body: { values: {} } });
        expect(res.status).toBe(401);
      }
      const authed = await limited.request('PUT', '/api/settings', { token: token(), body: { values: { [KEY_A]: false } } });
      expect(authed.status).toBe(200);
      expect(tables.user_settings).toHaveLength(1);
    } finally {
      await limited.close();
    }
  });

  it('PUT stoppas med 429 efter 60 anrop per minut, GET påverkas inte', async () => {
    use();
    const app = express();
    app.use(express.json());
    app.use('/api/settings', createSettingsRouter());
    const limited = await startServer(app);
    try {
      const attempts: number[] = [];
      for (let i = 0; i < 61; i++) {
        attempts.push((await limited.request('PUT', '/api/settings', { token: token(), body: { values: {} } })).status);
      }
      expect(attempts.slice(0, 60).every((s) => s === 200)).toBe(true);
      expect(attempts[60]).toBe(429);
      expect((await limited.request('GET', '/api/settings', { token: token() })).status).toBe(200);
    } finally {
      await limited.close();
    }
  });
});
