/**
 * Medlemskapslagret i routes (ADR 012 beslut 2): POST /groups/join och POST /auth/users går via join_group, GET /groups/my ger
 * my_role ur group_members. Databasfunktionerna är fejkade (helpers/fakeMembership) och speglar SQL:en i migration 053.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { inspect } from 'node:util';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import app from '../../app.js';
import { createFakeDb, type FakeDbOptions, type Row } from './helpers/fakeDb.js';
import { membershipRpc, type MembershipRpcCall } from './helpers/fakeMembership.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });

const logged: string[] = [];
beforeEach(() => {
  logged.length = 0;
  // '📨'-raderna kommer från request-loggern i app.ts; här gäller bara routens egna loggrader.
  const capture = (m: string, ...args: unknown[]) => {
    if (m.startsWith('📨')) return;
    logged.push([m, ...args.map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 6 })))].join(' '));
  };
  vi.spyOn(logger, 'info').mockImplementation(capture);
  vi.spyOn(logger, 'warn').mockImplementation(capture);
  vi.spyOn(logger, 'error').mockImplementation(capture);
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

const INVITE = 'SECRET42';
const G1 = 'group-1';
const G2 = 'group-2';

function use(tables: Record<string, Row[]>, options: FakeDbOptions = {}, beforeRpc?: (name: string, args: any, state: Record<string, Row[]>) => void) {
  const calls: MembershipRpcCall[] = [];
  const state: Record<string, Row[]> = { users: [], groups: [], group_members: [], ...tables };
  const fakes = membershipRpc(state, calls);
  const rpc: NonNullable<FakeDbOptions['rpc']> = Object.fromEntries(
    Object.entries(fakes).map(([name, fake]) => [name, (args: any) => { beforeRpc?.(name, args, state); return fake(args); }]),
  );
  const db = createFakeDb(state, { autoIds: true, ...options, rpc: { ...rpc, ...options.rpc } });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return { tables: state, calls, queries: db.queries };
}

/** Fejkar rpc update_group_title_leaderboards och samlar anropen (i ordning med join_group via samma lista). */
function rebuildRpc(order: string[] = [], result: { error?: { code: string; message: string } } = {}): NonNullable<FakeDbOptions['rpc']> {
  return {
    update_group_title_leaderboards: (args: any) => { order.push('rebuild:' + args.p_group_id); return result.error ? { error: result.error } : { data: null }; },
    rebuild_all_groups: () => { order.push('rebuild:ALL'); return { data: null }; },
  };
}

const groups = (): Row[] => [
  { id: G1, name: 'Crew', invite_code: INVITE, owner_id: 'owner-1', created_at: '2026-01-01T00:00:00Z' },
  { id: G2, name: 'Other crew', invite_code: 'OTHER99', owner_id: 'owner-2', created_at: '2026-01-02T00:00:00Z' },
];

const member = (user_id: string, group_id: string, role: 'admin' | 'member', left_at: string | null = null): Row =>
  ({ id: `m-${user_id}`, user_id, group_id, role, starts_on: null, joined_at: '2026-01-01T00:00:00Z', left_at });

