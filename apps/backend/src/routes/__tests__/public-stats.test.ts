/**
 * GET /api/public/stats: publik (ingen token), exakt tre heltal, avgjorda utmaningar, km över alla användare,
 * 5 minuters minnescache och fel utan databasdetaljer.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { getSupabaseClient } from '../../config/database.js';
import { createApp } from '../../app.js';
import { getPublicStats, resetPublicStatsCache } from '../../services/publicStats.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(createApp()); });
afterAll(async () => { await server.close(); });
beforeEach(() => { resetPublicStatsCache(); });
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

function use(tables: Record<string, Row[]>, options: Parameters<typeof createFakeDb>[1] = {}) {
  const db = createFakeDb(tables, options);
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return db;
}

/**
 * Omsluter fakens klient: varje fråga svarar först efter delayMs (som ett riktigt nätverksanrop, så att samtidiga
 * anrop hinner överlappa) och .limit(n) kapas vid maxRows (som PostgREST max-rows).
 */
function wrapClient(client: any, opts: { delayMs?: number; maxRows?: number }) {
  const wrap = (target: any): any => new Proxy(target, {
    get(t, prop) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
          new Promise((ok) => setTimeout(ok, opts.delayMs ?? 0))
            .then(() => new Promise((done, fail) => t.then(done, fail)))
            .then(resolve, reject);
      }
      const value = t[prop];
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        if (prop === 'limit' && opts.maxRows !== undefined) args = [Math.min(Number(args[0]), opts.maxRows)];
        const out = value.apply(t, args);
        return out === t ? wrap(t) : out;
      };
    },
  });
  return { ...client, from: (table: string) => wrap(client.from(table)) };
}

const user = (id: string): Row => ({ id, name: `Secret ${id}`, email: `${id}@example.com`, password_hash: 'x' });
const run = (id: string, userId: string, distance: number): Row => ({ id, user_id: userId, distance, date: '2026-10-01' });
const challenge = (id: string, status: string): Row => ({ id, status, challenger_id: 'u1', opponent_id: 'u2' });

const get = () => server.request('GET', '/api/public/stats');

/** Svarshuvuden (helpers/http.ts returnerar bara status + body), via en egen kortlivad server. */
function getHeaders(): Promise<http.IncomingHttpHeaders> {
  return new Promise((resolve, reject) => {
    const s = http.createServer(createApp());
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      http.get({ hostname: '127.0.0.1', port, path: '/api/public/stats' }, (res) => {
        res.resume();
        res.on('end', () => s.close(() => resolve(res.headers)));
      }).on('error', reject);
    });
  });
}

describe('public stats', () => {
  it('public stats answers without a token with three integers', async () => {
    use({
      users: [user('u1'), user('u2'), user('u3')],
      challenges: [challenge('c1', 'completed'), challenge('c2', 'completed')],
      runs: [run('r1', 'u1', 5.25), run('r2', 'u2', 10.5), run('r3', 'u1', 3)],
    });
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { runners: 3, challenges: 2, km: 19 } });
    for (const v of Object.values(res.body.data)) expect(Number.isInteger(v)).toBe(true);
  });

  it('public stats exposes no fields other than runners, challenges and km', async () => {
    use({
      users: [user('u1')],
      challenges: [challenge('c1', 'completed')],
      runs: [run('r1', 'u1', 5)],
    });
    const res = await get();
    expect(Object.keys(res.body).sort()).toEqual(['data', 'success']);
    expect(Object.keys(res.body.data).sort()).toEqual(['challenges', 'km', 'runners']);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('Secret');
    expect(raw).not.toContain('example.com');
  });

  it('public stats counts only settled challenges', async () => {
    use({
      users: [user('u1')],
      challenges: [
        challenge('c1', 'completed'),
        challenge('c2', 'pending'),
        challenge('c3', 'active'),
        challenge('c4', 'completed'),
      ],
      runs: [],
    });
    const res = await get();
    expect(res.body.data.challenges).toBe(2);
  });

  it('public stats sums km over all users', async () => {
    // Fler rader än en sida (1000), med slumpade uuid i slumpad insättningsordning: summan stämmer bara om
    // sidorna läses sorterade på id.
    const runs = Array.from({ length: 2500 }, (_, i) => run(randomUUID(), i % 2 ? 'u1' : 'u2', 1.1));
    use({ users: [user('u1'), user('u2')], challenges: [], runs });
    const res = await get();
    expect(res.body.data.km).toBe(2750);
  });

  it('public stats sums a run count that is an exact multiple of the page size', async () => {
    const runs = Array.from({ length: 2000 }, (_, i) => run(`r${String(i).padStart(5, '0')}`, 'u1', 1));
    use({ users: [user('u1')], challenges: [], runs });
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.data.km).toBe(2000);
  });

  it.each([
    [[0.1, 0.2, 5.2], 6], // 5.5 avrundas uppåt (inte golv)
    [[0.1, 0.2, 5.1], 5], // 5.4 avrundas nedåt (inte tak)
    [[0.2, 0.2, 5.0], 5], // 5.4 igen, annan uppdelning
  ])('public stats rounds km %j to the nearest whole number %i', async (distances, expected) => {
    use({ users: [user('u1')], challenges: [], runs: distances.map((d, i) => run(`r${i}`, 'u1', d)) });
    const res = await get();
    expect(res.body.data.km).toBe(expected);
  });

  it('public stats keeps reading when the database caps a page below the page size', async () => {
    const runs = Array.from({ length: 750 }, () => run(randomUUID(), 'u1', 1));
    const db = createFakeDb({ users: [user('u1')], challenges: [], runs });
    vi.mocked(getSupabaseClient).mockReturnValue(wrapClient(db.client, { maxRows: 500 }) as any);
    const res = await get();
    expect(res.body.data.km).toBe(750);
  });

  it('public stats returns zeros for an empty database', async () => {
    use({ users: [], challenges: [], runs: [] });
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { runners: 0, challenges: 0, km: 0 } });
  });
});

