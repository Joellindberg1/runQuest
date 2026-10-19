/**
 * The pause only stops new imports (ADR 010 decision 7.5): the runs a user already has keep counting for XP, level, badges and
 * titles. Real calculateUserTotals and real evaluateBadges against fakeDb; the title service is a spy.
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
vi.mock('../../services/levelService.js', () => ({ getLevelFromXP: vi.fn(async () => 1) }));
vi.mock('../../services/challengeService.js', () => ({ reconcileTokensForLevel: vi.fn(async () => undefined) }));
const processGroupTitles = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock('../../services/enhancedTitleService.js', () => ({
  EnhancedTitleService: class { processGroupTitles = processGroupTitles; },
}));

import { getSupabaseClient } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import { calculateUserTotals } from '../../utils/calculateUserTotals.js';
import app from '../../app.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => {
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  server = await startServer(app);
});
afterAll(async () => { await server.close(); });
beforeEach(() => { processGroupTitles.mockClear(); });

describe('a paused user keeps what the imported runs earned', () => {
  it("a paused user's existing runs still count for xp, titles and badges", async () => {
    const tables: Record<string, Row[]> = {
      activity_log: [],
      user_badges: [],
      strava_tokens: [{ user_id: 'u1', access_token: 'at', refresh_token: 'rt', expires_at: 9999999999, sync_paused: false, paused_at: null }],
      users: [{ id: 'u1', group_id: 'g1', event_xp: 0, current_level: 1, total_km: 0, total_xp: 0, current_streak: 0, longest_streak: 0, displayed_badge_series: [] }],
      group_members: [{ id: 'm1', user_id: 'u1', group_id: 'g1', role: 'member', starts_on: null, left_at: null }],
      runs: [
        { id: 'r1', user_id: 'u1', date: '2020-01-01', distance: 5, xp_gained: 10, source: 'strava', external_id: '1' },
        { id: 'r2', user_id: 'u1', date: '2020-01-02', distance: 7, xp_gained: 14, source: 'strava', external_id: '2' },
      ],
    };
    vi.mocked(getSupabaseClient).mockReturnValue(createFakeDb(tables, { numericIds: ['activity_log'] }).client as any);

    const pause = await server.request('PUT', '/api/strava/sync-paused', { token: mintToken({ user_id: 'u1' }), body: { paused: true } });
    expect(pause.body.data.sync_paused).toBe(true);
    await calculateUserTotals('u1'); // what every run-affecting action ends with

    expect(tables.users[0]).toMatchObject({ total_xp: 24, total_km: 12 });
    expect(tables.runs).toHaveLength(2); // the pause deletes nothing
    expect(tables.user_badges.filter((badge) => badge.series === 'milestoner')).toHaveLength(1);
    expect(processGroupTitles).toHaveBeenCalledWith('g1');
  });
});
