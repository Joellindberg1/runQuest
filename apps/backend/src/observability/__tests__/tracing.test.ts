/**
 * Prestandaspårning i backend. Ingen riktig Sentry och inget externt nätverk: en fejkad transport fångar kuverten som skulle ha
 * skickats, och "Supabase" och "Strava" är en lokal http-server på 127.0.0.1 som också ser vilka headers som kommer in.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import * as Sentry from '@sentry/node';
import express from 'express';
import http from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { createApp } from '../../app.js';
import { closeSentry, flushSentry, initSentry } from '../sentry.js';
import { MAX_TRACES_SAMPLE_RATE } from '@runquest/shared';
import { FIRST_PARTY_PATH_SEGMENTS, scrubTransaction, sentryRouteNaming } from '../tracing.js';
import { logger } from '../../utils/logger.js';
import { startServer, type TestServer } from '../../routes/__tests__/helpers/http.js';

type Envelope = Record<string, any>;

const DSN = 'https://publickey@o1.ingest.de.sentry.io/42';
const RUN_ID = '3f2b8c1e-9d4a-4e7b-8a61-5c0d2e9f7a14';
const USER_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const STRAVA_ACTIVITY_ID = '987654321';
const QUERY_MARKER = 'query-marker-value';
const BODY_MARKER = 'body-marker-value';
const BEARER_MARKER = 'bearer-marker-value';
const FORWARDED_FOR = '203.0.113.77';

let transactions: Envelope[] = [];
let errorEvents: Envelope[] = [];
/** Hela kuvert, med sin egen header (där spårningens "trace"-fält ligger). */
let envelopes: unknown[] = [];

const fakeTransport = () => ({
  send: async (envelope: [unknown, Array<[{ type: string }, Envelope]>]) => {
    envelopes.push(envelope);
    for (const [header, payload] of envelope[1]) {
      if (header.type === 'transaction') transactions.push(payload);
      if (header.type === 'event') errorEvents.push(payload);
    }
    return {};
  },
  flush: async () => true,
});

process.setMaxListeners(50);

/**
 * Startar Sentry med tracing. Taket 0,1 gäller även här: provtagningen är deterministisk för att Math.random är fixerad (se
 * beforeEach) till ett tal under taket, så varje förfrågan blir provtagen.
 */
function start(env: NodeJS.ProcessEnv = {}): boolean {
  return initSentry({ SENTRY_DSN: DSN, SENTRY_ENVIRONMENT: 'test', ...env }, { transport: fakeTransport as never, processHandlers: false });
}

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for the condition');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Transaktionerna från appen under test. Uppströmsservern är också instrumenterad (samma process) och räknas bort. */
const own = () => transactions.filter((t) => t.transaction !== 'GET (no route)');

// ---- Uppströms: står för Supabase och Strava ----
let upstream: http.Server;
let upstreamBase: string;
let upstreamHeaders: http.IncomingHttpHeaders[] = [];

beforeAll(async () => {
  upstream = http.createServer((req, res) => {
    upstreamHeaders.push(req.headers);
    res.setHeader('content-type', 'application/json');
    res.end('[]');
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', () => resolve()));
  upstreamBase = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
});

beforeEach(() => {
  transactions = [];
  errorEvents = [];
  envelopes = [];
  upstreamHeaders = [];
  // Sentry jämför ett slumptal med provtagningstalet; ett tal under 0,1 ger en provtagen förfrågan.
  vi.spyOn(Math, 'random').mockReturnValue(0.01);
});
afterEach(async () => {
  await closeSentry();
  vi.restoreAllMocks();
});

// ---- Appen under test: samma montering som createApp (routern monteras på ett prefix, id i sökvägen) ----
function buildApp(): express.Express {
  const app = express();
  app.use(sentryRouteNaming());
  app.use(express.json());
  const runs = express.Router();
  runs.get('/:id', async (_req, res) => {
    // Som supabase-js: ett http-anrop med filter i query-strängen. Och ett Strava-anrop med id i sökvägen.
    await fetch(`${upstreamBase}/rest/v1/runs?select=*&user_id=eq.${USER_ID}&api_key=${QUERY_MARKER}`);
    await fetch(`${upstreamBase}/api/v3/activities/${STRAVA_ACTIVITY_ID}`);
    res.json({ ok: true });
  });
  runs.post('/', (_req, res) => {
    res.status(201).json({ ok: true });
  });
  runs.get('/', (_req, res) => {
    res.json({ ok: true });
  });
  app.use('/api/runs', runs);
  app.get('/api/outgoing', async (_req, res) => {
    await fetch(`${upstreamBase}/upstream/fetch`);
    await new Promise<void>((resolve, reject) => {
      http.get(`${upstreamBase}/upstream/http`, (r) => { r.resume(); r.on('end', resolve); }).on('error', reject);
    });
    res.json({ ok: true });
  });
  app.get('/api/titles/user/:id', (_req, res) => {
    logger.error('lookup failed', new Error('boom'));
    res.status(500).json({ error: 'failed' });
  });
  app.get('/health', (_req, res) => {
    res.json({ status: 'OK' });
  });
  app.get('/api/fail', () => {
    throw new Error('route failed');
  });
  app.use((_req, res) => {
    res.status(404).json({ error: 'Route not found' });
  });
  app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: 'failed' });
  });
  return app;
}

