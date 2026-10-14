/**
 * Outside production nothing processes a stored event: createApp passes the real wake-up to the webhook route, and the real
 * wake-up does nothing until startStravaWebhookScheduler() has run (server.ts, production only). Proven through the app: the
 * event is stored, the claim RPC is never called.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.STRAVA_WEBHOOK_SUBSCRIPTION_ID = '4242';

vi.mock('../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from '../config/database.js';
import { createApp } from '../app.js';
import { STRAVA_WEBHOOK_PATH } from '../services/stravaWebhook/constants.js';
import { createFakeDb } from '../routes/__tests__/helpers/fakeDb.js';
import { startServer } from '../routes/__tests__/helpers/http.js';

describe('webhook wake-up outside production', () => {
  const claim = vi.fn(() => ({ data: [] }));
  beforeEach(() => {
    claim.mockClear();
  });

  it('stores the event and starts no worker when the scheduler has not been started', async () => {
    const tables = { strava_tokens: [{ user_id: 'user-777', strava_athlete_id: 777 }], strava_webhook_events: [] as Array<Record<string, unknown>> };
    vi.mocked(getSupabaseClient).mockReturnValue(createFakeDb(tables, { rpc: { claim_strava_webhook_events: claim } }).client as any);
    const server = await startServer(createApp());
    try {
      const response = await server.request('POST', STRAVA_WEBHOOK_PATH, {
        body: {
          object_type: 'activity',
          object_id: 9001,
          aspect_type: 'create',
          owner_id: 777,
          subscription_id: 4242,
          event_time: 1_760_000_000,
          updates: {},
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(response.status).toBe(200);
      expect(tables.strava_webhook_events).toHaveLength(1);
      expect(claim).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });
});
