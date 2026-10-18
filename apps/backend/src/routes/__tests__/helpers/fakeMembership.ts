/**
 * Fake av databasfunktionerna join_group och create_group_with_admin (migration 053) för route- och utilstester.
 * Speglar funktionernas kontroller, SQLSTATE och meddelanden i samma ordning som SQL:en, och skriver till samma tabeller
 * som funktionerna: group_members och users.group_id (pekaren). Därmed är join_group den enda skribenten till pekaren i testerna också.
 *
 * `calls` samlar varje anrop (namn + argument) så att ett test kan bevisa vilka argument koden skickade.
 */
import type { FakeDbOptions, Row } from './fakeDb.js';

type RpcResult = ReturnType<NonNullable<FakeDbOptions['rpc']>[string]>;

const fail = (code: string, message: string, details?: string): RpcResult => ({ error: { code, message, ...(details ? { details } : {}) } });

export interface MembershipRpcCall {
  name: 'join_group' | 'create_group_with_admin';
  args: Record<string, unknown>;
}

export function membershipRpc(tables: Record<string, Row[]>, calls: MembershipRpcCall[] = []): NonNullable<FakeDbOptions['rpc']> {
  let nextMembership = 1;
  tables.group_members ??= [];
  tables.groups ??= [];
  tables.users ??= [];

  function joinGroup(args: Record<string, any>): RpcResult {
    const { p_user_id: userId, p_group_id: groupId, p_role: role, p_today: today } = args;
    if (userId == null || groupId == null) return fail('22004', 'join_group: user_and_group_required');
    if (role == null || !['admin', 'member'].includes(role)) return fail('22023', 'join_group: invalid_role');
    const user = tables.users.find((u) => u.id === userId);
    if (!user) return fail('P0002', 'join_group: user_not_found');
    if (!tables.groups.some((g) => g.id === groupId)) return fail('P0002', 'join_group: group_not_found');
    const mine = tables.group_members.filter((m) => m.user_id === userId);
    if (mine.some((m) => m.left_at == null)) return fail('23505', 'join_group: already_member');
    if (role === 'admin' && tables.group_members.some((m) => m.group_id === groupId && m.role === 'admin' && m.left_at == null)) {
      return fail('23505', 'join_group: group_has_admin');
    }
    if (mine.length > 0 && today == null) return fail('22004', 'join_group: today_required');

    const row: Row = {
      id: `member-${nextMembership++}`,
      group_id: groupId,
      user_id: userId,
      role,
      starts_on: mine.length > 0 ? today : null,
      joined_at: '2026-10-18T10:00:00.000Z',
      left_at: null,
    };
    tables.group_members.push(row);
    user.group_id = groupId;
    return { data: { ...row } };
  }

  function createGroupWithAdmin(args: Record<string, any>): RpcResult {
    const { p_name: name, p_invite_code: code, p_owner_id: ownerId } = args;
    if (name == null || String(name).trim() === '') return fail('22023', 'create_group_with_admin: name_required');
    if (code == null || String(code).trim() === '') return fail('22023', 'create_group_with_admin: invite_code_required');
    if (ownerId == null) return fail('22004', 'create_group_with_admin: owner_required');
    if (!tables.users.some((u) => u.id === ownerId)) return fail('P0002', 'create_group_with_admin: owner_not_found');
    if (tables.groups.some((g) => g.invite_code === code)) {
      return fail('23505', 'duplicate key value violates unique constraint "groups_invite_code_key"', `Key (invite_code)=(${code}) already exists.`);
    }
    const group: Row = { id: `group-${tables.groups.length + 1}-new`, name, invite_code: code, owner_id: ownerId, created_at: '2026-10-18T10:00:00.000Z' };
    tables.groups.push(group);
    const joined = joinGroup({ p_user_id: ownerId, p_group_id: group.id, p_role: 'admin', p_today: args.p_today });
    if (joined.error) {
      tables.groups.splice(tables.groups.indexOf(group), 1); // allt eller inget, som i databasens transaktion
      return joined;
    }
    return { data: { ...group } };
  }

  return {
    join_group: (args) => { calls.push({ name: 'join_group', args }); return joinGroup(args); },
    create_group_with_admin: (args) => { calls.push({ name: 'create_group_with_admin', args }); return createGroupWithAdmin(args); },
  };
}