// Talets egna regler (tak, 0 = av, ogiltigt = standard) testas i packages/shared. Här: att klienten använder dem.
describe('sample rate', () => {
  it('is what the initialised client uses', () => {
    expect(start({ SENTRY_TRACES_SAMPLE_RATE: '1' })).toBe(true);
    expect(Sentry.getClient()!.getOptions().tracesSampleRate).toBe(0.1);
    expect(Sentry.getClient()!.getOptions().tracesSampleRate).toBeLessThanOrEqual(MAX_TRACES_SAMPLE_RATE);
  });

  it('is not raised by a sampling decision the caller sends', async () => {
    start({ SENTRY_TRACES_SAMPLE_RATE: '0' });
    const server = await startServer(buildApp());
    await server.request('GET', '/api/runs/', { headers: { 'sentry-trace': '0123456789abcdef0123456789abcdef-0123456789abcdef-1', baggage: 'sentry-sample_rate=1,sentry-sampled=true' } });
    await sleep(150);
    await flushSentry();
    await server.close();

    expect(transactions).toEqual([]);
  });
});

describe('transaction names', () => {
  it('names a transaction after the route with its parameter, never the path with the id', async () => {
    start();
    const server = await startServer(buildApp());
    await server.request('GET', `/api/runs/${RUN_ID}`);
    await waitFor(() => own().length >= 1);
    await server.close();

    const [transaction] = own();
    expect(transaction.transaction).toBe('GET /api/runs/:id');
    expect(transaction.transaction_info).toEqual({ source: 'route' });
    expect(transaction.contexts.trace.data['http.route']).toBe('/api/runs/:id');
    expect(JSON.stringify(transaction)).not.toContain(RUN_ID);
  });

  it('keeps the method apart and names the collection route without a trailing slash', async () => {
    start();
    const server = await startServer(buildApp());
    await server.request('POST', '/api/runs/', { body: { distance: 5 } });
    await server.request('GET', '/api/runs/');
    await waitFor(() => own().length >= 2);
    await server.close();

    expect(own().map((t) => t.transaction).sort()).toEqual(['GET /api/runs', 'POST /api/runs']);
  });

  it('names a route mounted directly on the app by its own path', async () => {
    start();
    const server = await startServer(buildApp());
    await server.request('GET', '/api/outgoing');
    await waitFor(() => own().length >= 1);
    await server.close();

    expect(own()[0].transaction).toBe('GET /api/outgoing');
  });

  it('keeps the route name when the handler fails and the error handler answers', async () => {
    start();
    const server = await startServer(buildApp());
    const response = await server.request('GET', '/api/fail');
    await waitFor(() => own().length >= 1);
    await server.close();

    expect(response.status).toBe(500);
    expect(own()[0].transaction).toBe('GET /api/fail');
  });

  it('is mounted first in the real app, so its routes get their names', async () => {
    start();
    const server = await startServer(createApp());
    const response = await server.request('GET', '/api');
    await waitFor(() => own().length >= 1);
    await server.close();

    expect(response.status).toBe(200);
    expect(own()[0].transaction).toBe('GET /api');
    expect(own()[0].transaction_info).toEqual({ source: 'route' });
  });
});