describe('public stats cache', () => {
  it('public stats is cached and does not hit the database on every request', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T10:00:00Z'));
    const db = use({ users: [user('u1')], challenges: [], runs: [run('r1', 'u1', 4)] });

    const first = await get();
    const queriesAfterFirst = db.queries.length;
    expect(queriesAfterFirst).toBeGreaterThan(0);

    const second = await get();
    expect(second.body).toEqual(first.body);
    expect(db.queries.length).toBe(queriesAfterFirst);

    // Nära slutet av fönstret: fortfarande cachat.
    vi.setSystemTime(new Date('2026-10-13T10:04:59Z'));
    await get();
    expect(db.queries.length).toBe(queriesAfterFirst);

    // Efter 5 minuter hämtas siffrorna på nytt.
    vi.setSystemTime(new Date('2026-10-13T10:05:01Z'));
    await get();
    expect(db.queries.length).toBeGreaterThan(queriesAfterFirst);
  });

  it('public stats shares one database load between simultaneous requests', async () => {
    const db = createFakeDb({ users: [user('u1')], challenges: [], runs: [run('r1', 'u1', 4)] });
    vi.mocked(getSupabaseClient).mockReturnValue(wrapClient(db.client, { delayMs: 15 }) as any);

    await getPublicStats();
    const queriesPerLoad = db.queries.length;

    resetPublicStatsCache();
    // Anropen startar medan den första laddningen fortfarande väntar på databasen.
    const results = await Promise.all([getPublicStats(), getPublicStats(), getPublicStats()]);
    expect(db.queries.length).toBe(queriesPerLoad * 2);
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
  });

  it('public stats sends a five minute public Cache-Control header', async () => {
    use({ users: [user('u1')], challenges: [], runs: [] });
    const headers = await getHeaders();
    expect(headers['cache-control']).toBe('public, max-age=300');
  });
});

describe('public stats failures', () => {
  it.each(['users', 'challenges', 'runs'])('public stats returns 500 without database details when %s fails', async (table) => {
    use({ users: [user('u1')], challenges: [], runs: [] }, {
      errors: { [table]: { message: 'connection to db.internal.supabase.co:5432 refused (password authentication failed)' } },
    });
    const res = await get();
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to load stats', code: 'internal_error' });
    expect(JSON.stringify(res.body)).not.toContain('supabase');
  });

  it('public stats does not cache a failure', async () => {
    use({ users: [user('u1')], challenges: [], runs: [] }, { errors: { users: { message: 'boom' } } });
    const failed = await get();
    expect(failed.status).toBe(500);

    use({ users: [user('u1'), user('u2')], challenges: [], runs: [run('r1', 'u1', 7)] });
    const recovered = await get();
    expect(recovered.status).toBe(200);
    expect(recovered.body.data).toEqual({ runners: 2, challenges: 0, km: 7 });
  });

  it('public stats does not mark an error response as publicly cacheable', async () => {
    use({ users: [], challenges: [], runs: [] }, { errors: { users: { message: 'boom' } } });
    const headers = await getHeaders();
    expect(headers['cache-control'] ?? '').not.toContain('public');
  });
});
