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
import { initSentry, closeSentry, flushSentry, setSentryUser, installSentryErrorHandler } from '../sentry.js';
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
      userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false, databaseQueryData: false, queues: false, stackFrameVariables: false,
    });
    expect(options.tracesSampleRate).toBeUndefined();
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

  it.each([401, 403, 404, 429])('does not send an event for an error with status %i', async (status) => {
    start();
    logger.error('upstream said no', Object.assign(new Error('nope'), { status }));
    logger.error('upstream said no', Object.assign(new Error('nope'), { statusCode: status }));
    logger.error('upstream said no', { response: { status } });
    await flushSentry();
    expect(sent).toEqual([]);
  });

  it('sends an event for an error with status 500', async () => {
    start();
    logger.error('upstream broke', Object.assign(new Error('bad gateway'), { status: 500 }));
    await flushSentry();
    expect(sent).toHaveLength(1);
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

describe('setSentryUser', () => {
  it('sets nothing when Sentry is off', () => {
    expect(() => setSentryUser('user-1')).not.toThrow();
  });
});
