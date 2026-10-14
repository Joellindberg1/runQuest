/**
 * createApp wires the webhook route to the worker's wake-up (ADR 010 decision 6): a stored event calls
 * wakeStravaWebhookWorker once, a duplicate or an unknown owner does not. Whether the wake-up does anything is the scheduler's
 * business (webhookWakeInactive.test.ts and scheduler/__tests__/stravaWebhookScheduler.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.STRAVA_WEBHOOK_SUBSCRIPTION_ID = '4242';

const wake = vi.hoisted(() => vi.fn());

vi.mock('../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));
vi.mock('../scheduler/stravaWebhookScheduler.js', () => ({ wakeStravaWebhookWorker: wake, startStravaWebhookScheduler: vi.fn() }));

import { getSupabaseClient } from '../config/database.js';
import { createApp } from '../app.js';
import { STRAVA_WEBHOOK_PATH } from '../services/stravaWebhook/constants.js';
import { createFakeDb } from '../routes/__tests__/helpers/fakeDb.js';
import { startServer, type TestServer } from '../routes/__tests__/helpers/http.js';

let server: TestServer;
beforeEach(async () => {
  vi.clearAllMocks();
  const db = createFakeDb({ strava_tokens: [{ user_id: 'user-777', strava_athlete_id: 777 }], strava_webhook_events: [] });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  server = await startServer(createApp());
});
afterEach(async () => {
  await server.close();
});

const event = (over: Record<string, unknown> = {}) => ({
  object_type: 'activity',
  object_id: 9001,
  aspect_type: 'create',
  owner_id: 777,
  subscription_id: 4242,
  event_time: 1_760_000_000,
  updates: {},
  ...over,
});
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('webhook route wiring', () => {
  it('a stored event wakes the worker once, and a redelivery does not', async () => {
    expect((await server.request('POST', STRAVA_WEBHOOK_PATH, { body: event() })).status).toBe(200);
    await flush();
    expect(wake).toHaveBeenCalledTimes(1);

    expect((await server.request('POST', STRAVA_WEBHOOK_PATH, { body: event() })).status).toBe(200);
    await flush();
    expect(wake).toHaveBeenCalledTimes(1);
  });

  it('an event from an unknown owner does not wake the worker', async () => {
    expect((await server.request('POST', STRAVA_WEBHOOK_PATH, { body: event({ owner_id: 12345 }) })).status).toBe(200);
    await flush();
    expect(wake).not.toHaveBeenCalled();
  });
});
