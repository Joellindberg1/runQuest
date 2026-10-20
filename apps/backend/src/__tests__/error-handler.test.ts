/**
 * Den centrala felhanteringen i createApp() (ADR 007 Addendum 2026-10-20, punkt 2 och 5): 404, Sentry-hanteraren och jsonErrorHandler sist, i den ordningen.
 * Ett felsvar har ingen andra försvarslinje (skrubbern körs inte på HTTP-svar), så kropparna här är EXAKTA: inget i ett kastat fel eller en trasig body når svaret.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

// En router som kastar på olika sätt, monterad i stället för /api/public. Sentry-wiringen och allt annat i createApp() är de riktiga.
const LEAKY_MESSAGE = 'duplicate key for activity 12345678901 at lat 57.70887, lng 11.97456 with token SECRET-TOKEN-VALUE';
vi.mock('../routes/publicStats.js', async () => {
  const express = (await import('express')).default;
  const router = express.Router();
  router.get('/boom', () => { throw new Error(LEAKY_MESSAGE); });
  router.get('/boom-async', async () => { throw new Error(LEAKY_MESSAGE); });
  router.get('/boom-string', () => { throw LEAKY_MESSAGE; });
  router.get('/boom-status/:status', (req) => {
    throw Object.assign(new Error(LEAKY_MESSAGE), { status: Number(req.params.status), expose: true, stack: `Error: ${LEAKY_MESSAGE}\n    at secret/path.ts:1:1` });
  });
  router.get('/partial', (_req, res) => { res.write('partial'); throw new Error(LEAKY_MESSAGE); });
  router.get('/boom-cause', () => { throw new Error('outer', { cause: new Error(LEAKY_MESSAGE) }); });
  return { default: router };
});

import { createApp } from '../app.js';
import { logger } from '../utils/logger.js';

const app = createApp();
const token = jwt.sign({ user_id: 'user-1', name: 'TestUser', email: 'test@example.com', group_id: 'group-1' }, process.env.JWT_SECRET!, { expiresIn: '1h' });

const SECRETS = ['12345678901', '57.70887', '11.97456', 'SECRET-TOKEN-VALUE', 'secret/path.ts', 'duplicate key'];
function expectNoSecrets(body: unknown): void {
  const text = JSON.stringify(body);
  for (const secret of SECRETS) expect(text, `the answer must not contain "${secret}"`).not.toContain(secret);
}

beforeAll(() => {
  // Express skriver felet till stderr när ingen felhanterare tar det; här tar jsonErrorHandler det, och loggern är redan tyst under test.
  vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.spyOn(logger, 'warn').mockImplementation(() => undefined); });

describe('the order of the last handlers in createApp()', () => {
  it('is the 404 handler, then the Sentry error handler (unchanged), then the JSON error handler', () => {
    const stack = (app as unknown as { router: { stack: Array<{ handle: { name: string; length: number } }> } }).router.stack;
    const last = stack.slice(-3).map((layer) => ({ name: layer.handle.name, arity: layer.handle.length }));
    expect(last[0]).toEqual({ name: 'notFoundHandler', arity: 2 });
    expect(last[1].arity).toBe(4); // Sentry-hanteraren: (error, req, res, next)
    expect(last[1].name).not.toBe('jsonErrorHandler');
    expect(last[2]).toEqual({ name: 'jsonErrorHandler', arity: 4 });
  });
});

describe('route not found', () => {
  it('answers 404 as JSON in the error format, without path and method', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ success: false, error: 'Route not found', code: 'route_not_found' });
    expect(res.body).not.toHaveProperty('path');
    expect(res.body).not.toHaveProperty('method');
  });

  it('does not echo the query string (an OAuth code or a verify token) in the answer or in the log line', async () => {
    const info = vi.spyOn(logger, 'info');
    const res = await request(app).post('/api/strava/nothing-here?code=OAUTH-CODE-VALUE&hub.verify_token=VERIFY-VALUE');
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/OAUTH-CODE-VALUE|VERIFY-VALUE|nothing-here/);
    const logged = info.mock.calls.map((call) => String(call[0])).join('\n');
    expect(logged).not.toMatch(/OAUTH-CODE-VALUE|VERIFY-VALUE/);
    expect(logged).toContain('/api/strava/nothing-here');
  });
});

describe('a body that cannot be parsed', () => {
  const BROKEN_WITH_PASSWORD = '{"name":"joel","password":"hunter2-SECRET-PASSWORD", oops';

  it('on an unauthenticated /api route answers 400 JSON with code invalid_json and nothing from the body', async () => {
    const res = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send(BROKEN_WITH_PASSWORD);
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ success: false, error: 'Invalid JSON body', code: 'invalid_json' });
    expect(res.text).not.toMatch(/hunter2|SECRET-PASSWORD|oops|Unexpected token/);
  });

  it('on an authenticated /api route answers the same 400 JSON', async () => {
    const res = await request(app).post('/api/runs').set('Authorization', `Bearer ${token}`).set('Content-Type', 'application/json').send(BROKEN_WITH_PASSWORD);
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ success: false, error: 'Invalid JSON body', code: 'invalid_json' });
    expect(res.text).not.toMatch(/hunter2|SECRET-PASSWORD|oops|Unexpected token/);
  });

  it('answers 413 payload_too_large for a body over the limit', async () => {
    const res = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send(JSON.stringify({ password: 'x'.repeat(200 * 1024) }));
    expect(res.status).toBe(413);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ success: false, error: 'Request body too large', code: 'payload_too_large' });
  });

  it('answers 415 unsupported_media_type for an unsupported content encoding', async () => {
    const res = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').set('Content-Encoding', 'x-unknown').send('{"name":"a","password":"b"}');
    expect(res.status).toBe(415);
    expect(res.body).toEqual({ success: false, error: 'Unsupported media type', code: 'unsupported_media_type' });
  });

  it('answers 415 unsupported_media_type for an unsupported charset', async () => {
    const res = await request(app).post('/api/auth/login').set('Content-Type', 'application/json; charset=koi8-r').send('{"name":"a","password":"b"}');
    expect(res.status).toBe(415);
    expect(res.body).toEqual({ success: false, error: 'Unsupported media type', code: 'unsupported_media_type' });
  });
});

describe('an error nobody caught in a route', () => {
  it('answers 500 JSON with a fixed body, never the message of the error (the canary)', async () => {
    const res = await request(app).get('/api/public/boom');
    expect(res.status).toBe(500);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ success: false, error: 'Internal server error', code: 'internal_error' });
    expectNoSecrets(res.body);
    expectNoSecrets(res.text);
  });

  it('answers the same fixed 500 for a rejected promise from an async handler', async () => {
    const res = await request(app).get('/api/public/boom-async');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Internal server error', code: 'internal_error' });
    expectNoSecrets(res.text);
  });

  it('answers the same fixed 500 when something other than an Error is thrown', async () => {
    const res = await request(app).get('/api/public/boom-string');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Internal server error', code: 'internal_error' });
    expectNoSecrets(res.text);
  });

  it('hands the error on without appending a JSON body when the response has already started (headersSent)', async () => {
    // Express stänger anslutningen i stället för att skriva en andra kropp: klienten ser antingen ett avbrutet svar eller bara det som redan skrevs.
    const outcome = await request(app).get('/api/public/partial').then((res) => ({ text: res.text }), (error: unknown) => ({ aborted: error }));
    if ('text' in outcome) {
      expect(outcome.text).not.toContain('internal_error');
      expect(outcome.text).not.toContain('success');
    }
    expectNoSecrets(JSON.stringify(outcome));
  });

  it('does not echo the cause, the stack or error.expose', async () => {
    const res = await request(app).get('/api/public/boom-cause');
    expect(res.body).toEqual({ success: false, error: 'Internal server error', code: 'internal_error' });
    expectNoSecrets(res.text);
  });

  it('chooses the text from a fixed table by status, not from the error, for a 4xx with expose and a secret message', async () => {
    const res = await request(app).get('/api/public/boom-status/400');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'Invalid request', code: 'invalid_request' });
    expectNoSecrets(res.text);
  });

  it('gives any other 4xx the code invalid_request and keeps its status', async () => {
    const res = await request(app).get('/api/public/boom-status/431');
    expect(res.status).toBe(431);
    expect(res.body).toEqual({ success: false, error: 'Invalid request', code: 'invalid_request' });
  });

  it('gives 503 the code service_unavailable', async () => {
    const res = await request(app).get('/api/public/boom-status/503');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ success: false, error: 'Service unavailable', code: 'service_unavailable' });
    expectNoSecrets(res.text);
  });

  it('gives another 5xx the code internal_error and keeps its status', async () => {
    const res = await request(app).get('/api/public/boom-status/502');
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ success: false, error: 'Internal server error', code: 'internal_error' });
  });

  it('treats a status outside 400-599 as a 500', async () => {
    for (const status of [200, 302, 99, 600, 1000]) {
      const res = await request(app).get(`/api/public/boom-status/${status}`);
      expect({ status, got: res.status }).toEqual({ status, got: 500 });
      expect(res.body).toEqual({ success: false, error: 'Internal server error', code: 'internal_error' });
    }
  });

  it('logs a 5xx without the error object or its message', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    await request(app).get('/api/public/boom');
    const logged = [...warn.mock.calls, ...error.mock.calls].map((call) => call.map(String).join(' ')).join('\n');
    expectNoSecrets(logged);
  });
});
