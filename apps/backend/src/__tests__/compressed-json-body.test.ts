/**
 * Komprimerade JSON-kroppar genom createApp() (express.json() / body-parser). Vaktar att en gzip-kropp läses som JSON, att storleksgränsen gäller den
 * uppackade kroppen och att en kropp med avslutande bytes efter den komprimerade strömmen avvisas med ett vanligt JSON-fel i stället för att hänga.
 * Okomprimerad trasig JSON, för stor kropp och okänd kodning täcks av error-handler.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { gzipSync, deflateSync } from 'node:zlib';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

// En router som ekar den tolkade kroppen, monterad i stället för /api/public (efter den globala JSON-parsern). Allt annat i createApp() är det riktiga.
vi.mock('../routes/publicStats.js', async () => {
  const express = (await import('express')).default;
  const router = express.Router();
  router.post('/echo', (req, res) => { res.json({ received: req.body }); });
  return { default: router };
});

import { createApp } from '../app.js';

const app = createApp();
// superagent kör annars JSON.stringify på en Buffer när innehållstypen är JSON; .serialize lämnar de komprimerade bytena orörda.
const post = () => request(app).post('/api/public/echo').set('Content-Type', 'application/json').serialize((body) => body);

describe('a compressed JSON body', () => {
  it('is decompressed and parsed when sent gzip-encoded', async () => {
    const payload = { name: 'joel', distance_km: 5.2, nested: { list: [1, 2, 3] } };
    const res = await post().set('Content-Encoding', 'gzip').send(gzipSync(JSON.stringify(payload)));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: payload });
  });

  it('is decompressed and parsed when sent deflate-encoded', async () => {
    const payload = { name: 'joel' };
    const res = await post().set('Content-Encoding', 'deflate').send(deflateSync(JSON.stringify(payload)));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: payload });
  });

  it('answers 400 invalid_json when the gzip body holds broken JSON, without quoting it', async () => {
    const res = await post().set('Content-Encoding', 'gzip').send(gzipSync('{"password":"hunter2-SECRET-PASSWORD", oops'));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'Invalid JSON body', code: 'invalid_json' });
    expect(res.text).not.toMatch(/hunter2|SECRET-PASSWORD|oops/);
  });

  it('answers 413 payload_too_large when the size after decompression is over the limit', async () => {
    const compressed = gzipSync(JSON.stringify({ filler: 'x'.repeat(200 * 1024) }));
    expect(compressed.length).toBeLessThan(100 * 1024); // under gränsen komprimerad, över den uppackad
    const res = await post().set('Content-Encoding', 'gzip').send(compressed);
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ success: false, error: 'Request body too large', code: 'payload_too_large' });
  });

  it('is answered with a JSON error, not left hanging, when bytes trail the compressed stream', async () => {
    const withTrailing = Buffer.concat([gzipSync(JSON.stringify({ name: 'joel' })), Buffer.from('trailing garbage bytes')]);
    const res = await post().set('Content-Encoding', 'gzip').send(withTrailing).timeout({ response: 5000, deadline: 8000 });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.success).toBe(false);
  }, 15000);
});
