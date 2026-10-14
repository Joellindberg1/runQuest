/**
 * Defence in depth for "the update never writes the XP columns": decideAction is replaced by one that, wrongly, puts XP columns into
 * the changes of an update. The handler and the adapter must still refuse to write them. (Nothing in the real decision does this; the
 * point is that the guarantee does not rest on the decision alone.)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/database.js', () => ({ default: {}, supabase: { client: {} }, getSupabaseClient: vi.fn() }));
vi.mock('../../routes/runs.js', () => ({ reprocessRunsFromDate: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../utils/calculateUserTotals.js', () => ({ calculateUserTotals: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../weatherService.js', () => ({ WeatherService: { fetchAndSaveWeatherForRuns: vi.fn() } }));
vi.mock('../eventService.js', () => ({ checkEventQualification: vi.fn() }));
vi.mock('../stravaWebhook/decideAction.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../stravaWebhook/decideAction.js')>()),
  decideAction: vi.fn(() => ({
    action: 'update',
    outcome: 'updated',
    changes: { distance: 9, xp_gained: 999, streak_day: 7 },
    recalculateFrom: '2026-10-10',
    clearWeather: false,
    recalculateUnknown: false,
  })),
}));

import { getSupabaseClient } from '../../config/database.js';
import { createFakeDb, type Row } from '../../routes/__tests__/helpers/fakeDb.js';
import { createActivityUpdateHandler } from '../stravaWebhook/handlers/activityUpdate.js';
import { createRunStore } from '../stravaWebhook/supabaseAdapters.js';
import { createInMemoryRunStore } from '../../test-utils/inMemoryWebhookPorts.js';
import type { StravaApi } from '../stravaWebhook/ports.js';
import type { WebhookHandlerContext } from '../stravaWebhookWorker.js';

const token = { ok: true as const, accessToken: 'at', refreshed: false, expiresAt: null, connectionDate: null, consentVersion: null };
const strava: StravaApi = {
  getAccessToken: async () => token,
  refreshAccessToken: async () => token,
  fetchActivity: async () => ({ kind: 'http', status: 200 }),
  fetchAthlete: async () => ({ kind: 'http', status: 200 }),
};
const ctxFor = (runs: WebhookHandlerContext['runs']) =>
  ({ event: { id: 1, object_id: 9001, aspect_type: 'update' }, userId: 'user-1', attempts: 0, strava, runs, now: () => new Date() }) as unknown as WebhookHandlerContext;

beforeEach(() => vi.clearAllMocks());

describe('activity update guard', () => {
  it('update event never writes the xp columns even if the decision were to produce one (Supabase store)', async () => {
    const tables: Record<string, Row[]> = {
      strava_tokens: [{ user_id: 'user-1', sync_paused: false, connection_date: null }],
      runs: [{ id: 'r', user_id: 'user-1', source: 'strava', external_id: '9001', date: '2026-10-10', distance: 5, xp_gained: 20, streak_day: 3 }],
    };
    const db = createFakeDb(tables);
    vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);

    await expect(createActivityUpdateHandler()(ctxFor(createRunStore()))).rejects.toMatchObject({ code: 'run_patch_forbidden_column' });

    expect(tables.runs[0]).toMatchObject({ distance: 5, xp_gained: 20, streak_day: 3 });
    expect(db.queries.filter((q) => q.mutation)).toEqual([]);
  });

  it('update event never writes the xp columns even if the decision were to produce one (in-memory store)', async () => {
    const runs = createInMemoryRunStore();
    runs.runs.push({ userId: 'user-1', externalId: '9001', date: '2026-10-10', run: { source: 'strava', date: '2026-10-10', distance: 5 } as never });

    await expect(createActivityUpdateHandler()(ctxFor(runs))).rejects.toMatchObject({ code: 'run_patch_forbidden_column' });

    expect(runs.runs[0].run).toMatchObject({ distance: 5 });
    expect(runs.updateCalls).toEqual([]);
  });
});
