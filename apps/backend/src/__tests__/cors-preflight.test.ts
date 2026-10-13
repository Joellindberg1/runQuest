/**
 * CORS-preflight för Idempotency-Key: cors() i app.ts har ingen allowedHeaders och speglar därför preflightens
 * Access-Control-Request-Headers. Testet låser att en preflight från en tillåten origin som ber om
 * idempotency-key godkänns (annars skulle webbläsaren blockera POST /api/runs när frontenden skickar headern),
 * och att en otillåten origin inte får något Access-Control-Allow-Origin.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import http from 'node:http';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.CORS_ORIGIN = 'https://www.runquest.dev, https://staging.runquest.dev';

vi.mock('../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { createApp } from '../app.js';

let server: http.Server;
let port: number;
beforeAll(async () => {
  server = http.createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as { port: number }).port;
});
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

function preflight(origin: string, requestHeaders: string): Promise<{ status: number; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/api/runs',
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': requestHeaders,
        },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

const allowedHeaders = (headers: http.IncomingHttpHeaders) =>
  String(headers['access-control-allow-headers'] ?? '').toLowerCase().split(',').map((h) => h.trim());

describe('CORS-preflight mot POST /api/runs', () => {
  it('godkänner idempotency-key från en tillåten origin (headern speglas, metoden POST tillåts)', async () => {
    const res = await preflight('https://www.runquest.dev', 'idempotency-key,authorization,content-type');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('https://www.runquest.dev');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(String(res.headers['access-control-allow-methods']).toUpperCase()).toContain('POST');
    expect(allowedHeaders(res.headers)).toEqual(expect.arrayContaining(['idempotency-key', 'authorization', 'content-type']));
  });

  it('gäller också en annan tillåten origin i CORS_ORIGIN-listan', async () => {
    const res = await preflight('https://staging.runquest.dev', 'idempotency-key,content-type');
    expect(res.headers['access-control-allow-origin']).toBe('https://staging.runquest.dev');
    expect(allowedHeaders(res.headers)).toContain('idempotency-key');
  });

  it('en otillåten origin får inget Access-Control-Allow-Origin (preflighten godkänns inte)', async () => {
    const res = await preflight('https://evil.example', 'idempotency-key,authorization,content-type');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
