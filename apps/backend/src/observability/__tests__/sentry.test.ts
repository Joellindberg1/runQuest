/**
 * Sentry-kopplingen i backend. Ingen riktig Sentry: en fejkad transport fångar kuverten som skulle ha skickats,
 * så testet ser exakt det som lämnar processen (efter beforeSend).
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll, beforeAll } from 'vitest';
import * as Sentry from '@sentry/node';

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
import { logger } from '../../utils/logger.js';
import express from 'express';
import http from 'node:http';
import { initSentry, closeSentry, flushSentry, installSentryErrorHandler, withSentryUser } from '../sentry.js';
import { authenticateJWT } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/admin.js';
import { createRateLimiter } from '../../middleware/rateLimit.js';
import { startServer, mintToken, type TestServer } from '../../routes/__tests__/helpers/http.js';

type SentryEvent = Record<string, any>;
let sent: SentryEvent[] = [];

/** Fejkad transport: samlar händelser ur kuverten och skickar ingenting någonstans. */
const fakeTransport = () => ({
  send: async (envelope: [unknown, Array<[{ type: string }, SentryEvent]>]) => {
    for (const [header, payload] of envelope[1]) if (header.type === 'event') sent.push(payload);
    return {};
  },
  flush: async () => true,
});

// Alla tester startar utan process-hanterare (de testas i processHandlers.test.ts, i en egen process).
const withoutProcessHandlers = { transport: fakeTransport as never, processHandlers: false };

// Byggs av delar: testets egen källa hamnar som kodrader i händelsen (stacktrace), och får inte innehålla markörerna.
const PASSWORD = ['pw', 'marker', 'value'].join('-');
const BEARER = ['Bearer', 'zzz', 'token'].join(' ');
const CONSOLE_NAME = ['Jane', 'Doe'].join(' ');
const CONSOLE_LINE = `Login successful for user: ${CONSOLE_NAME}`;
const DSN = 'https://publickey@o1.ingest.de.sentry.io/42';
const start = (env: NodeJS.ProcessEnv = { SENTRY_DSN: DSN, SENTRY_ENVIRONMENT: 'staging' }) => initSentry(env, withoutProcessHandlers);

// Varje initSentry lägger till process-lyssnare; testerna initierar många gånger.
process.setMaxListeners(50);