describe('what a transaction carries', () => {
  it('has no query string, id, body, header value, address or user', async () => {
    start();
    const server = await startServer(buildApp());
    await server.request('GET', `/api/runs/${RUN_ID}?token=${QUERY_MARKER}&user=${USER_ID}`, {
      headers: { Authorization: `Bearer ${BEARER_MARKER}`, 'X-Forwarded-For': FORWARDED_FOR, Cookie: `session=${BEARER_MARKER}` },
    });
    await server.request('POST', '/api/runs/', { body: { note: BODY_MARKER } });
    await waitFor(() => own().length >= 2);
    await server.close();

    const everything = JSON.stringify(own());
    for (const secret of [RUN_ID, USER_ID, QUERY_MARKER, BODY_MARKER, BEARER_MARKER, FORWARDED_FOR, STRAVA_ACTIVITY_ID]) {
      expect(everything).not.toContain(secret);
    }
    for (const transaction of own()) {
      expect(transaction.user).toBeUndefined();
      expect(transaction.breadcrumbs).toBeUndefined();
      expect(transaction.request?.url).toBeUndefined();
      expect(transaction.request?.headers).toBeUndefined();
      expect(transaction.request?.query_string).toBeUndefined();
      expect(transaction.request?.data).toBeUndefined();
      expect(transaction.contexts.trace.data).not.toHaveProperty('url.full');
      expect(transaction.contexts.trace.data).not.toHaveProperty('url.query');
      expect(transaction.contexts.trace.data).not.toHaveProperty('client.address');
    }
  });

  it('describes a call out to another service by host and path shape, with the id and query removed', async () => {
    start();
    const server = await startServer(buildApp());
    await server.request('GET', `/api/runs/${RUN_ID}`);
    await waitFor(() => own().length >= 1);
    await server.close();

    const spans = own()[0].spans as Array<Record<string, any>>;
    const host = upstreamBase.replace('http://', '');
    expect(spans.map((s) => s.description)).toEqual([
      `GET http://${host}/rest/v1/runs`,
      `GET http://${host}/api/v3/activities/:id`,
    ]);
    for (const span of spans) {
      expect(span.op).toBe('http.client');
      expect(span.data).not.toHaveProperty('url.full');
      expect(span.data).not.toHaveProperty('url.query');
      expect(span.data).not.toHaveProperty('url.path');
      expect(span.data).not.toHaveProperty('user_agent.original');
      expect(span.data['http.response.status_code']).toBe(200);
    }
  });
});

describe('outgoing requests', () => {
  it('carry no sentry-trace or baggage header while tracing is on, for fetch and for node:http', async () => {
    start();
    const server = await startServer(buildApp());
    // Ett anrop inne i en spårad förfrågan: där hade SDK:t annars lagt på spårningsheaders.
    await server.request('GET', '/api/outgoing');
    await waitFor(() => own().length >= 1);
    await server.close();

    expect(upstreamHeaders).toHaveLength(2);
    for (const headers of upstreamHeaders) {
      expect(headers).not.toHaveProperty('sentry-trace');
      expect(headers).not.toHaveProperty('baggage');
      expect(headers).not.toHaveProperty('traceparent');
    }
    expect((own()[0].spans as unknown[]).length).toBeGreaterThanOrEqual(1);
  });

  it('have no span when they run outside a request (schedulers, workers)', async () => {
    start();
    await fetch(`${upstreamBase}/upstream/background`);
    await sleep(150);
    await flushSentry();

    expect(transactions.filter((t) => t.contexts?.trace?.op !== 'http.server')).toEqual([]);
    expect(own()).toEqual([]);
  });
});

describe('what is not traced', () => {
  it('does not trace the health check', async () => {
    start();
    const server = await startServer(buildApp());
    await server.request('GET', '/health');
    await server.request('GET', '/api/runs/');
    await waitFor(() => own().length >= 1);
    await sleep(100);
    await server.close();

    expect(own().map((t) => t.transaction)).toEqual(['GET /api/runs']);
  });

  it('does nothing without a DSN', async () => {
    expect(initSentry({}, { transport: fakeTransport as never, processHandlers: false })).toBe(false);
    const server = await startServer(buildApp());
    await server.request('GET', `/api/runs/${RUN_ID}`);
    await sleep(100);
    await server.close();

    expect(transactions).toEqual([]);
  });

  it('has none of the module instrumentation that tracing adds, since that needs --import and a changed start command', () => {
    start();
    const client = Sentry.getClient()!;
    expect(client.getOptions().enableRuntimeChannelInjection).toBe(false);
    expect(client.getOptions().tracePropagationTargets).toEqual([]);
    for (const name of ['Postgres', 'PostgresJs', 'Redis', 'Mongo', 'OpenAI']) expect(client.getIntegrationByName(name)).toBeUndefined();
    expect(client.getIntegrationByName('Http')).toBeDefined();
    expect(client.getIntegrationByName('NodeFetch')).toBeDefined();
  });
});

