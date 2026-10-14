/**
 * Strava-webhookens publika rutt (ADR 010 beslut 2, 3 och 5): GET-verifieringen, POST-skyddsmodellens steg i ordning och
 * lagringen. Routern monteras i en egen, bar Express-app (ingen global JSON-parser) så att testet bevisar att routern bär sin
 * egen 10 kB-gräns och tar en injicerad `onEventStored`. Monteringen i createApp (före den globala parsern, utan JWT, ingen
 * IP-gräns) täcks av app-wiring.test.ts och av burst-testet nedan, som går genom hela appen.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
import { createStravaWebhookRouter } from '../stravaWebhook.js';
import { STRAVA_WEBHOOK_CALLBACK_URL } from '../../scripts/stravaWebhookSubscription.js';
import { STRAVA_WEBHOOK_PATH, WEBHOOK_MAX_UNPROCESSED_PER_OWNER } from '../../services/stravaWebhook/constants.js';
import { buildWebhookDedupeKey } from '../../services/stravaWebhook/dedupeKey.js';
import { logger } from '../../utils/logger.js';
import { createFakeDb, type FakeDbOptions, type Row } from './helpers/fakeDb.js';
import { startServer, type TestServer } from './helpers/http.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migration046 = readFileSync(resolve(__dirname, '../../../migrations/046_strava_webhook_events.sql'), 'utf8');

const VERIFY_TOKEN = 'verify-token-for-tests-0123456789abcdef';
const SUBSCRIPTION_ID = 4242;
const OWNER_ID = 777;
const EVENTS = 'strava_webhook_events';

const validEvent = (over: Record<string, unknown> = {}) => ({
  object_type: 'activity',
  object_id: 9001,
  aspect_type: 'create',
  owner_id: OWNER_ID,
  subscription_id: SUBSCRIPTION_ID,
  event_time: 1_760_000_000,
  updates: {},
  ...over,
});

function useDb(extra: Record<string, Row[]> = {}, options: FakeDbOptions = {}) {
  const tables: Record<string, Row[]> = {
    strava_tokens: [{ user_id: 'user-777', strava_athlete_id: OWNER_ID }, { user_id: 'user-null', strava_athlete_id: null }],
    [EVENTS]: [],
    ...extra,
  };
  const db = createFakeDb(tables, options);
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return { ...db, tables };
}

const toQuery = (params: Record<string, string>) => `?${new URLSearchParams(params).toString()}`;
const verifyUrl = (over: Record<string, string> = {}) =>
  `${STRAVA_WEBHOOK_PATH}${toQuery({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': 'challenge-abc123', ...over })}`;

let servers: TestServer[] = [];
async function serve(onEventStored?: () => void): Promise<TestServer> {
  const app = express();
  app.use(STRAVA_WEBHOOK_PATH, createStravaWebhookRouter(onEventStored ? { onEventStored } : undefined));
  const server = await startServer(app);
  servers.push(server);
  return server;
}
async function serveFullApp(): Promise<TestServer> {
  const server = await startServer(createApp());
  servers.push(server);
  return server;
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  process.env.STRAVA_WEBHOOK_VERIFY_TOKEN = VERIFY_TOKEN;
  process.env.STRAVA_WEBHOOK_SUBSCRIPTION_ID = String(SUBSCRIPTION_ID);
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
  warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
});
afterEach(async () => {
  delete process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;
  delete process.env.STRAVA_WEBHOOK_SUBSCRIPTION_ID;
  await Promise.all(servers.map((s) => s.close()));
  servers = [];
  vi.restoreAllMocks();
  vi.mocked(getSupabaseClient).mockReset();
});

describe('GET webhook verification', () => {
  it('GET webhook echoes hub.challenge when verify_token matches', async () => {
    const server = await serve();
    const res = await server.request('GET', verifyUrl());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ 'hub.challenge': 'challenge-abc123' });
  });

  it('GET webhook returns 403 on wrong verify_token and does not echo the challenge', async () => {
    const server = await serve();
    const wrongs = [
      'x'.repeat(VERIFY_TOKEN.length), // samma längd
      'short', // annan längd: timingSafeEqual kastar på ojämna längder, det får aldrig bli ett 500
      '',
    ];
    for (const token of wrongs) {
      const res = await server.request('GET', verifyUrl({ 'hub.verify_token': token }));
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain('challenge-abc123');
    }
    // saknad och upprepad parameter (qs ger en lista) är inte heller en träff
    const missing = await server.request('GET', `${STRAVA_WEBHOOK_PATH}${toQuery({ 'hub.mode': 'subscribe', 'hub.challenge': 'challenge-abc123' })}`);
    expect(missing.status).toBe(403);
    const twice = await server.request('GET', `${verifyUrl()}&hub.verify_token=${VERIFY_TOKEN}`);
    expect(twice.status).toBe(403);
    expect(JSON.stringify(twice.body)).not.toContain('challenge-abc123');
  });

  it('GET webhook returns 403 when hub.mode is not subscribe', async () => {
    const server = await serve();
    for (const mode of ['unsubscribe', 'SUBSCRIBE', '']) {
      const res = await server.request('GET', verifyUrl({ 'hub.mode': mode }));
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain('challenge-abc123');
    }
    const noMode = await server.request('GET', `${STRAVA_WEBHOOK_PATH}${toQuery({ 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': 'challenge-abc123' })}`);
    expect(noMode.status).toBe(403);
  });

  it('GET webhook returns 503 when the verify token is not configured', async () => {
    const server = await serve();
    for (const value of [undefined, '']) {
      if (value === undefined) delete process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;
      else process.env.STRAVA_WEBHOOK_VERIFY_TOKEN = value;
      // även en tom token från anroparen får inte matcha en saknad konfiguration
      const res = await server.request('GET', verifyUrl({ 'hub.verify_token': '' }));
      expect(res.status).toBe(503);
      expect(JSON.stringify(res.body)).not.toMatch(/token|STRAVA|env|variable|configured/i);
      expect(JSON.stringify(res.body)).not.toContain('challenge-abc123');
    }
  });
});

describe('POST webhook', () => {
  it('POST webhook stores the event and returns 200 without waiting for processing', async () => {
    const { tables } = useDb();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const onEventStored = vi.fn(() => gate); // en långsam efterföljare: svaret får inte vänta på den
    const server = await serve(onEventStored as unknown as () => void);

    const res = await server.request('POST', STRAVA_WEBHOOK_PATH, { body: validEvent() });

    expect(res.status).toBe(200);
    expect(tables[EVENTS]).toHaveLength(1);
    expect(tables[EVENTS][0]).toMatchObject({ object_type: 'activity', object_id: 9001, aspect_type: 'create', owner_id: OWNER_ID });
    expect(onEventStored).toHaveBeenCalledTimes(1);
    release();
  });

  it('POST webhook with wrong subscription_id returns 403 and stores nothing', async () => {
    const { tables, queries } = useDb();
    const server = await serve();
    for (const subscription_id of [SUBSCRIPTION_ID + 1, 1]) {
      const res = await server.request('POST', STRAVA_WEBHOOK_PATH, { body: validEvent({ subscription_id, title: 'Secret title' }) });
      expect(res.status).toBe(403);
    }
    // 403 går före formkontrollen: en falsk anropare får inget som skiljer "fel id" från "fel form"
    const malformedToo = await server.request('POST', STRAVA_WEBHOOK_PATH, { body: validEvent({ subscription_id: 1, object_id: 'x' }) });
    expect(malformedToo.status).toBe(403);
    expect(tables[EVENTS]).toHaveLength(0);
    expect(queries).toHaveLength(0);
    // varningen bär ingen brödtext
    expect(warn).toHaveBeenCalled();
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain('Secret title');
    expect(logged).not.toContain('9001');
  });

  it('POST webhook returns 200 and stores nothing when the subscription id is not configured', async () => {
    const { tables, queries } = useDb();
    const server = await serve();
    // saknad, tom och ett värde som inte är ett heltal räknas alla som "inte konfigurerad"
    for (const value of [undefined, '', 'abc', '42.5', '-4', '0']) {
      if (value === undefined) delete process.env.STRAVA_WEBHOOK_SUBSCRIPTION_ID;
      else process.env.STRAVA_WEBHOOK_SUBSCRIPTION_ID = value;
      warn.mockClear();
      const res = await server.request('POST', STRAVA_WEBHOOK_PATH, { body: validEvent() });
      expect(res.status).toBe(200);
      expect(warn).toHaveBeenCalledTimes(1);
    }
    expect(tables[EVENTS]).toHaveLength(0);
    expect(queries).toHaveLength(0);
  });

  it('POST webhook with malformed body returns 400', async () => {
    const { tables } = useDb();
    const server = await serve();
    const bad: Array<[string, unknown]> = [
      ['object_id as text', validEvent({ object_id: '9001' })],
      ['object_id with decimals', validEvent({ object_id: 1.5 })],
      ['object_id missing', (({ object_id: _o, ...rest }) => rest)(validEvent())],
      ['object_id zero', validEvent({ object_id: 0 })],
      ['owner_id negative', validEvent({ owner_id: -1 })],
      ['owner_id beyond safe integers', validEvent({ owner_id: 2 ** 60 })],
      ['event_time as ISO string', validEvent({ event_time: '2026-10-14T10:00:00Z' })],
      ['event_time with decimals', validEvent({ event_time: 1_760_000_000.5 })],
      ['event_time outside the date range', validEvent({ event_time: 9e15 })],
      ['subscription_id as text', validEvent({ subscription_id: String(SUBSCRIPTION_ID) })],
      ['object_type not a string', validEvent({ object_type: 7 })],
      ['aspect_type missing', (({ aspect_type: _a, ...rest }) => rest)(validEvent())],
      ['an array body', [validEvent()]],
      ['a string body', 'activity'],
      ['an empty object', {}],
    ];
    for (const [label, body] of bad) {
      const res = await server.request('POST', STRAVA_WEBHOOK_PATH, { body });
      expect({ label, status: res.status }).toEqual({ label, status: 400 });
    }
    expect(tables[EVENTS]).toHaveLength(0);
  });

  it('POST webhook with an unknown object_type or aspect_type returns 200 and stores nothing', async () => {
    const { tables, queries } = useDb();
    const onEventStored = vi.fn();
    const server = await serve(onEventStored);
    for (const over of [{ object_type: 'segment' }, { aspect_type: 'archive' }, { object_type: 'Activity' }, { object_type: '' }]) {
      const res = await server.request('POST', STRAVA_WEBHOOK_PATH, { body: validEvent(over) });
      expect(res.status).toBe(200);
    }
    expect(tables[EVENTS]).toHaveLength(0);
    expect(queries).toHaveLength(0); // billig kontroll: ingen databasläsning för en händelse vi ändå släpper
    expect(onEventStored).not.toHaveBeenCalled();
  });

  it('POST webhook with an unknown owner returns 200 and stores nothing', async () => {
    const { tables } = useDb();
    const onEventStored = vi.fn();
    const server = await serve(onEventStored);
    const res = await server.request('POST', STRAVA_WEBHOOK_PATH, { body: validEvent({ owner_id: 5550123 }) });
    expect(res.status).toBe(200);
    expect(tables[EVENTS]).toHaveLength(0);
    expect(onEventStored).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('5550123');
  });

  it('POST webhook answers a stored and a discarded event with the same response', async () => {
    useDb();
    const server = await serve();
    const stored = await server.request('POST', STRAVA_WEBHOOK_PATH, { body: validEvent() });
    const unknownOwner = await server.request('POST', STRAVA_WEBHOOK_PATH, { body: validEvent({ owner_id: 5550123 }) });
    const unknownType = await server.request('POST', STRAVA_WEBHOOK_PATH, { body: validEvent({ object_type: 'segment' }) });
    expect(unknownOwner).toEqual(stored); // annars går det att räkna ut vilka Strava-id:n som är medlemmar
    expect(unknownType).toEqual(stored);
  });

  it('POST webhook with a body above 10 kB is rejected', async () => {
    const { tables, queries } = useDb();
    const server = await serve();
    // routern bär gränsen själv (bar app utan global parser): 11 kB över, 5 kB under
    const over = await server.request('POST', STRAVA_WEBHOOK_PATH, { body: validEvent({ updates: { title: 'x'.repeat(11 * 1024) } }) });
    expect(over.status).toBe(413);
    expect(over.body).toEqual({ error: expect.any(String) });
    expect(tables[EVENTS]).toHaveLength(0);
    expect(queries).toHaveLength(0);

    const under = await server.request('POST', STRAVA_WEBHOOK_PATH, { body: validEvent({ updates: { title: 'x'.repeat(5 * 1024) } }) });
    expect(under.status).toBe(200);
    expect(tables[EVENTS]).toHaveLength(1);
  });

  it('POST webhook stores a duplicate event only once and still returns 200', async () => {
    const { tables } = useDb();
    const onEventStored = vi.fn();
    const server = await serve(onEventStored);
    const first = await server.request('POST', STRAVA_WEBHOOK_PATH, { body: validEvent({ updates: { private: 'true' } }) });
    const redelivery = await server.request('POST', STRAVA_WEBHOOK_PATH, { body: validEvent({ updates: { private: 'true' } }) });
    expect(first.status).toBe(200);
    expect(redelivery.status).toBe(200);
    expect(tables[EVENTS]).toHaveLength(1);
    expect(onEventStored).toHaveBeenCalledTimes(1); // väcker bara när en rad faktiskt lagrades

    // en annan ändring i samma sekund är en annan händelse
    const otherChange = await server.request('POST', STRAVA_WEBHOOK_PATH, { body: validEvent({ updates: { type: 'Ride' } }) });
    expect(otherChange.status).toBe(200);
    expect(tables[EVENTS]).toHaveLength(2);
    expect(onEventStored).toHaveBeenCalledTimes(2);
  });

  it('POST webhook returns 500 when the event cannot be stored', async () => {
    const { tables } = useDb({}, { failWhen: (q) => (q.mutation === 'upsert' ? { message: 'connection reset', code: '08006' } as { message: string } : null) });
    const onEventStored = vi.fn();
    const server = await serve(onEventStored);
    const res = await server.request('POST', STRAVA_WEBHOOK_PATH, { body: validEvent() });
    expect(res.status).toBe(500);
    expect(tables[EVENTS]).toHaveLength(0);
    expect(onEventStored).not.toHaveBeenCalled();
  });

  it('POST webhook returns 500 when the owner lookup fails', async () => {
    const { tables } = useDb({}, { errors: { strava_tokens: { message: 'timeout' } } });
    const server = await serve();
    const res = await server.request('POST', STRAVA_WEBHOOK_PATH, { body: validEvent() });
    expect(res.status).toBe(500); // Strava skickar om; ett databasfel är inte "okänd ägare"
    expect(tables[EVENTS]).toHaveLength(0);
  });

  it('POST webhook returns 500 when the unprocessed count cannot be read', async () => {
    const { tables } = useDb({}, { failWhen: (q) => (q.table === EVENTS && q.mutation === undefined ? { message: 'timeout' } : null) });
    const server = await serve();
    const res = await server.request('POST', STRAVA_WEBHOOK_PATH, { body: validEvent() });
    expect(res.status).toBe(500); // varken "spara ändå" eller "släpp tyst"
    expect(tables[EVENTS]).toHaveLength(0);
  });

  it('POST webhook stops storing when the owner already has 200 unprocessed events', async () => {
    expect(WEBHOOK_MAX_UNPROCESSED_PER_OWNER).toBe(200);
    const queued = (status: string, owner = OWNER_ID, n = 0): Row => ({ dedupe_key: `k-${owner}-${status}-${n}`, owner_id: owner, status });
    const backlog = (pending: number, processing: number): Row[] => [
      ...Array.from({ length: pending }, (_, n) => queued('pending', OWNER_ID, n)),
      ...Array.from({ length: processing }, (_, n) => queued('processing', OWNER_ID, n)),
      // rader som inte räknas: avklarade, döda och en annan ägares kö
      ...Array.from({ length: 30 }, (_, n) => queued('done', OWNER_ID, n)),
      ...Array.from({ length: 30 }, (_, n) => queued('dead', OWNER_ID, n)),
      ...Array.from({ length: 300 }, (_, n) => queued('pending', 888, n)),
    ];

    // 199 obearbetade: sparas (golvet är ≥ 200)
    const below = useDb({ [EVENTS]: backlog(100, 99) });
    const onEventStored = vi.fn();
    const server = await serve(onEventStored);
    const stored = await server.request('POST', STRAVA_WEBHOOK_PATH, { body: validEvent() });
    expect(stored.status).toBe(200);
    expect(below.tables[EVENTS].filter((r) => r.dedupe_key.startsWith('strava:'))).toHaveLength(1);
    expect(onEventStored).toHaveBeenCalledTimes(1);

    // 200 obearbetade (pending + processing): inget mer sparas, men svaret är 200 och en varning loggas
    const full = useDb({ [EVENTS]: backlog(120, 80) });
    const before = full.tables[EVENTS].length;
    warn.mockClear();
    const refused = await server.request('POST', STRAVA_WEBHOOK_PATH, { body: validEvent({ object_id: 9002 }) });
    expect(refused.status).toBe(200);
    expect(full.tables[EVENTS]).toHaveLength(before);
    expect(onEventStored).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('POST webhook stores only private, type and authorized from updates and never the title', async () => {
    const { tables } = useDb();
    const server = await serve();
    const res = await server.request('POST', STRAVA_WEBHOOK_PATH, {
      body: validEvent({
        aspect_type: 'update',
        updates: { title: 'Morning run at the secret lake', private: 'true', type: 'Ride', authorized: 'false', description: 'x', nested: { a: 1 }, polyline: 'abc' },
      }),
    });
    expect(res.status).toBe(200);
    expect(tables[EVENTS][0].updates).toEqual({ private: 'true', type: 'Ride', authorized: 'false' });
    expect(JSON.stringify(tables[EVENTS])).not.toContain('secret lake');

    // en nyckel utanför de tre skulle ge 23514 i databasen och en omleverans i evighet: raw updates går aldrig vidare
    const odd = await server.request('POST', STRAVA_WEBHOOK_PATH, { body: validEvent({ object_id: 9003, updates: ['title', 'x'] }) });
    expect(odd.status).toBe(200);
    expect(tables[EVENTS][1].updates).toEqual({});
    const absent = await server.request('POST', STRAVA_WEBHOOK_PATH, { body: (({ updates: _u, ...rest }) => rest)(validEvent({ object_id: 9004 })) });
    expect(absent.status).toBe(200);
    expect(tables[EVENTS][2].updates).toEqual({});
  });

  it('POST webhook stores the user_id from the athlete mapping', async () => {
    const { tables } = useDb();
    const server = await serve();
    const body = validEvent({ aspect_type: 'delete', object_id: 9100 });
    expect((await server.request('POST', STRAVA_WEBHOOK_PATH, { body })).status).toBe(200);
    expect(tables[EVENTS][0].user_id).toBe('user-777');
    expect(tables[EVENTS][0].dedupe_key).toBe(buildWebhookDedupeKey(body as any));
  });

  it('POST webhook inserts exactly the columns of the events table, with event_time as an ISO timestamp', async () => {
    const { tables, queries } = useDb();
    const server = await serve();
    const body = validEvent({ object_type: 'athlete', object_id: OWNER_ID, aspect_type: 'update', updates: { authorized: 'false' } });
    expect((await server.request('POST', STRAVA_WEBHOOK_PATH, { body })).status).toBe(200);

    const row = tables[EVENTS][0];
    const columns = tableColumns(migration046, EVENTS);
    expect(columns.length).toBeGreaterThan(10);
    for (const key of Object.keys(row)) expect(columns).toContain(key);
    // kolumnerna som saknar default måste alla ha ett värde
    for (const required of requiredColumns(migration046, EVENTS)) expect(row[required], required).not.toBeUndefined();
    expect(row.event_time).toBe(new Date(1_760_000_000 * 1000).toISOString());
    expect(row.dedupe_key).toContain(':1760000000:'); // nyckeln bär Stravas epoch-sekunder, inte ISO-strängen
    expect(row.subscription_id).toBe(SUBSCRIPTION_ID);
    // status och försök lämnas åt databasens default: routen sätter dem inte
    expect(row).not.toHaveProperty('status');
    const write = queries.find((q) => q.mutation === 'upsert');
    expect(write?.table).toBe(EVENTS);
  });

  it('POST webhook does no database read for events rejected by the cheap checks', async () => {
    const { queries } = useDb();
    const server = await serve();
    await server.request('POST', STRAVA_WEBHOOK_PATH, { body: validEvent({ subscription_id: 1 }) });
    await server.request('POST', STRAVA_WEBHOOK_PATH, { body: validEvent({ object_id: 'x' }) });
    await server.request('POST', STRAVA_WEBHOOK_PATH, { body: validEvent({ aspect_type: 'archive' }) });
    expect(queries).toHaveLength(0);

    // en giltig händelse gör högst två läsningar och en skrivning (2 s-budgeten): ägaren, kön, upsert
    await server.request('POST', STRAVA_WEBHOOK_PATH, { body: validEvent() });
    expect(queries.map((q) => `${q.table}:${q.mutation ?? 'read'}`)).toEqual(['strava_tokens:read', `${EVENTS}:read`, `${EVENTS}:upsert`]);
  });

  it('POST webhook has no IP rate limit: a burst of valid events from one address never gets 429', async () => {
    const { tables } = useDb();
    const server = await serveFullApp(); // genom hela appen: en limiter som monterats i app.ts syns bara här
    const statuses: number[] = [];
    for (let n = 0; n < 80; n++) {
      const res = await server.request('POST', STRAVA_WEBHOOK_PATH, {
        body: validEvent({ object_id: 10_000 + n }),
        headers: { 'x-forwarded-for': '203.0.113.9' },
      });
      statuses.push(res.status);
    }
    expect(statuses.filter((s) => s !== 200)).toEqual([]);
    expect(tables[EVENTS]).toHaveLength(80);
  });
});

describe('onEventStored', () => {
  it('POST webhook wakes the worker only after the response and never fails the response when it throws', async () => {
    const { tables } = useDb();
    const onEventStored = vi.fn(() => { throw new Error('worker exploded'); });
    const server = await serve(onEventStored);
    const res = await server.request('POST', STRAVA_WEBHOOK_PATH, { body: validEvent() });
    expect(res.status).toBe(200);
    expect(onEventStored).toHaveBeenCalledTimes(1);
    expect(tables[EVENTS]).toHaveLength(1);
  });

  it('POST webhook works without an injected onEventStored', async () => {
    const { tables } = useDb();
    const server = await serve();
    expect((await server.request('POST', STRAVA_WEBHOOK_PATH, { body: validEvent() })).status).toBe(200);
    expect(tables[EVENTS]).toHaveLength(1);
  });

});

describe('route path', () => {
  it('the subscription script calls back on the path the route is mounted on', () => {
    expect(new URL(STRAVA_WEBHOOK_CALLBACK_URL).pathname).toBe(STRAVA_WEBHOOK_PATH);
  });
});

/** Kolumnraderna i `create table … public.<table> (…)` i migrationen: [namn, resten av raden]. */
function columnLines(sql: string, table: string): Array<[string, string]> {
  const start = sql.indexOf(`create table if not exists public.${table} (`);
  const end = sql.indexOf('\n);', start);
  return sql
    .slice(start, end)
    .split('\n')
    .slice(1)
    .map((line) => line.replace(/--.*$/, '').trim())
    .filter((line) => line && !line.startsWith('constraint'))
    .map((line): [string, string] => {
      const [name, ...rest] = line.split(/\s+/);
      return [name, rest.join(' ')];
    });
}
const tableColumns = (sql: string, table: string): string[] => columnLines(sql, table).map(([name]) => name);
/** Kolumner som är `not null` utan default och inte genererade: routen måste ge dem ett värde. */
const requiredColumns = (sql: string, table: string): string[] =>
  columnLines(sql, table).filter(([, rest]) => /not null/.test(rest) && !/default|generated/.test(rest)).map(([name]) => name);
