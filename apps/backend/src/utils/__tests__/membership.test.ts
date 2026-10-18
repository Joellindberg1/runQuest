/**
 * Medlemskapslagret: de enda anropen av join_group och create_group_with_admin (ADR 012 beslut 2.2) och läsningen av det aktiva
 * medlemskapet. Databasen är fejkad; funktionernas SQLSTATE och meddelanden är de som migration 053 dokumenterar.
 */
import { describe, it, expect } from 'vitest';
import { createFakeDb, type FakeDbOptions, type Row } from '../../routes/__tests__/helpers/fakeDb.js';
import { membershipRpc, type MembershipRpcCall } from '../../routes/__tests__/helpers/fakeMembership.js';
import {
  MembershipError,
  classifyMembershipError,
  createGroupWithAdmin,
  getActiveMembership,
  joinGroup,
  type MembershipErrorKind,
} from '../membership.js';

const INVITE_SECRET = 'WOLFPACK-SECRET-7731';

function setup(tables: Record<string, Row[]>, rpcOverride: NonNullable<FakeDbOptions['rpc']> = {}) {
  const calls: MembershipRpcCall[] = [];
  const all = { users: [], groups: [], group_members: [], ...tables };
  const db = createFakeDb(all, { rpc: { ...membershipRpc(all, calls), ...rpcOverride } });
  return { db: db.client as any, queries: db.queries, calls, tables: all };
}

async function thrownBy(run: () => Promise<unknown>): Promise<MembershipError> {
  try {
    await run();
  } catch (error) {
    return error as MembershipError;
  }
  throw new Error('expected the call to throw');
}

describe('classifyMembershipError', () => {
  it.each<[string, { code?: string; message?: string }, MembershipErrorKind]>([
    ['the own already_member check', { code: '23505', message: 'join_group: already_member' }, 'already_member'],
    ['the own group_has_admin check', { code: '23505', message: 'join_group: group_has_admin' }, 'group_has_admin'],
    ['a race on the one-active-membership index', { code: '23505', message: 'duplicate key value violates unique constraint "group_members_one_active_per_user"' }, 'already_member'],
    ['a race on the one-admin index', { code: '23505', message: 'duplicate key value violates unique constraint "group_members_one_admin_per_group"' }, 'group_has_admin'],
    ['an invite code already in use', { code: '23505', message: 'duplicate key value violates unique constraint "groups_invite_code_key"' }, 'invite_code_taken'],
    ['a missing user', { code: 'P0002', message: 'join_group: user_not_found' }, 'not_found'],
    ['a missing group', { code: 'P0002', message: 'join_group: group_not_found' }, 'not_found'],
    ['a missing owner', { code: 'P0002', message: 'create_group_with_admin: owner_not_found' }, 'not_found'],
    ['an invalid role', { code: '22023', message: 'join_group: invalid_role' }, 'invalid_input'],
    ['a missing date', { code: '22004', message: 'join_group: today_required' }, 'invalid_input'],
    ['a unique violation on an unknown constraint', { code: '23505', message: 'duplicate key value violates unique constraint "something_else"' }, 'unavailable'],
    ['a dropped connection (empty code)', { code: '', message: 'TypeError: fetch failed' }, 'unavailable'],
    ['a deadlock', { code: '40P01', message: 'deadlock detected' }, 'unavailable'],
  ])('maps %s', (_name, error, kind) => {
    expect(classifyMembershipError(error)).toBe(kind);
  });

  it('does not let the message text decide when the code is not a unique violation', () => {
    expect(classifyMembershipError({ code: '42501', message: 'join_group: already_member' })).toBe('unavailable');
  });

  it('does not read the details, where a duplicate invite code is quoted', () => {
    const kind = classifyMembershipError({
      code: '23505',
      message: 'duplicate key value violates unique constraint "something_else"',
      details: 'Key (invite_code)=(group_has_admin) already exists.',
    });
    expect(kind).toBe('unavailable');
  });

  it('answers unavailable for a value that is not an error object', () => {
    expect(classifyMembershipError(null)).toBe('unavailable');
    expect(classifyMembershipError('boom')).toBe('unavailable');
  });
});

