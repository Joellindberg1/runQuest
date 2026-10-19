/**
 * /api/titles/* gäller anroparens grupp (ADR 012 beslut 5, ADR 007 A6). Regeln om vad en grupp ser bor i titleLeaderboardService och testas där;
 * här bevisas kopplingen: att routen tar gruppen ur token, svarar tomt utan grupp, ger samma 404 för en användare i en annan grupp som för en
 * okänd, och att adminunderhållet bara bygger om adminens egen grupp.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { TitleLeaderboardResponse, UserTitlesResponse } from '@runquest/shared';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

const holder = vi.hoisted(() => ({ client: null as any }));

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { get client() { return holder.client; } },
  getSupabaseClient: vi.fn(() => holder.client),
}));

import app from '../../app.js';
import { logger } from '../../utils/logger.js';
import { createFakeDb, type Row, type RecordedQuery } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

const G1 = 'group-1';
const G2 = 'group-2';
const TITLE_TABLES = ['titles', 'title_leaderboard_view', 'user_titles'];

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });

beforeEach(() => {
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

function viewRow(titleId: string, titleName: string, groupId: string, position: number, userId: string, userName: string, value: number): Row {
  return {
    title_id: titleId, title_name: titleName, title_description: 'd', unlock_requirement: 1, metric_key: 'm', position, user_id: userId,
    user_name: userName, user_gender: null, profile_picture: null, value, earned_at: '2026-10-01T00:00:00Z', status: position === 1 ? 'holder' : 'runner_up', group_id: groupId,
  };
}

const tables = (): Record<string, Row[]> => ({
  users: [
    { id: 'u1', name: 'Anna', group_id: G1, is_admin: false },
    { id: 'u2', name: 'Bertil', group_id: G1, is_admin: false },
    { id: 'u9', name: 'Stranger', group_id: G2, is_admin: false },
    { id: 'admin-1', name: 'Admin', group_id: G1, is_admin: true },
    { id: 'admin-nogroup', name: 'Ghost admin', group_id: null, is_admin: true },
  ],
  group_members: [
    { id: 'm1', user_id: 'u1', group_id: G1, role: 'member', left_at: null },
    { id: 'm2', user_id: 'u2', group_id: G1, role: 'member', left_at: null },
    { id: 'm9', user_id: 'u9', group_id: G2, role: 'member', left_at: null },
  ],
  titles: [
    { id: 't-early', name: 'Early Bird', description: 'd', unlock_requirement: 1, metric_key: 'early' },
    { id: 't-far', name: 'Far Out', description: 'd', unlock_requirement: 1, metric_key: 'far' },
  ],
  title_leaderboard_view: [
    viewRow('t-early', 'Early Bird', G1, 1, 'u1', 'Anna', 50),
    viewRow('t-early', 'Early Bird', G2, 1, 'u9', 'Stranger', 99),
    viewRow('t-far', 'Far Out', G2, 1, 'u9', 'Stranger', 500),
  ],
  user_titles: [{ user_id: 'u9', group_id: G2, title_id: 't-far', value: 500, earned_at: '2026-10-01T00:00:00Z', titles: { name: 'Far Out', description: 'd' } }],
});

function use() {
  const rpcCalls: Array<{ name: string; args: unknown }> = [];
  const record = (name: string) => (args: unknown) => { rpcCalls.push({ name, args }); return { data: null }; };
  const db = createFakeDb(tables(), { rpc: {
    update_group_title_leaderboards: record('update_group_title_leaderboards'),
    rebuild_all_groups: record('rebuild_all_groups'),
    rebuild_one_title: record('rebuild_one_title'),
  } });
  holder.client = db.client;
  return { queries: db.queries, rpcCalls };
}

const touchedTitleTables = (queries: RecordedQuery[]) => queries.filter((q) => TITLE_TABLES.includes(q.table));
const as = (userId: string, groupId: string | null) => mintToken({ user_id: userId, group_id: groupId });

describe('GET /api/titles/leaderboard', () => {
  it("answers the whole catalog with the caller's group as holders, and nothing of another group", async () => {
    use();

    const res = await server.request('GET', '/api/titles/leaderboard', { token: as('u1', G1) });
    const body = res.body as TitleLeaderboardResponse;

    expect(res.status).toBe(200);
    expect(body.data.map((t) => [t.name, t.holder?.user_name ?? null])).toEqual([['Early Bird', 'Anna'], ['Far Out', null]]);
    expect(body.meta).toMatchObject({ total_titles: 2, cache_optimized: true });
    expect(JSON.stringify(body)).not.toContain('Stranger');
  });

  it('answers an empty list, with the same envelope, and reads nothing for a token without a group', async () => {
    const { queries } = use();

    const res = await server.request('GET', '/api/titles/leaderboard', { token: as('u1', null) });
    const body = res.body as TitleLeaderboardResponse;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
    expect(body.meta).toMatchObject({ total_titles: 0 });
    expect(touchedTitleTables(queries)).toEqual([]);
  });
});

describe('GET /api/titles/user/:userId', () => {
  it('answers a group member with their titles', async () => {
    use();

    const res = await server.request('GET', '/api/titles/user/u1', { token: as('u2', G1) });
    const body = res.body as UserTitlesResponse;

    expect(res.status).toBe(200);
    expect(body.data.map((t) => [t.title_id, t.position, t.is_current_holder])).toEqual([['t-early', 1, true]]);
    expect(body.meta).toMatchObject({ user_id: 'u1', total_titles: 1, current_holder_count: 1 });
  });

  it('answers 404 for a user in another group exactly as for a user that does not exist', async () => {
    use();

    const otherGroup = await server.request('GET', '/api/titles/user/u9', { token: as('u1', G1) });
    const unknown = await server.request('GET', '/api/titles/user/no-such-user', { token: as('u1', G1) });

    expect(otherGroup.status).toBe(404);
    expect(otherGroup).toEqual(unknown);
    expect(JSON.stringify(otherGroup.body)).not.toContain('Stranger');
  });

  it('answers an empty list and reads nothing for a token without a group', async () => {
    const { queries } = use();

    const res = await server.request('GET', '/api/titles/user/u1', { token: as('u1', null) });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(queries.filter((q) => q.table !== 'users')).toEqual([]);
  });
});

describe('POST /api/titles/populate and /api/titles/refresh', () => {
  it.each(['populate', 'refresh'])('%s rebuilds the ranking of the admin group only', async (path) => {
    const { rpcCalls } = use();

    const res = await server.request('POST', `/api/titles/${path}`, { token: as('admin-1', G1) });

    expect(res.status).toBe(200);
    expect(rpcCalls).toEqual([{ name: 'update_group_title_leaderboards', args: { p_group_id: G1 } }]);
  });

  it.each(['populate', 'refresh'])('%s answers 403 and rebuilds nothing for an admin without a group', async (path) => {
    const { rpcCalls } = use();

    const res = await server.request('POST', `/api/titles/${path}`, { token: as('admin-nogroup', null) });

    expect(res.status).toBe(403);
    expect(rpcCalls).toEqual([]);
  });

  it.each(['populate', 'refresh'])('%s stays closed to a user who is not an admin', async (path) => {
    const { rpcCalls } = use();

    const res = await server.request('POST', `/api/titles/${path}`, { token: as('u1', G1) });

    expect(res.status).toBe(403);
    expect(rpcCalls).toEqual([]);
  });
});