describe('scrubTransaction', () => {
  const baseTransaction = () => ({
    type: 'transaction' as const,
    transaction: 'GET /api/runs/3f2b8c1e-9d4a-4e7b-8a61-5c0d2e9f7a14',
    transaction_info: { source: 'url' },
    request: { method: 'GET', url: 'https://api.runquest.dev/api/runs/3f2b8c1e-9d4a-4e7b-8a61-5c0d2e9f7a14?token=abc' },
    user: { id: 'u1' },
    breadcrumbs: [{ category: 'http', data: { url: 'https://x.example/rest/v1/runs?user_id=eq.1' } }],
    contexts: {
      trace: {
        op: 'http.server',
        data: {
          'sentry.op': 'http.server',
          'http.request.method': 'GET',
          'http.response.status_code': 200,
          'url.full': 'https://api.runquest.dev/api/runs/3f2b8c1e-9d4a-4e7b-8a61-5c0d2e9f7a14?token=abc',
          'url.path': '/api/runs/3f2b8c1e-9d4a-4e7b-8a61-5c0d2e9f7a14',
          'url.query': '?token=abc',
          'client.address': '203.0.113.77',
          'user_agent.original': 'Mozilla/5.0',
          'http.request.header.authorization': 'Bearer abc',
        },
      },
    },
    spans: [] as Array<Record<string, any>>,
  });

  it('names an unrouted transaction by its method only', () => {
    const scrubbed = scrubTransaction(baseTransaction(), [])!;
    expect(scrubbed.transaction).toBe('GET (no route)');
    expect(scrubbed.transaction_info).toEqual({ source: 'custom' });
  });

  it('keeps a route name and removes an id that slipped into it', () => {
    const event = { ...baseTransaction(), transaction: 'PUT /api/groups/3f2b8c1e-9d4a-4e7b-8a61-5c0d2e9f7a14/members/42', transaction_info: { source: 'route' } };
    expect(scrubTransaction(event, [])!.transaction).toBe('PUT /api/groups/:id/members/:id');
  });

  it('keeps only the attributes that say how long and how it went', () => {
    const data = scrubTransaction(baseTransaction(), [])!.contexts.trace.data;
    expect(Object.keys(data).sort()).toEqual(['http.request.method', 'http.response.status_code', 'sentry.op']);
  });

  it('turns a span for a call to another service into a method, host and path shape', () => {
    const event = baseTransaction();
    event.spans = [
      {
        op: 'http.client',
        origin: 'auto.http.node_fetch',
        description: 'GET https://abc.supabase.co/rest/v1/runs',
        data: { 'url.full': 'https://abc.supabase.co/rest/v1/runs?select=*&user_id=eq.1', 'http.request.method': 'GET', 'http.response.status_code': 200, 'user_agent.original': 'node', 'network.peer.address': '10.0.0.1' },
        span_id: 'a1', trace_id: 't1', parent_span_id: 'p1', start_timestamp: 1, timestamp: 2, status: 'ok',
      },
      {
        op: 'http.client',
        description: 'POST https://www.strava.com/api/v3/activities/987654321/streams?keys=time',
        data: { 'url.full': 'https://www.strava.com/api/v3/activities/987654321/streams?keys=time', 'http.request.method': 'POST' },
        span_id: 'a2', trace_id: 't1', parent_span_id: 'p1', start_timestamp: 1, timestamp: 2,
      },
      {
        op: 'http.client',
        description: 'GET https://hooks.example.com/services/T0AB12CD/B0EF34GH/AbCdEf123456SecretToken',
        data: { 'url.full': 'https://hooks.example.com/services/T0AB12CD/B0EF34GH/AbCdEf123456SecretToken' },
        span_id: 'a3', trace_id: 't1', parent_span_id: 'p1', start_timestamp: 1, timestamp: 2,
      },
    ];
    const spans = scrubTransaction(event, [])!.spans as Array<Record<string, any>>;

    expect(spans.map((s) => s.description)).toEqual([
      'GET https://abc.supabase.co/rest/v1/runs',
      'POST https://www.strava.com/api/v3/activities/:id/:id',
      'GET https://hooks.example.com/:id/:id/:id/:id',
    ]);
    expect(spans[0].data).toEqual({ 'http.request.method': 'GET', 'http.response.status_code': 200, 'server.address': 'abc.supabase.co' });
    expect(spans[0]).toMatchObject({ span_id: 'a1', trace_id: 't1', parent_span_id: 'p1', start_timestamp: 1, timestamp: 2, status: 'ok', op: 'http.client' });
  });

  it('strips the description and data from a span it does not know', () => {
    const event = baseTransaction();
    event.spans = [{ op: 'db.query', description: 'select * from users where email = jane@example.com', data: { 'db.statement': 'select 1' }, span_id: 'a1', trace_id: 't1', start_timestamp: 1, timestamp: 2 }];
    const [span] = scrubTransaction(event, [])!.spans as Array<Record<string, any>>;
    expect(span.op).toBe('db.query');
    expect(span.description).toBeUndefined();
    expect(span.data).toBeUndefined();
  });

  it('still masks secrets from the environment that end up anywhere in the event', () => {
    const event = { ...baseTransaction(), transaction: 'GET /api/sk-test-secret-value', transaction_info: { source: 'route' } };
    expect(JSON.stringify(scrubTransaction(event, ['sk-test-secret-value']))).not.toContain('sk-test-secret-value');
  });

  it('sends only what it knows: no tags, extra, fingerprint, other contexts or unknown fields', () => {
    const event = {
      ...baseTransaction(),
      transaction_info: { source: 'route' },
      tags: { user_name: 'Anna Andersson', run: '3f2b8c1e-9d4a-4e7b-8a61-5c0d2e9f7a14' },
      extra: { note: 'Anna Andersson ran 3f2b8c1e-9d4a-4e7b-8a61-5c0d2e9f7a14' },
      fingerprint: ['Anna Andersson'],
      measurements: { custom: { value: 1 } },
      sdkProcessingMetadata: { anything: 'Anna Andersson' },
      contexts: {
        ...baseTransaction().contexts,
        response: { status_code: 200, headers: { 'set-cookie': 'a=b' } },
        runtime: { name: 'node', version: 'v24.0.0' },
        profile: { who: 'Anna Andersson' },
        custom_context: { name: 'Anna Andersson' },
      },
    };
    const scrubbed = scrubTransaction(event, [])! as Record<string, any>;

    expect(JSON.stringify(scrubbed)).not.toContain('Anna');
    expect(JSON.stringify(scrubbed)).not.toContain('3f2b8c1e');
    for (const field of ['tags', 'extra', 'fingerprint', 'sdkProcessingMetadata', 'measurements']) expect(scrubbed).not.toHaveProperty(field);
    expect(Object.keys(scrubbed.contexts).sort()).toEqual(['response', 'runtime', 'trace']);
    expect(scrubbed.contexts.response).toEqual({ status_code: 200 });
    expect(scrubbed.contexts.runtime).toEqual({ name: 'node', version: 'v24.0.0' });
  });
});

