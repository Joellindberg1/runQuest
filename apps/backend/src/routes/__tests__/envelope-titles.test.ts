/**
 * Kuvertet i /api/titles, steg 1 (ADR 007 Addendum 2026-10-20): `success` och `code` på varje svar, `data` bredvid `message` i refresh/populate, och reprocess-all:
 * 207 `partial_failure` är det enda 2xx-svaret med `success: false` och bär räknarna i `data` med de gamla toppnivåfälten kvar bredvid.
 * Okänd användare och användare i en annan grupp ger byte-identiskt 404 (A6, ADR 012 beslut 5).
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

const services = vi.hoisted(() => {
  const fns = {
    processAllGroupsTitles: vi.fn(),
    getAllTitles: vi.fn(),
    getTitleLeaderboard: vi.fn(),
    getUserTitles: vi.fn(),
    populateTitleLeaderboard: vi.fn(),
    getGroupEligibility: vi.fn(),
  };
  const leaderboardService = { getAllTitles: fns.getAllTitles, getTitleLeaderboard: fns.getTitleLeaderboard, getUserTitles: fns.getUserTitles, populateTitleLeaderboard: fns.populateTitleLeaderboard };
  return { ...fns, leaderboardService };
});
vi.mock('../../services/enhancedTitleService', () => ({ enhancedTitleService: { processAllGroupsTitles: services.processAllGroupsTitles } }));
vi.mock('../../services/enhancedTitleService.js', () => ({ enhancedTitleService: { processAllGroupsTitles: services.processAllGroupsTitles } }));
vi.mock('../../services/titleLeaderboardService', () => ({ titleLeaderboardService: services.leaderboardService, TitleLeaderboardService: vi.fn() }));
vi.mock('../../services/titleLeaderboardService.js', () => ({ titleLeaderboardService: services.leaderboardService, TitleLeaderboardService: vi.fn() }));
vi.mock('../../services/groupEligibility', () => ({ getGroupEligibility: services.getGroupEligibility }));
vi.mock('../../services/groupEligibility.js', () => ({ getGroupEligibility: services.getGroupEligibility }));

import { getSupabaseClient } from '../../config/database.js';
import app from '../../app.js';
import { createFakeDb } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });

function asAdmin(isAdmin = true) {
  const db = createFakeDb({ users: [{ id: 'admin-1', is_admin: isAdmin }] });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as never);
}
const admin = () => mintToken({ user_id: 'admin-1', group_id: 'group-1' });
const reprocess = () => server.request('POST', '/api/titles/reprocess-all', { token: admin() });

beforeEach(() => { vi.clearAllMocks(); asAdmin(); });

describe('POST /api/titles/reprocess-all', () => {
  it('answers 200 with the counters in data and at the top level when every user succeeded', async () => {
    services.processAllGroupsTitles.mockResolvedValue({ total: 6, processed: 6, failed: 0 });
    const res = await reprocess();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true, message: 'All user titles reprocessed and leaderboards refreshed', total: 6, processed: 6, failed: 0,
      data: { total: 6, processed: 6, failed: 0 },
    });
  });

  it('answers 207 partial_failure with success: false, the counters in data and the old fields next to it', async () => {
    services.processAllGroupsTitles.mockResolvedValue({ total: 6, processed: 4, failed: 2 });
    const res = await reprocess();
    expect(res.status).toBe(207);
    expect(res.body).toEqual({
      success: false,
      error: '2 of 6 users failed; the rest were recalculated',
      code: 'partial_failure',
      data: { total: 6, processed: 4, failed: 2 },
      message: '2 of 6 users failed; the rest were recalculated',
      total: 6, processed: 4, failed: 2,
    });
  });

  it('is the only 2xx answer with success: false, and the only error answer that carries data', async () => {
    services.processAllGroupsTitles.mockResolvedValue({ total: 6, processed: 4, failed: 2 });
    const partial = await reprocess();
    expect(partial.status).toBeGreaterThanOrEqual(200);
    expect(partial.status).toBeLessThan(300);
    expect(partial.body.success).toBe(false);

    services.processAllGroupsTitles.mockRejectedValue(new Error('Users fetch failed for 12345678901'));
    const thrown = await reprocess();
    expect(thrown.status).toBe(500);
    expect(thrown.body).toEqual({ success: false, error: 'Failed to reprocess titles', code: 'internal_error' });
    expect(thrown.body).not.toHaveProperty('data');
  });

  it('answers 500 internal_error with the counters in data when every user failed', async () => {
    services.processAllGroupsTitles.mockResolvedValue({ total: 3, processed: 0, failed: 3 });
    const res = await reprocess();
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      success: false, error: 'All 3 users failed', code: 'internal_error', data: { total: 3, processed: 0, failed: 3 },
      message: 'All 3 users failed', total: 3, processed: 0, failed: 3,
    });
  });

  it('answers admin_required for a non-admin', async () => {
    asAdmin(false);
    const res = await reprocess();
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ success: false, error: 'Admin access required', code: 'admin_required' });
  });
});

describe('POST /api/titles/refresh and /populate', () => {
  it('answers message and timestamp at the top level and timestamp in data', async () => {
    services.populateTitleLeaderboard.mockResolvedValue(undefined);
    for (const [path, message] of [['/api/titles/refresh', 'Title leaderboards refreshed successfully'], ['/api/titles/populate', 'Title leaderboards populated successfully']] as const) {
      const res = await server.request('POST', path, { token: admin() });
      expect(res.status, path).toBe(200);
      expect(res.body.success, path).toBe(true);
      expect(res.body.message, path).toBe(message);
      expect(res.body.data, path).toEqual({ timestamp: res.body.timestamp });
    }
  });

  it('answers 500 internal_error with a fixed text when the rebuild fails, and 403 group_required for an admin without a group', async () => {
    services.populateTitleLeaderboard.mockRejectedValue(new Error('relation does not exist'));
    const failed = await server.request('POST', '/api/titles/refresh', { token: admin() });
    expect(failed.status).toBe(500);
    expect(failed.body).toEqual({ success: false, error: 'Failed to refresh title leaderboards', code: 'internal_error' });

    const noGroup = await server.request('POST', '/api/titles/refresh', { token: mintToken({ user_id: 'admin-1', group_id: null }) });
    expect(noGroup.status).toBe(403);
    expect(noGroup.body).toEqual({ success: false, error: 'Admin must belong to a group', code: 'group_required' });
  });
});

describe('the reads', () => {
  it('answers { success, data, meta } for the catalogue, the leaderboard and the group eligibility, unchanged', async () => {
    services.getAllTitles.mockResolvedValue([{ id: 't1' }]);
    services.getTitleLeaderboard.mockResolvedValue([{ id: 't1' }]);
    services.getGroupEligibility.mockResolvedValue([{ key: 'k' }]);
    const catalogue = await server.request('GET', '/api/titles', { token: admin() });
    expect(catalogue.body).toMatchObject({ success: true, data: [{ id: 't1' }], meta: { total_titles: 1 } });
    const leaderboard = await server.request('GET', '/api/titles/leaderboard', { token: admin() });
    expect(leaderboard.body).toMatchObject({ success: true, data: [{ id: 't1' }], meta: { total_titles: 1, cache_optimized: true } });
    const eligibility = await server.request('GET', '/api/titles/group-eligibility', { token: admin() });
    expect(eligibility.body).toEqual({ success: true, data: [{ key: 'k' }] });
  });

  it('answers 200 with empty data in the envelope for a token without a group', async () => {
    const res = await server.request('GET', '/api/titles/leaderboard', { token: mintToken({ user_id: 'admin-1', group_id: null }) });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: [], meta: { total_titles: 0 } });
  });

  it('answers the same 404 for an unknown user and for a user in another group, byte for byte', async () => {
    // getUserTitles ger null både för en okänd användare och för en användare utanför anroparens grupp
    services.getUserTitles.mockResolvedValue(null);
    const unknown = await server.request('GET', '/api/titles/user/00000000-0000-4000-8000-0000000000aa', { token: admin() });
    const otherGroup = await server.request('GET', '/api/titles/user/00000000-0000-4000-8000-0000000000bb', { token: admin() });
    expect(unknown.status).toBe(404);
    expect(otherGroup.status).toBe(404);
    expect(JSON.stringify(otherGroup.body)).toBe(JSON.stringify(unknown.body));
    expect(unknown.body).toEqual({ success: false, error: 'User not found', code: 'not_found' });
  });

  it('answers 500 internal_error with fixed texts when a service throws, never the message of the error', async () => {
    services.getAllTitles.mockRejectedValue(new Error('duplicate key for activity 12345678901 token SECRET'));
    const res = await server.request('GET', '/api/titles', { token: admin() });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to fetch titles', code: 'internal_error' });
  });
});