let consoleSpies: Array<ReturnType<typeof vi.spyOn>>;
beforeEach(() => {
  sent = [];
  vi.mocked(getSupabaseClient).mockReset();
  consoleSpies = (['log', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(async () => {
  await closeSentry();
  consoleSpies.forEach((s) => s.mockRestore());
});

describe('init', () => {
  it('sentry is a noop without DSN', async () => {
    expect(start({})).toBe(false);
    expect(start({ SENTRY_DSN: '   ' })).toBe(false);
    expect(Sentry.getClient()).toBeUndefined();

    expect(() => logger.error('boom', new Error('x'))).not.toThrow();
    await flushSentry();
    expect(sent).toEqual([]);
  });

  it('tags events with the environment from SENTRY_ENVIRONMENT', async () => {
    expect(start({ SENTRY_DSN: DSN, SENTRY_ENVIRONMENT: 'staging' })).toBe(true);
    logger.error('first', new Error('one'));
    await flushSentry();
    expect(sent).toHaveLength(1);
    expect(sent[0].environment).toBe('staging');
  });

  it('uses the production environment and keeps tracing off and every data collection category closed', () => {
    expect(start({ SENTRY_DSN: DSN, SENTRY_ENVIRONMENT: 'production' })).toBe(true);
    const options = Sentry.getClient()!.getOptions();
    expect(options.environment).toBe('production');
    expect(options.dataCollection).toMatchObject({
      userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false, databaseQueryData: false, queues: false, stackFrameVariables: false, frameContextLines: 0,
    });
    expect(options.tracesSampleRate).toBeUndefined();
  });

  it('sends no lines of source code around the stack frames', async () => {
    start();
    logger.error('with a stack', new Error('x'));
    await flushSentry();
    const frames = sent[0].exception.values[0].stacktrace.frames as Array<Record<string, unknown>>;
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      expect(frame).not.toHaveProperty('context_line');
      expect(frame).not.toHaveProperty('pre_context');
      expect(frame).not.toHaveProperty('post_context');
    }
  });

  it('does not collect console lines as breadcrumbs', async () => {
    start();
    // eslint-disable-next-line no-console
    console.log(CONSOLE_LINE);
    logger.error('after the log line', new Error('x'));
    await flushSentry();
    expect(sent).toHaveLength(1);
    expect(JSON.stringify(sent[0].breadcrumbs ?? [])).not.toContain(CONSOLE_NAME);
  });
});

describe('logger.error', () => {
  it('sends an Error as an exception with the log text as context', async () => {
    start();
    logger.error('Checking admin status failed', new Error('db down'));
    await flushSentry();
    expect(sent).toHaveLength(1);
    expect(sent[0].exception.values[0]).toMatchObject({ type: 'Error', value: 'db down' });
    expect(sent[0].extra.log_message).toBe('Checking admin status failed');
  });

  it('sends a string message as a message event at error level', async () => {
    start();
    logger.error('❌ Error in group history endpoint (PGRST301)');
    await flushSentry();
    expect(sent).toHaveLength(1);
    expect(sent[0].message).toBe('❌ Error in group history endpoint (PGRST301)');
    expect(sent[0].level).toBe('error');
  });

  it('groups messages that differ only in ids and numbers', async () => {
    start();
    logger.error('❌ Error inserting run for user 3f2b8c1e-1111-4222-8333-444455556666 (23505)');
    logger.error('❌ Error inserting run for user aaaaaaaa-1111-4222-8333-444455556666 (23505)');
    await flushSentry();
    expect(sent).toHaveLength(2);
    expect(sent[0].fingerprint).toEqual(sent[1].fingerprint);
  });

  it('never attaches free-form objects from the log call as context', async () => {
    start();
    logger.error('Request failed', { code: 'X1', message: 'bad', body: { password: PASSWORD }, headers: { authorization: BEARER } });
    await flushSentry();
    expect(sent).toHaveLength(1);
    const text = JSON.stringify(sent[0]);
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain(BEARER);
    expect(sent[0].extra).toMatchObject({ log_detail: { code: 'X1', message: 'bad' } });
  });

  it('still writes the console line while reporting', () => {
    start();
    logger.error('keeps going');
    expect(consoleSpies[2]).toHaveBeenCalledWith('keeps going');
  });

  it.each([401, 403, 404, 429, 500])('reports a logged error that carries an upstream status %i', async (status) => {
    start();
    // Ett svar från Supabase eller Strava (t.ex. 401/404 av fel nyckel eller saknad migration) är vårt fel, inte ett klientfel.
    logger.error('upstream said no', Object.assign(new Error('nope'), { status }));
    logger.error('upstream said no too', { response: { status }, message: 'x' });
    await flushSentry();
    expect(sent).toHaveLength(2);
  });

  it.each(['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError'])('treats %s as a 401 and sends nothing', async (name) => {
    start();
    logger.error('❌ JWT verification failed:', Object.assign(new Error('jwt malformed'), { name }));
    await flushSentry();
    expect(sent).toEqual([]);
  });
});

describe('http app', () => {
  let server: TestServer;
  beforeAll(async () => { server = await startServer(createApp()); });
  afterAll(async () => { await server.close(); });

  it.each([
    [401, 'a request without a token', () => server.request('GET', '/api/runs/group-history')],
    [401, 'a request with a broken token', () => server.request('GET', '/api/runs/group-history', { token: 'not.a.jwt' })],
    [404, 'an unknown route', () => server.request('GET', '/api/does-not-exist')],
  ])('sends no event for %i from %s', async (status, _label, call) => {
    start();
    const res = await call();
    expect(res.status).toBe(status);
    await flushSentry();
    expect(sent).toEqual([]);
  });

  it('identifies a failing request by user_id only', async () => {
    start();
    vi.mocked(getSupabaseClient).mockImplementation(() => { throw new Error('db down'); });
    const res = await server.request('GET', '/api/runs/group-history', { token: mintToken({ user_id: 'user-777' }), headers: { Cookie: 'sid=cookie-marker' } });
    expect(res.status).toBe(500);
    await flushSentry();

    expect(sent).toHaveLength(1);
    expect(sent[0].user).toEqual({ id: 'user-777' });
    const text = JSON.stringify(sent[0]);
    for (const leak of ['TestUser', 'test@example.com', 'cookie-marker', 'Bearer ', mintToken({ user_id: 'user-777' }).slice(0, 20)]) {
      expect(text, `leaked: ${leak}`).not.toContain(leak);
    }
  });

  it('does not let one request’s user leak into the next request’s event', async () => {
    start();
    // Olika felkoder ger olika loggrader; annars slår SDK:ts Dedupe ihop två likadana händelser i rad.
    const failWith = (code: string) => vi.mocked(getSupabaseClient).mockImplementation(() => { throw Object.assign(new Error('db down'), { code }); });
    failWith('A1');
    await server.request('GET', '/api/runs/group-history', { token: mintToken({ user_id: 'user-A' }) });
    failWith('B2');
    await server.request('GET', '/api/runs/group-history', { token: mintToken({ user_id: 'user-B' }) });
    logger.error('background job failed');
    await flushSentry();
    expect(sent.map((e) => e.user?.id)).toEqual(['user-A', 'user-B', undefined]);
  });

});

describe('express error handler and middleware', () => {
  function appWith(configure: (app: express.Express) => void): express.Express {
    const app = express();
    configure(app);
    installSentryErrorHandler(app);
    return app;
  }

  it('reports an error thrown in a route as an event and still answers 500', async () => {
    start();
    const server = await startServer(appWith((app) => app.get('/boom', () => { throw new Error('unhandled in route'); })));
    const res = await server.request('GET', '/boom');
    await server.close();
    expect(res.status).toBe(500);
    await flushSentry();
    expect(sent).toHaveLength(1);
    expect(sent[0].exception.values[0].value).toBe('unhandled in route');
  });

  it.each([401, 403, 404, 429])('does not report an error with status %i that reaches Express', async (status) => {
    start();
    const server = await startServer(appWith((app) => app.get('/denied', (_req, _res, next) => next(Object.assign(new Error('denied'), { status })))));
    const res = await server.request('GET', '/denied');
    await server.close();
    expect(res.status).toBe(status);
    await flushSentry();
    expect(sent).toEqual([]);
  });

  it('sends no event for the real 403 from requireAdmin and the real 429 from the rate limiter', async () => {
    start();
    vi.mocked(getSupabaseClient).mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { is_admin: false }, error: null }) }) }) }),
    } as never);
    const limiter = createRateLimiter(60_000, 1);
    const server = await startServer(appWith((app) => {
      app.get('/admin', authenticateJWT, requireAdmin, (_req, res) => { res.json({}); });
      app.get('/limited', limiter, (_req, res) => { res.json({}); });
    }));
    const forbidden = await server.request('GET', '/admin', { token: mintToken({ user_id: 'u-1' }) });
    await server.request('GET', '/limited');
    const limited = await server.request('GET', '/limited');
    await server.close();
    expect([forbidden.status, limited.status]).toEqual([403, 429]);
    await flushSentry();
    expect(sent).toEqual([]);
  });
});

