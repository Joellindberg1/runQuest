/**
 * DELETE /api/runs/:id is the manual deletion path and is untouched by the Strava deletion chain (ADR 010 decision 8.7). Since
 * migration 047 the foreign key event_entries.run_id no longer stops a delete (ON DELETE SET NULL), so the code check in the route is
 * the only protection of a manual run that qualified an event. Through the real app, with the foreign key actions of the migrations
 * modelled (test-utils/runForeignKeys.ts): a 409 must leave the run, the entry and the XP exactly as they were.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));
vi.mock('../../utils/calculateUserTotals.js', () => ({ calculateUserTotals: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../services/eventService.js', () => ({
  checkEventQualification: vi.fn().mockResolvedValue(undefined),
  maybeCreateEvent: vi.fn(),
  activateScheduledEvents: vi.fn(),
  settleCompetitionEvents: vi.fn(),
  settleExpiredParticipationEvents: vi.fn(),
}));
vi.mock('../../services/weatherService.js', () => ({
  WeatherService: { fetchAndSaveWeatherForRuns: vi.fn().mockResolvedValue(undefined), backfillMissingWeather: vi.fn() },
}));
vi.mock('../../services/xpConfig.js', async () => {
  const shared = await import('@runquest/shared');
  return {
    getXpConfig: vi.fn(async () => ({
      settings: shared.DEFAULT_ADMIN_SETTINGS,
      streak_multipliers: shared.DEFAULT_STREAK_MULTIPLIERS,
      meta: { settings_source: 'defaults', multipliers_source: 'defaults' },
    })),
    invalidateXpConfigCache: vi.fn(),
  };
});

import { getSupabaseClient } from '../../config/database.js';
import { calculateUserTotals } from '../../utils/calculateUserTotals.js';
import app from '../../app.js';
import { withRunForeignKeys } from '../../test-utils/runForeignKeys.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });
beforeEach(() => { vi.clearAllMocks(); });

const token = mintToken({ user_id: 'user-1', group_id: 'group-1' });

const run = (over: Row = {}): Row => ({
  id: 'run-1', user_id: 'user-1', date: '2026-10-01', distance: 4, streak_day: 1, xp_gained: 20, source: 'manual', external_id: null, ...over,
});

function use(runs: Row[], event_entries: Row[] = []) {
  const tables: Record<string, Row[]> = { runs, user_boosts: [], event_entries, run_weather: [], user_badges: [], users: [{ id: 'user-1', event_xp: 40 }] };
  const db = createFakeDb(tables, { autoIds: true });
  vi.mocked(getSupabaseClient).mockReturnValue(withRunForeignKeys(db.client, tables) as any);
  return { tables, db };
}

describe('DELETE /api/runs/:id', () => {
  it('DELETE /api/runs/:id still returns 409 for strava runs and for a manual run that qualified an event', async () => {
    const entry = { id: 'entry-1', event_id: 'event-1', user_id: 'user-1', run_id: 'run-manual', xp_awarded: 40 };
    const { tables, db } = use(
      [run({ id: 'run-strava', source: 'strava', external_id: '42' }), run({ id: 'run-manual', date: '2026-10-02' }), run({ id: 'run-free', date: '2026-10-03' })],
      [entry],
    );

    const strava = await server.request('DELETE', '/api/runs/run-strava', { token });
    const qualified = await server.request('DELETE', '/api/runs/run-manual', { token });

    expect(strava.status).toBe(409);
    expect(strava.body).toEqual({ success: false, error: 'Strava runs are read-only', code: 'strava_read_only' });
    expect(qualified.status).toBe(409);
    expect(qualified.body).toEqual({ success: false, error: "This run qualified an event and can't be deleted — edit it instead", code: 'run_qualified_event' });
    // Nothing moved: both runs are there, the entry still points at its run, the XP is intact, and nothing was recalculated.
    expect(tables.runs.map((r) => r.id)).toEqual(['run-strava', 'run-manual', 'run-free']);
    expect(tables.event_entries).toEqual([entry]);
    expect(tables.users[0].event_xp).toBe(40);
    expect(db.queries.filter((q) => q.mutation)).toEqual([]);
    expect(calculateUserTotals).not.toHaveBeenCalled();
  });

  it('a manual run that qualified no event is still deleted and recalculated', async () => {
    const { tables } = use([run({ id: 'run-free' }), run({ id: 'run-next', date: '2026-10-02', streak_day: 2 })]);

    const res = await server.request('DELETE', '/api/runs/run-free', { token });

    expect(res.status).toBe(200);
    expect(tables.runs.map((r) => r.id)).toEqual(['run-next']);
    expect(calculateUserTotals).toHaveBeenCalledWith('user-1');
  });
});
