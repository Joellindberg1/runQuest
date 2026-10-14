/**
 * The release gate of v0.7.0: the worker runs in production from server.ts, and an event kind without a registered handler ends as
 * done / noop with only a warning, which is a deletion that never happened. This test fails until every kind Strava sends has a
 * handler, and fails again if one is ever dropped or an unexpected one is added without a decision.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../config/database.js', () => ({ default: {}, supabase: { client: {} }, getSupabaseClient: vi.fn() }));

import { webhookHandlerKey } from '../../stravaWebhookWorker.js';
import { STRAVA_WEBHOOK_HANDLERS } from '../handlers.js';

describe('the registered Strava webhook handlers', () => {
  it('every Strava webhook event kind has a registered handler', () => {
    const expected = [
      webhookHandlerKey('activity', 'create'),
      webhookHandlerKey('activity', 'update'),
      webhookHandlerKey('activity', 'delete'),
      webhookHandlerKey('athlete', 'update'),
    ];

    expect(Object.keys(STRAVA_WEBHOOK_HANDLERS).sort()).toEqual([...expected].sort());
    for (const key of expected) expect(typeof STRAVA_WEBHOOK_HANDLERS[key]).toBe('function');
  });
});