describe('POST /api/groups/join', () => {
  const join = (code: unknown, token = mintToken({ user_id: 'user-1', group_id: null })) =>
    server.request('POST', '/api/groups/join', { token, body: { invite_code: code } });

  it('makes a user without a membership a member of the group and answers as before', async () => {
    const { tables } = use({ groups: groups(), users: [{ id: 'user-1', group_id: null }] });

    const res = await join('secret42');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'Successfully joined group "Crew"', group: { id: G1, name: 'Crew' } });
    expect(tables.group_members).toMatchObject([{ user_id: 'user-1', group_id: G1, role: 'member', starts_on: null, left_at: null }]);
    expect(tables.users[0]!.group_id).toBe(G1);
  });

  it('answers 409 and changes nothing when the user already has an active membership', async () => {
    const { tables } = use({
      groups: groups(),
      users: [{ id: 'user-1', group_id: G2 }],
      group_members: [member('user-1', G2, 'member')],
    });

    const res = await join(INVITE, mintToken({ user_id: 'user-1', group_id: G2 }));

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'You are already a member of a group' });
    expect(tables.users[0]!.group_id).toBe(G2);
    expect(tables.group_members).toHaveLength(1);
    expect(tables.group_members[0]).toMatchObject({ group_id: G2, left_at: null });
  });

  it('answers 409 also when the invite code is the user\'s own group', async () => {
    const { tables } = use({
      groups: groups(),
      users: [{ id: 'user-1', group_id: G1 }],
      group_members: [member('user-1', G1, 'member')],
    });

    const res = await join(INVITE, mintToken({ user_id: 'user-1', group_id: G1 }));

    expect(res.status).toBe(409);
    expect(tables.group_members).toHaveLength(1);
  });

  it('answers 409 for a race the database settles on its own unique index, without the invite code anywhere', async () => {
    use({ groups: groups(), users: [{ id: 'user-1', group_id: null }] }, {
      rpc: {
        join_group: () => ({
          error: {
            code: '23505',
            message: 'duplicate key value violates unique constraint "group_members_one_active_per_user"',
            details: `Key (user_id)=(user-1) already exists. invite ${INVITE}`,
          },
        }),
      },
    });

    const res = await join(INVITE);

    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).not.toContain(INVITE);
    expect(logged.join('\n')).not.toMatch(new RegExp(INVITE, 'i'));
  });

  it('passes the Stockholm day, not the UTC day, as p_today', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-30T22:30:00Z')); // 00:30 den 1 juli i Stockholm
    const { calls } = use({ groups: groups(), users: [{ id: 'user-1', group_id: null }] });

    const res = await join(INVITE, mintToken({ user_id: 'user-1', group_id: null }));

    expect(res.status).toBe(200);
    expect(calls).toEqual([{ name: 'join_group', args: { p_user_id: 'user-1', p_group_id: G1, p_role: 'member', p_today: '2026-07-01' } }]);
  });

  it('never writes the user row itself', async () => {
    const { queries } = use({ groups: groups(), users: [{ id: 'user-1', group_id: null }] });

    await join(INVITE);

    expect(queries.filter((q) => q.table === 'users' && q.mutation)).toEqual([]);
  });

  it('rebuilds the ranking of the joined group, and only that group, after join_group succeeded', async () => {
    const order: string[] = [];
    use({ groups: groups(), users: [{ id: 'user-1', group_id: null }] }, {
      rpc: rebuildRpc(order),
    }, (name) => { order.push(name); });

    const res = await join(INVITE);

    expect(res.status).toBe(200);
    expect(order).toEqual(['join_group', 'rebuild:' + G1]);
  });

  it('gives no title news for the rebuild: no activity is written and no holders are read', async () => {
    const { queries } = use({ groups: groups(), users: [{ id: 'user-1', group_id: null }], activity_log: [], title_leaderboard: [] }, { rpc: rebuildRpc() });

    const res = await join(INVITE);

    expect(res.status).toBe(200);
    expect(queries.filter((q) => q.table === 'activity_log' || q.table === 'title_leaderboard')).toEqual([]);
  });

  it('still answers 200 and logs only the code when the ranking rebuild fails (the membership is already saved)', async () => {
    const { tables } = use({ groups: groups(), users: [{ id: 'user-1', group_id: null }] }, {
      rpc: rebuildRpc([], { error: { code: '40P01', message: `deadlock ${INVITE} jane@example.com` } }),
    });

    const res = await join(INVITE);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(tables.group_members).toHaveLength(1);
    expect(logged.join('\n')).toContain('40P01');
    expect(logged.join('\n')).not.toMatch(new RegExp(INVITE + '|jane@example.com', 'i'));
  });

  it.each([
    ['an active membership (409)', { groups: groups(), users: [{ id: 'user-1', group_id: G2 }], group_members: [member('user-1', G2, 'member')] }, undefined],
    ['a join_group failure (500)', { groups: groups(), users: [{ id: 'user-1', group_id: null }] }, { code: '40P01', message: 'deadlock' }],
  ])('does not rebuild any ranking after %s', async (_label, tables, joinError) => {
    const order: string[] = [];
    use(tables as Record<string, Row[]>, { rpc: { ...rebuildRpc(order), ...(joinError ? { join_group: () => ({ error: joinError }) } : {}) } });

    await join(INVITE, mintToken({ user_id: 'user-1', group_id: null }));

    expect(order).toEqual([]);
  });

  it('answers 404 for an unknown invite code and does not call join_group', async () => {
    const { calls } = use({ groups: groups(), users: [{ id: 'user-1', group_id: null }] });

    const res = await join('NOPE');

    expect(res.status).toBe(404);
    expect(calls).toEqual([]);
  });

  it.each([[123], [['SECRET42']], [{ code: 'x' }], ['']])('answers 400 for an invite code that is not a non-empty string (%j)', async (code) => {
    const { calls } = use({ groups: groups(), users: [{ id: 'user-1', group_id: null }] });

    const res = await join(code);

    expect(res.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('answers 404 when join_group says the group or the user does not exist', async () => {
    use({ groups: groups(), users: [{ id: 'user-1', group_id: null }] }, {
      rpc: { join_group: () => ({ error: { code: 'P0002', message: 'join_group: group_not_found' } }) },
    });

    const res = await join(INVITE);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Group or user not found' });
  });

  it('answers 500 with a generic body and logs only the code when join_group fails for another reason', async () => {
    use({ groups: groups(), users: [{ id: 'user-1', group_id: null }] }, {
      rpc: { join_group: () => ({ error: { code: '40P01', message: `deadlock detected for ${INVITE}`, details: `invite ${INVITE}` } }) },
    });

    const res = await join(INVITE);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to join group' });
    expect(logged.join('\n')).toContain('40P01');
    expect(logged.join('\n')).not.toMatch(new RegExp(INVITE, 'i'));
  });
});

describe('GET /api/groups/my', () => {
  const my = (token: string) => server.request('GET', '/api/groups/my', { token });
  const people = (): Row[] => [
    { id: 'owner-1', name: 'Owner', group_id: G1, total_xp: 50, current_level: 3 },
    { id: 'user-2', name: 'Plain', group_id: G1, total_xp: 10, current_level: 1 },
  ];

  it('returns my_role admin for the admin of the group', async () => {
    use({ groups: groups(), users: people(), group_members: [member('owner-1', G1, 'admin'), member('user-2', G1, 'member')] });

    const res = await my(mintToken({ user_id: 'owner-1', group_id: G1 }));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: G1, name: 'Crew', my_role: 'admin', is_owner: true, invite_code: INVITE, member_count: 2 });
  });

  it('returns my_role member for a plain member, without the invite code', async () => {
    use({ groups: groups(), users: people(), group_members: [member('owner-1', G1, 'admin'), member('user-2', G1, 'member')] });

    const res = await my(mintToken({ user_id: 'user-2', group_id: G1 }));

    expect(res.status).toBe(200);
    expect(res.body.data.my_role).toBe('member');
    expect(res.body.data.is_owner).toBe(false);
    expect(res.body.data.invite_code).toBeUndefined();
  });

  it('reads the role from the database and not from the token', async () => {
    use({ groups: groups(), users: people(), group_members: [member('owner-1', G1, 'admin'), member('user-2', G1, 'member')] });
    const forged = jwt.sign({ user_id: 'user-2', group_id: G1, role: 'admin', my_role: 'admin', name: 'Plain', email: 'p@example.com' }, process.env.JWT_SECRET!, { expiresIn: '1h' });

    const res = await my(forged);

    expect(res.body.data.my_role).toBe('member');
  });

  it('answers 404 and gives out no group data when the token has a group but the user has no active membership in it', async () => {
    use({ groups: groups(), users: people(), group_members: [member('owner-1', G1, 'admin'), member('user-2', G1, 'member', '2026-09-01T00:00:00Z')] });

    const res = await my(mintToken({ user_id: 'user-2', group_id: G1 }));

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain(INVITE);
    expect(res.body.data).toBeUndefined();
  });

  it('answers 404 when the active membership is in another group than the token names', async () => {
    use({ groups: groups(), users: people(), group_members: [member('user-2', G2, 'member')] });

    const res = await my(mintToken({ user_id: 'user-2', group_id: G1 }));

    expect(res.status).toBe(404);
  });

  it('answers 500 with a generic body when the membership cannot be read', async () => {
    use({ groups: groups(), users: people(), group_members: [member('user-2', G1, 'member')] }, {
      failWhen: (q) => (q.table === 'group_members' ? { message: 'relation "group_members" is broken for user-2', code: '42P01' } : null),
    });

    const res = await my(mintToken({ user_id: 'user-2', group_id: G1 }));

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
    expect(JSON.stringify(res.body)).not.toContain('broken');
    expect(logged.join('\n')).toContain('42P01');
  });
});

