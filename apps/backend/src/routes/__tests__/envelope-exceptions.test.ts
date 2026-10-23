/**
 * Undantagen från kuvertet (ADR 007 Addendum 2026-10-20 punkt 4) är kort, uttömmande och fäst här: en ny avvikelse kräver en ändring av det här testet och därmed en granskad diff.
 *  - Strava-webhookens GET och POST `/` (Stravas protokoll styr svaret, även felsvaren), men INTE `/health`;
 *  - `GET /health` (liveness, kan läsas utanför repot) och `GET /api` (vägvisare för människor).
 * Inte undantagna, och därför i kuvertet: `GET /api/public/stats`, `GET /api/strava/config` och väntelistan (se de andra envelope-filerna).
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

import { getSupabaseClient } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import { createApp } from '../../app.js';
import { STRAVA_WEBHOOK_PATH } from '../../services/stravaWebhook/constants.js';
import { createFakeDb } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
const VERIFY_TOKEN = 'verify-token-for-tests-0123456789abcdef';

beforeAll(async () => { server = await startServer(createApp()); });
afterAll(async () => { await server.close(); });
beforeEach(() => {
  process.env.STRAVA_WEBHOOK_VERIFY_TOKEN = VERIFY_TOKEN;
  process.env.STRAVA_WEBHOOK_SUBSCRIPTION_ID = '4242';
  for (const level of ['info', 'warn', 'error'] as const) vi.spyOn(logger, level).mockImplementation(() => {});
  const db = createFakeDb({ users: [{ id: 'admin-1', is_admin: true }], strava_webhook_events: [], strava_tokens: [] }, { autoIds: true });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as never);
});
afterEach(() => {
  delete process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;
  delete process.env.STRAVA_WEBHOOK_SUBSCRIPTION_ID;
  vi.restoreAllMocks();
});

describe('the Strava webhook protocol routes are unchanged', () => {
  it('GET / verifies a subscription with exactly { "hub.challenge": … }', async () => {
    const res = await server.request('GET', `${STRAVA_WEBHOOK_PATH}?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=abc123`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ 'hub.challenge': 'abc123' });
  });

  it('GET / refuses a wrong verify token with exactly { error: "Forbidden" } and no success or code', async () => {
    const res = await server.request('GET', `${STRAVA_WEBHOOK_PATH}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc123`);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden' });
  });

  it('POST / acknowledges an event with exactly { received: true }', async () => {
    const res = await server.request('POST', STRAVA_WEBHOOK_PATH, { body: { object_type: 'activity', aspect_type: 'create', object_id: 1, owner_id: 2, subscription_id: 4242, event_time: 1_760_000_000, updates: {} } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
  });

  it('POST / keeps its error bodies: { error } for an invalid event, a wrong subscription id and a body over its own limit', async () => {
    const invalid = await server.request('POST', STRAVA_WEBHOOK_PATH, { body: [] });
    expect(invalid.status).toBe(400);
    expect(invalid.body).toEqual({ error: 'Invalid event' });

    const wrongSubscription = await server.request('POST', STRAVA_WEBHOOK_PATH, { body: { subscription_id: 1 } });
    expect(wrongSubscription.status).toBe(403);
    expect(wrongSubscription.body).toEqual({ error: 'Forbidden' });

    const huge = await server.request('POST', STRAVA_WEBHOOK_PATH, { body: { object_type: 'activity', filler: 'x'.repeat(11 * 1024) } });
    expect(huge.status).toBe(413);
    expect(huge.body).toEqual({ error: 'Request body too large' });
  });

  it('GET /health is NOT an exception: it answers in the envelope (admin only)', async () => {
    const res = await server.request('GET', `${STRAVA_WEBHOOK_PATH}/health`, { token: mintToken({ user_id: 'admin-1' }) });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeTypeOf('object');

    const anonymous = await server.request('GET', `${STRAVA_WEBHOOK_PATH}/health`);
    expect(anonymous.status).toBe(401);
    expect(anonymous.body).toEqual({ success: false, error: 'Authorization header required', code: 'unauthorized' });
  });
});

describe('the liveness answer and the road sign are unchanged', () => {
  it('GET /health answers { status, message, timestamp, uptime } and nothing else', async () => {
    const res = await server.request('GET', '/health');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['message', 'status', 'timestamp', 'uptime']);
    expect(res.body.status).toBe('OK');
    expect(res.body).not.toHaveProperty('success');
    expect(res.body).not.toHaveProperty('data');
  });

  it('GET /api answers { message, endpoints, version, environment } and nothing else', async () => {
    const res = await server.request('GET', '/api');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['endpoints', 'environment', 'message', 'version']);
    expect(res.body).not.toHaveProperty('success');
    expect(res.body).not.toHaveProperty('data');
  });
});