describe('path segments of outgoing calls', () => {
  const describeCall = (url: string) => {
    const event = { type: 'transaction', transaction: 'GET /x', transaction_info: { source: 'route' }, spans: [{ op: 'http.client', data: { 'url.full': url, 'http.request.method': 'GET' } }] };
    return (scrubTransaction(event, [])!.spans as Array<{ description: string }>)[0]!.description;
  };

  it('keeps a segment only if it is one the code calls, so a username or an email cannot pass as a word', () => {
    expect(describeCall('https://abc.supabase.co/storage/v1/object/public/profile-pictures/joelindberg')).toBe('GET https://abc.supabase.co/storage/v1/object/public/profile-pictures/:id');
    expect(describeCall('https://abc.supabase.co/rest/v1/anna-andersson-gmail-com')).toBe('GET https://abc.supabase.co/rest/v1/:id');
    expect(describeCall('https://abc.supabase.co/rest/v1/runs')).toBe('GET https://abc.supabase.co/rest/v1/runs');
    expect(describeCall('https://abc.supabase.co/rest/v1/rpc/update_title_leaderboard')).toBe('GET https://abc.supabase.co/rest/v1/rpc/update_title_leaderboard');
    expect(describeCall('https://www.strava.com/api/v3/athlete/activities')).toBe('GET https://www.strava.com/api/v3/athlete/activities');
    expect(describeCall('https://www.strava.com/api/v3/activities/987654321')).toBe('GET https://www.strava.com/api/v3/activities/:id');
    expect(describeCall('https://api.open-meteo.com/v1/forecast')).toBe('GET https://api.open-meteo.com/v1/forecast');
  });

  // Låser listan mot koden: ett nytt tabell-, vy- eller rpc-namn blir `:id` i spårningen tills det läggs till i
  // FIRST_PARTY_PATH_SEGMENTS (det är säkert, men man vill se det). Tabeller ur migrationerna, resten ur anropen i koden.
  it('lists every table, view, rpc and storage bucket the backend uses', () => {
    const backendRoot = join(__dirname, '..', '..', '..');
    const used = new Set<string>();
    for (const file of readdirSync(join(backendRoot, 'migrations')).filter((f) => f.endsWith('.sql'))) {
      const sql = readFileSync(join(backendRoot, 'migrations', file), 'utf8');
      for (const match of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi)) used.add(match[1]!.toLowerCase());
    }
    const sources = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === 'scripts' || entry.name === 'test-utils' ? [] : sources(path);
        return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
      });
    for (const file of sources(join(backendRoot, 'src'))) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/\.(?:from|rpc)\(\s*'([a-z][a-z0-9_-]*)'/g)) used.add(match[1]!);
    }
    used.delete('t'); // hjälpfunktion i ett test-liknande uttryck, inget tabellnamn

    expect(used.size).toBeGreaterThan(25);
    const missing = [...used].filter((name) => !FIRST_PARTY_PATH_SEGMENTS.has(name));
    expect(missing).toEqual([]);
  });
});