describe('POST /api/auth/users', () => {
  const adminToken = () => mintToken({ user_id: 'admin-1', group_id: G1 });
  const create = () => server.request('POST', '/api/auth/users', { token: adminToken(), body: { name: 'Newbie', email: 'newbie@example.com', password: 'secret123' } });
  const base = (): Record<string, Row[]> => ({
    groups: groups(),
    users: [{ id: 'admin-1', name: 'Admin', email: 'admin@example.com', is_admin: true, group_id: G1 }],
    group_members: [member('admin-1', G1, 'admin')],
  });

  it('puts the new user in the admin\'s group through join_group as a member', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-30T22:30:00Z'));
    const { tables, calls } = use(base());

    const res = await server.request('POST', '/api/auth/users', { token: adminToken(), body: { name: 'Newbie', email: 'newbie@example.com', password: 'secret123' } });

    expect(res.status).toBe(200);
    const created = tables.users.find((u) => u.email === 'newbie@example.com')!;
    expect(calls).toEqual([{ name: 'join_group', args: { p_user_id: created.id, p_group_id: G1, p_role: 'member', p_today: '2026-07-01' } }]);
    expect(tables.group_members.find((m) => m.user_id === created.id)).toMatchObject({ group_id: G1, role: 'member', starts_on: null, left_at: null });
    expect(created.group_id).toBe(G1);
  });

  it('rebuilds the ranking of the admin group after the join, without title news', async () => {
    const order: string[] = [];
    const { queries } = use({ ...base(), activity_log: [], title_leaderboard: [] }, { rpc: rebuildRpc(order) }, (name) => { order.push(name); });

    const res = await create();

    expect(res.status).toBe(200);
    expect(order).toEqual(['join_group', 'rebuild:' + G1]);
    expect(queries.filter((q) => q.table === 'activity_log' || q.table === 'title_leaderboard')).toEqual([]);
  });

  it('still answers 200 and logs only the code when the ranking rebuild fails', async () => {
    use(base(), { rpc: rebuildRpc([], { error: { code: '40P01', message: 'deadlock for newbie@example.com' } }) });

    const res = await create();

    expect(res.status).toBe(200);
    expect(logged.join('\n')).toContain('40P01');
    expect(logged.join('\n')).not.toContain('newbie@example.com');
  });

  it('does not rebuild any ranking when join_group fails', async () => {
    const order: string[] = [];
    use(base(), { rpc: { ...rebuildRpc(order), join_group: () => ({ error: { code: '40P01', message: 'deadlock' } }) } });

    const res = await create();

    expect(res.status).toBe(500);
    expect(order).toEqual([]);
  });

  it('does not set group_id itself when it creates the row', async () => {
    const seen: unknown[] = [];
    use(base(), {}, (name, args, state) => {
      if (name === 'join_group') seen.push(state.users.find((u) => u.id === args.p_user_id)?.group_id ?? null);
    });

    const res = await create();

    expect(res.status).toBe(200);
    expect(seen).toEqual([null]);
  });

  it('removes the new user again and answers 500 when join_group fails, so no account is left without a group', async () => {
    const { tables } = use(base(), {
      rpc: { join_group: () => ({ error: { code: '40P01', message: 'deadlock detected for newbie@example.com' } }) },
    });

    const res = await create();

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to create user' });
    expect(tables.users.map((u) => u.id)).toEqual(['admin-1']);
    expect(JSON.stringify(res.body)).not.toContain('newbie@example.com');
    expect(logged.join('\n')).toContain('40P01');
    expect(logged.join('\n')).not.toContain('newbie@example.com');
  });

  it('answers 500 with a generic body, logs both codes and leaves the group-less account when join_group and the removal both fail', async () => {
    const { tables } = use(base(), {
      rpc: { join_group: () => ({ error: { code: '40P01', message: 'deadlock detected for newbie@example.com' } }) },
      failWhen: (q) => (q.table === 'users' && q.mutation === 'delete' ? { code: '23503', message: 'delete failed for newbie@example.com', details: 'Key (id)=(secret-row) is still referenced' } : null),
    });

    const res = await create();

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to create user' });
    const out = logged.join('\n');
    expect(out).toContain('40P01');
    expect(out).toContain('23503');
    expect(out).not.toContain('newbie@example.com');
    expect(out).not.toContain('secret-row');
    expect(JSON.stringify(res.body)).not.toMatch(/newbie|secret-row|23503/);
    const orphan = tables.users.find((u) => u.email === 'newbie@example.com');
    expect(orphan).toBeDefined();
    expect(orphan!.group_id ?? null).toBeNull();
    expect(tables.group_members.some((m) => m.user_id === orphan!.id)).toBe(false);
  });
});