describe('joinGroup', () => {
  const tables = (): Record<string, Row[]> => ({ users: [{ id: 'u1', group_id: null }], groups: [{ id: 'g1', name: 'Wolfpack' }] });

  it('calls join_group with the user, the group, the role and the Stockholm day', async () => {
    const { db, calls } = setup(tables());
    await joinGroup({ userId: 'u1', groupId: 'g1', role: 'member', today: '2026-07-01' }, db);
    expect(calls).toEqual([{ name: 'join_group', args: { p_user_id: 'u1', p_group_id: 'g1', p_role: 'member', p_today: '2026-07-01' } }]);
  });

  it('reads the row also when the function answers with a one-element array', async () => {
    const row = { id: 'm1', user_id: 'u1', group_id: 'g1', role: 'member', starts_on: null, joined_at: '2026-10-18T10:00:00Z', left_at: null };
    const { db } = setup(tables(), { join_group: () => ({ data: [row] }) });
    expect(await joinGroup({ userId: 'u1', groupId: 'g1', role: 'member', today: '2026-07-01' }, db)).toEqual(row);
  });

  it('returns the membership row the function made', async () => {
    const { db } = setup(tables());
    const row = await joinGroup({ userId: 'u1', groupId: 'g1', role: 'member', today: '2026-07-01' }, db);
    expect(row).toMatchObject({ user_id: 'u1', group_id: 'g1', role: 'member', starts_on: null, left_at: null });
  });

  it('passes the day of today in Stockholm when the caller gives none', async () => {
    const { db, calls } = setup(tables());
    await joinGroup({ userId: 'u1', groupId: 'g1', role: 'member' }, db);
    expect(calls[0]!.args.p_today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('writes nothing but through the function', async () => {
    const { db, queries } = setup(tables());
    await joinGroup({ userId: 'u1', groupId: 'g1', role: 'member', today: '2026-07-01' }, db);
    expect(queries.filter((q) => q.mutation)).toEqual([]);
  });

  it.each<[string, Record<string, unknown>, MembershipErrorKind]>([
    ['already a member', { users: [{ id: 'u1', group_id: 'g0' }], group_members: [{ id: 'm0', user_id: 'u1', group_id: 'g0', role: 'member', left_at: null }] }, 'already_member'],
    ['a missing user', { users: [] }, 'not_found'],
    ['a missing group', { groups: [] }, 'not_found'],
  ])('throws %s as a MembershipError of the right kind', async (_name, override, kind) => {
    const { db } = setup({ ...tables(), ...override } as Record<string, Row[]>);
    const error = await thrownBy(() => joinGroup({ userId: 'u1', groupId: 'g1', role: 'member', today: '2026-07-01' }, db));
    expect(error).toBeInstanceOf(MembershipError);
    expect(error.kind).toBe(kind);
  });

  it('throws group_has_admin when a second admin is asked for', async () => {
    const { db } = setup({
      ...tables(),
      group_members: [{ id: 'm0', user_id: 'other', group_id: 'g1', role: 'admin', left_at: null }],
    });
    const error = await thrownBy(() => joinGroup({ userId: 'u1', groupId: 'g1', role: 'admin', today: '2026-07-01' }, db));
    expect(error.kind).toBe('group_has_admin');
  });

  it('maps a race that arrives with the database own message and the constraint name', async () => {
    const { db } = setup(tables(), {
      join_group: () => ({ error: { code: '23505', message: 'duplicate key value violates unique constraint "group_members_one_active_per_user"', details: 'Key (user_id)=(u1) already exists.' } }),
    });
    const error = await thrownBy(() => joinGroup({ userId: 'u1', groupId: 'g1', role: 'member', today: '2026-07-01' }, db));
    expect(error.kind).toBe('already_member');
  });

  it('keeps the database text out of the error it throws and keeps only the code', async () => {
    const { db } = setup(tables(), {
      join_group: () => ({ error: { code: '23505', message: 'duplicate key value violates unique constraint "groups_invite_code_key"', details: `Key (invite_code)=(${INVITE_SECRET}) already exists.` } }),
    });
    const error = await thrownBy(() => joinGroup({ userId: 'u1', groupId: 'g1', role: 'member', today: '2026-07-01' }, db));
    const everything = `${error.message} ${error.stack} ${JSON.stringify(error)} ${Object.values(error).join(' ')}`;
    expect(everything).not.toContain(INVITE_SECRET);
    expect(everything).not.toContain('Key (');
    expect(error.code).toBe('23505');
  });

  it('throws unavailable with the network cause as its code when the connection breaks', async () => {
    const { db } = setup(tables(), {
      join_group: () => ({ error: { code: '', message: 'TypeError: fetch failed', details: 'Caused by: Error: read ECONNRESET (ECONNRESET)' } }),
    });
    const error = await thrownBy(() => joinGroup({ userId: 'u1', groupId: 'g1', role: 'member', today: '2026-07-01' }, db));
    expect(error.kind).toBe('unavailable');
    expect(error.code).toBe('ECONNRESET');
  });
});

describe('createGroupWithAdmin', () => {
  const tables = (): Record<string, Row[]> => ({ users: [{ id: 'owner', group_id: null }], groups: [{ id: 'g0', invite_code: 'TAKEN' }] });

  it('calls create_group_with_admin with the name, the invite code, the owner and the Stockholm day', async () => {
    const { db, calls } = setup(tables());
    await createGroupWithAdmin({ name: 'Pack', inviteCode: 'FRESH1', ownerId: 'owner', today: '2026-07-01' }, db);
    expect(calls).toEqual([{ name: 'create_group_with_admin', args: { p_name: 'Pack', p_invite_code: 'FRESH1', p_owner_id: 'owner', p_today: '2026-07-01' } }]);
  });

  it('reads the group also when the function answers with a one-element array', async () => {
    const group = { id: 'g9', name: 'Pack', invite_code: 'FRESH1', owner_id: 'owner', created_at: '2026-10-18T10:00:00Z' };
    const { db } = setup(tables(), { create_group_with_admin: () => ({ data: [group] }) });
    expect(await createGroupWithAdmin({ name: 'Pack', inviteCode: 'FRESH1', ownerId: 'owner', today: '2026-07-01' }, db)).toEqual(group);
  });

  it('returns the group, makes the owner admin and points the owner at the group', async () => {
    const { db, tables: state } = setup(tables());
    const group = await createGroupWithAdmin({ name: 'Pack', inviteCode: 'FRESH1', ownerId: 'owner', today: '2026-07-01' }, db);
    expect(group).toMatchObject({ name: 'Pack', invite_code: 'FRESH1', owner_id: 'owner' });
    expect(state.group_members).toMatchObject([{ user_id: 'owner', group_id: group.id, role: 'admin' }]);
    expect(state.users[0]!.group_id).toBe(group.id);
  });

  it('throws invite_code_taken without the code in the error', async () => {
    const { db } = setup(tables());
    const error = await thrownBy(() => createGroupWithAdmin({ name: 'Pack', inviteCode: 'TAKEN', ownerId: 'owner', today: '2026-07-01' }, db));
    expect(error.kind).toBe('invite_code_taken');
    expect(`${error.message} ${JSON.stringify(error)}`).not.toContain('TAKEN');
  });

  it('leaves no group behind when the owner already is a member', async () => {
    const { db, tables: state } = setup({
      ...tables(),
      group_members: [{ id: 'm0', user_id: 'owner', group_id: 'g0', role: 'member', left_at: null }],
    });
    const error = await thrownBy(() => createGroupWithAdmin({ name: 'Pack', inviteCode: 'FRESH1', ownerId: 'owner', today: '2026-07-01' }, db));
    expect(error.kind).toBe('already_member');
    expect(state.groups).toHaveLength(1);
  });
});

describe('getActiveMembership', () => {
  it('returns the group and the role of the active membership', async () => {
    const { db } = setup({ group_members: [{ id: 'm1', user_id: 'u1', group_id: 'g1', role: 'admin', left_at: null }] });
    expect(await getActiveMembership('u1', db)).toEqual({ group_id: 'g1', role: 'admin' });
  });

  it('ignores a membership that has been left', async () => {
    const { db } = setup({
      group_members: [
        { id: 'm1', user_id: 'u1', group_id: 'g1', role: 'admin', left_at: '2026-09-01T00:00:00Z' },
        { id: 'm2', user_id: 'u1', group_id: 'g2', role: 'member', left_at: null },
      ],
    });
    expect(await getActiveMembership('u1', db)).toEqual({ group_id: 'g2', role: 'member' });
  });

  it('returns null for a user without a membership', async () => {
    const { db } = setup({ group_members: [{ id: 'm1', user_id: 'someone-else', group_id: 'g1', role: 'member', left_at: null }] });
    expect(await getActiveMembership('u1', db)).toBeNull();
  });

  it('reads from the database for the user and writes nothing', async () => {
    const { db, queries } = setup({ group_members: [] });
    await getActiveMembership('u1', db);
    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatchObject({ table: 'group_members', filters: expect.arrayContaining([{ op: 'eq', column: 'user_id', value: 'u1' }, { op: 'is', column: 'left_at', value: null }]) });
    expect(queries[0]!.mutation).toBeUndefined();
  });

  it('throws unavailable with the database code when the read fails', async () => {
    const calls: MembershipRpcCall[] = [];
    const all = { users: [], groups: [], group_members: [] };
    const failing = createFakeDb(all, { rpc: membershipRpc(all, calls), failWhen: () => ({ message: 'row for u1 is broken', code: '42P01' }) });
    const error = await thrownBy(() => getActiveMembership('u1', failing.client as any));
    expect(error.kind).toBe('unavailable');
    expect(error.code).toBe('42P01');
    expect(`${error.message} ${JSON.stringify(error)}`).not.toContain('row for u1');
  });

  it('refuses a role the database should never hold, instead of guessing', async () => {
    const { db } = setup({ group_members: [{ id: 'm1', user_id: 'u1', group_id: 'g1', role: 'emperor', left_at: null }] });
    const error = await thrownBy(() => getActiveMembership('u1', db));
    expect(error.kind).toBe('unavailable');
  });
});