describe('request user isolation', () => {
  it('withSentryUser puts the user on the events of its callback only, also when called outside any request scope', async () => {
    start();
    await withSentryUser('user-X', async () => {
      await new Promise((r) => setTimeout(r, 5));
      logger.error('inside the callback');
    });
    logger.error('after the callback');
    expect(withSentryUser('user-Y', () => 'result')).toBe('result');
    await flushSentry();
    expect(sent.map((e) => e.user?.id)).toEqual(['user-X', undefined]);
  });

  it('withSentryUser just runs the callback when Sentry is off', () => {
    expect(withSentryUser('user-X', () => 42)).toBe(42);
  });

  /** POST med JSON-bodyn i två skrivningar med paus, så att express.json() läser den i senare TCP-segment (utanför förfrågans async-kontext). */
  function postInTwoWrites(port: number, token: string, body: object, agent?: http.Agent): Promise<number> {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const req = http.request({ hostname: '127.0.0.1', port, path: '/work', method: 'POST', agent, headers: {
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), Authorization: `Bearer ${token}`,
      } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode ?? 0)); });
      req.on('error', reject);
      req.write(payload.slice(0, 5));
      setTimeout(() => { req.write(payload.slice(5)); req.end(); }, 60);
    });
  }

  function workApp(): express.Express {
    const app = express();
    app.use(express.json());
    app.post('/work', authenticateJWT, async (req, res) => {
      await new Promise((r) => setTimeout(r, 5));
      logger.error(`work failed for ${req.body.job}`);
      res.json({});
    });
    installSentryErrorHandler(app);
    return app;
  }

  it('keeps the user of a request with a late-read body off later events outside any request', async () => {
    start();
    const app = workApp();
    const srv = http.createServer(app);
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    const port = (srv.address() as { port: number }).port;
    try {
      // Samma TCP-anslutning för båda: nästa förfrågan ärver inte den förra förfrågans kontext.
      const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
      expect(await postInTwoWrites(port, mintToken({ user_id: 'user-A' }), { job: 'alpha' }, agent)).toBe(200);
      expect(await postInTwoWrites(port, mintToken({ user_id: 'user-B' }), { job: 'beta' }, agent)).toBe(200);
      agent.destroy();
      logger.error('scheduler job failed');
      await flushSentry();
      expect(sent.map((e) => e.user?.id)).toEqual(['user-A', 'user-B', undefined]);
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });
});

describe('outgoing requests', () => {
  /** En loopback-server som skriver ner headers för varje inkommande anrop. */
  async function recordingServer() {
    const seen: Array<http.IncomingHttpHeaders> = [];
    const srv = http.createServer((req, res) => { seen.push(req.headers); res.end('ok'); });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    const port = (srv.address() as { port: number }).port;
    return { seen, port, close: () => new Promise<void>((r) => srv.close(() => r())) };
  }

  it('adds no sentry-trace or baggage header to outgoing fetch or http requests', async () => {
    start();
    const target = await recordingServer();
    try {
      await (await fetch(`http://127.0.0.1:${target.port}/via-fetch`)).text();
      await new Promise<void>((resolve, reject) => {
        http.get(`http://127.0.0.1:${target.port}/via-http`, (res) => { res.resume(); res.on('end', resolve); }).on('error', reject);
      });
    } finally {
      await target.close();
    }
    expect(target.seen).toHaveLength(2);
    for (const headers of target.seen) {
      expect(headers).not.toHaveProperty('sentry-trace');
      expect(headers).not.toHaveProperty('baggage');
      expect(headers).not.toHaveProperty('traceparent');
    }
  });
});
