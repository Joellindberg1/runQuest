/**
 * GET /api/auth/users-with-runs (ADR 007 B3): additivt start_time + created_at
 * i runs-selecten ("5 h ago"). Inga befintliga fält får försvinna.
 * i9 (open-assumptions backend-fråga 6): additivt `source` per runda, så att Profile kan blockera
 * Delete för Strava-rundor (DELETE saknar gravsten; synken återimporterar annars rundan).
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  testDatabaseConnection: vi.fn(),
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from '../../config/database.js';
import app from '../../app.js';
import { createFakeDb } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });
afterEach(() => { vi.clearAllMocks(); });

describe('GET /api/auth/users-with-runs', () => {
  it('begär start_time och created_at i runs-selecten', async () => {
    const db = createFakeDb({ users: [], user_challenge_tokens: [] });
    vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);

    const res = await server.request('GET', '/api/auth/users-with-runs', { token: mintToken() });
    expect(res.status).toBe(200);

    const sel = db.queries.find((q) => q.table === 'users')!.select!;
    const runsSelect = sel.slice(sel.indexOf('runs('));
    expect(runsSelect).toContain('start_time');
    expect(runsSelect).toContain('created_at');
  });

  it('begär source per runda (additivt, i9) men aldrig external_id (Strava-id)', async () => {
    const db = createFakeDb({ users: [], user_challenge_tokens: [] });
    vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
    await server.request('GET', '/api/auth/users-with-runs', { token: mintToken() });

    const sel = db.queries.find((q) => q.table === 'users')!.select!;
    const runsSelect = sel.slice(sel.indexOf('runs('));
    expect(runsSelect).toMatch(/\bsource\b/);
    expect(runsSelect).not.toMatch(/external_id/);
  });

  it('skickar source vidare per runda: strava, manual och NULL (äldre rader)', async () => {
    const db = createFakeDb({
      users: [{
        id: 'u1', group_id: 'group-1', total_xp: 10,
        runs: [
          { id: 'r1', date: '2026-10-01', distance: 5, source: 'strava' },
          { id: 'r2', date: '2026-10-02', distance: 6, source: 'manual' },
          { id: 'r3', date: '2026-10-03', distance: 7, source: null },
        ],
      }],
      user_challenge_tokens: [],
    });
    vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);

    const res = await server.request('GET', '/api/auth/users-with-runs', { token: mintToken() });
    expect(res.body.data[0].runs.map((r: any) => r.source)).toEqual(['strava', 'manual', null]);
  });

  it('behåller ALLA tidigare fält (bakåtkompatibelt) i både users- och runs-selecten', async () => {
    const db = createFakeDb({ users: [], user_challenge_tokens: [] });
    vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
    await server.request('GET', '/api/auth/users-with-runs', { token: mintToken() });

    const sel = db.queries.find((q) => q.table === 'users')!.select!;
    for (const col of [
      'id', 'name', 'total_xp', 'current_level', 'total_km', 'current_streak', 'longest_streak', 'profile_picture',
      'wins', 'draws', 'losses', 'challenge_active', 'displayed_title_ids', 'gender',
      'user_id', 'date', 'distance', 'xp_gained', 'multiplier', 'streak_day', 'base_xp', 'km_xp',
      'distance_bonus', 'streak_bonus', 'is_treadmill', 'start_time', 'created_at', 'source',
    ]) {
      expect(sel).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });

  it('skickar vidare runs-raderna och challenge_counts oförändrat i formen {success,data}', async () => {
    const db = createFakeDb({
      users: [{
        id: 'u1', group_id: 'group-1', total_xp: 10,
        runs: [{ id: 'r1', date: '2026-10-01', distance: 5, start_time: '2026-10-01T05:00:00Z', created_at: '2026-10-01T07:00:00Z' }],
      }],
      user_challenge_tokens: [{ user_id: 'u1', tier: 'minor', sent_at: null }],
    });
    vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);

    const res = await server.request('GET', '/api/auth/users-with-runs', { token: mintToken() });
    expect(res.body.success).toBe(true);
    expect(res.body.data[0].runs[0]).toMatchObject({ start_time: '2026-10-01T05:00:00Z', created_at: '2026-10-01T07:00:00Z' });
    expect(res.body.data[0].challenge_counts).toEqual({ minor: 1, major: 0, legendary: 0 });
  });
});
