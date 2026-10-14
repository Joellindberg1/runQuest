/**
 * The delete handler's own limit on token renewals: at most one forced renewal per event, whatever decideAction says. decideAction is
 * replaced here by a function that asks for a renewal every time (a bug or a changed table), which is the only way to reach the limit.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/database.js', () => ({ default: {}, supabase: { client: {} }, getSupabaseClient: vi.fn() }));
vi.mock('../stravaWebhook/decideAction.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../stravaWebhook/decideAction.js')>()),
  decideAction: vi.fn(() => ({ action: 'refresh_token', outcome: null, countsAsFailedAttempt: false, recalculateFrom: null, clearWeather: false, recalculateUnknown: false })),
}));

import { createActivityDeleteHandler } from '../stravaWebhook/handlers/activityDelete.js';
import type { StravaApi } from '../stravaWebhook/ports.js';
import { createInMemoryRunStore } from '../../test-utils/inMemoryWebhookPorts.js';
import type { WebhookHandlerContext } from '../stravaWebhookWorker.js';

describe('activity delete token renewal limit', () => {
  it('renews at most once per event even when the decision keeps asking for a renewal, and deletes nothing', async () => {
    let renewals = 0;
    let reads = 0;
    const token = { ok: true as const, accessToken: 'at', refreshed: false, expiresAt: null, connectionDate: null, consentVersion: null };
    const strava: StravaApi = {
      getAccessToken: async () => token,
      // A renewal beyond the first ends the loop another way, so a missing limit fails an assertion instead of hanging the test.
      refreshAccessToken: async () => (++renewals > 2 ? { ok: false, reason: 'refresh_failed', expiresAt: null, connectionDate: null, consentVersion: null } : token),
      fetchActivity: async () => {
        reads += 1;
        return { kind: 'http', status: 401 };
      },
      fetchAthlete: async () => ({ kind: 'http', status: 200 }),
    };
    const runs = createInMemoryRunStore();
    const ctx = {
      event: { id: 1, object_id: 9001 },
      userId: 'user-1',
      attempts: 0,
      strava,
      runs,
      now: () => new Date(),
    } as unknown as WebhookHandlerContext;

    const result = await createActivityDeleteHandler()(ctx);

    expect(result).toEqual({ status: 'retry', error: 'unauthorized' });
    expect(renewals).toBe(1);
    expect(reads).toBe(2);
    expect(runs.removeCalls).toEqual([]);
  });
});