describe('error events', () => {
  it('carry the route and not the user id, in the name or in the address', async () => {
    start();
    const server = await startServer(buildApp());
    await server.request('GET', `/api/titles/user/${USER_ID}?token=${QUERY_MARKER}`);
    await flushSentry();
    await server.close();

    expect(errorEvents).toHaveLength(1);
    const json = JSON.stringify(errorEvents[0]);
    expect(json).not.toContain(USER_ID);
    expect(json).not.toContain(QUERY_MARKER);
    expect(errorEvents[0]!.transaction).toBe('GET /api/titles/user/:id');
  });

  it('carry the route also when the request was not sampled for tracing', async () => {
    start({ SENTRY_TRACES_SAMPLE_RATE: '0' });
    const server = await startServer(buildApp());
    // Ett id som inte är ett UUID eller ett tal kan ingen mönsterrensning ta: bara routenamnet gör det.
    await server.request('GET', '/api/titles/user/anna-andersson');
    await flushSentry();
    await server.close();

    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]!.transaction).toBe('GET /api/titles/user/:id');
    expect(JSON.stringify(errorEvents[0]).replace(/@/g, '')).not.toContain('anna-andersson');
  });
});

describe('incoming trace context', () => {
  const ATTACKER_TRACE = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const ATTACKER_SPAN = 'bbbbbbbbbbbbbbbb';

  it('is ignored: neither the transaction nor the envelope carries the id or the baggage the caller sent', async () => {
    start();
    const server = await startServer(buildApp());
    await server.request('GET', '/api/runs/', {
      headers: {
        'sentry-trace': `${ATTACKER_TRACE}-${ATTACKER_SPAN}-1`,
        baggage: 'sentry-trace_id=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,sentry-public_key=attackerkey,sentry-transaction=ATTACKER_MARK,sentry-release=evil,sentry-sample_rate=1,sentry-sample_rand=0.001',
      },
    });
    await waitFor(() => own().length >= 1);
    await server.close();

    const everything = JSON.stringify(envelopes);
    for (const planted of [ATTACKER_TRACE, ATTACKER_SPAN, 'attackerkey', 'ATTACKER_MARK', 'evil']) expect(everything).not.toContain(planted);
    expect(own()[0]!.contexts.trace.parent_span_id).toBeUndefined();
  });

  it('does not make a request sampled that the rate would not sample', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    start({ SENTRY_TRACES_SAMPLE_RATE: '1' });
    const server = await startServer(buildApp());
    await server.request('GET', '/api/runs/', {
      headers: { 'sentry-trace': `${ATTACKER_TRACE}-${ATTACKER_SPAN}-1`, baggage: 'sentry-sample_rand=0.001,sentry-sample_rate=1' },
    });
    await sleep(150);
    await flushSentry();
    await server.close();

    expect(own()).toEqual([]);
  });
});
