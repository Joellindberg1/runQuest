// Medlemskapslagret (ADR 012 beslut 2.2): den enda koden som skapar ett medlemskap, och den enda som i praktiken skriver users.group_id.
// Pekaren users.group_id skrivs bara av databasfunktionerna join_group och create_group_with_admin (migration 053), i en transaktion med
// raden i group_members. Ingen annan kod skriver kolumnen; vakten checkUsersGroupIdWrites i scripts/ci-guards.mjs (regel 14) fäller bygget om någon gör det.
//
// Felhygien (ADR 010 beslut 8.6): databasens text lämnar aldrig det här lagret. Ett 23505 för groups_invite_code_key bär inbjudningskoden
// i sin DETAIL, så vi läser aldrig `details`, och felet vi kastar har ett fast meddelande och bara databasens kod (errorCode).
import type { SupabaseClient } from '@supabase/supabase-js';
import { GROUP_ROLES, type GroupRole } from '@runquest/shared';
import { getSupabaseClient } from '../config/database.js';
import { errorCode } from './errorCode.js';
import { todayStockholm } from './dateUtils.js';

export type MembershipErrorKind =
  | 'already_member'
  | 'group_has_admin'
  | 'invite_code_taken'
  | 'not_found'
  | 'invalid_input'
  | 'unavailable';

const MESSAGES: Record<MembershipErrorKind, string> = {
  already_member: 'The user already has an active membership',
  group_has_admin: 'The group already has an admin',
  invite_code_taken: 'The invite code is already in use',
  not_found: 'The user, group or owner does not exist',
  invalid_input: 'The membership request is invalid',
  unavailable: 'The membership could not be changed or read',
};

export class MembershipError extends Error {
  readonly kind: MembershipErrorKind;
  /** Databasens kod (eller nätverksorsakens) ur errorCode(); aldrig dess text. */
  readonly code: string;

  constructor(kind: MembershipErrorKind, source: unknown) {
    super(MESSAGES[kind]);
    this.name = 'MembershipError';
    this.kind = kind;
    this.code = errorCode(source);
  }
}

/**
 * Vad ett fel från join_group / create_group_with_admin betyder (migration 053, "Fel"):
 *   23505  already_member | group_has_admin | invite-kod som redan används   -> 409
 *   P0002  user_not_found | group_not_found | owner_not_found                -> 404
 *   22023  invalid_role | name_required | invite_code_required               -> 400
 *   22004  today_required | owner_required | user_and_group_required          -> 400
 * Vid ett race mellan två anrop kommer 23505 från indexet med Postgres eget meddelande, så 23505 mappas också på constraint-namnen
 * (group_members_one_active_per_user, group_members_one_admin_per_group, groups_invite_code_key). Bara `code` och `message` läses:
 * `details` för invite-koden innehåller själva koden.
 */
export function classifyMembershipError(error: unknown): MembershipErrorKind {
  const fields = (error && typeof error === 'object' ? error : {}) as { code?: unknown; message?: unknown };
  const code = typeof fields.code === 'string' ? fields.code : '';
  const message = typeof fields.message === 'string' ? fields.message : '';

  if (code === '23505') {
    if (message.includes('already_member') || message.includes('group_members_one_active_per_user')) return 'already_member';
    if (message.includes('group_has_admin') || message.includes('group_members_one_admin_per_group')) return 'group_has_admin';
    if (message.includes('groups_invite_code_key')) return 'invite_code_taken';
    return 'unavailable';
  }
  if (code === 'P0002') return 'not_found';
  if (code === '22023' || code === '22004') return 'invalid_input';
  return 'unavailable';
}

function failure(source: unknown): MembershipError {
  return new MembershipError(classifyMembershipError(source), source);
}

export interface GroupMembership {
  id: string;
  group_id: string;
  user_id: string;
  role: GroupRole;
  /** Stockholm-dag från vilken rundor räknas; null = hela historiken. */
  starts_on: string | null;
  joined_at: string;
  left_at: string | null;
}

export interface JoinGroupInput {
  userId: string;
  groupId: string;
  role: GroupRole;
  /** Stockholm-dagen (YYYY-MM-DD). Standard: idag i Stockholm ur calendar.ts; databasen räknar aldrig själv. */
  today?: string;
}

/** Ger användaren ett aktivt medlemskap och sätter pekaren users.group_id, i en transaktion. Kastar MembershipError. */
export async function joinGroup(input: JoinGroupInput, db: SupabaseClient = getSupabaseClient()): Promise<GroupMembership> {
  const { data, error } = await db.rpc('join_group', {
    p_user_id: input.userId,
    p_group_id: input.groupId,
    p_role: input.role,
    p_today: input.today ?? todayStockholm(),
  });
  if (error) throw failure(error);
  return (Array.isArray(data) ? data[0] : data) as GroupMembership;
}

export interface CreateGroupInput {
  name: string;
  inviteCode: string;
  ownerId: string;
  today?: string;
}

export interface CreatedGroup {
  id: string;
  name: string;
  invite_code: string;
  owner_id: string;
  created_at: string;
}

/** Skapar gruppen med ägaren som admin och sätter ägarens pekare, allt eller inget. Kastar MembershipError. */
export async function createGroupWithAdmin(input: CreateGroupInput, db: SupabaseClient = getSupabaseClient()): Promise<CreatedGroup> {
  const { data, error } = await db.rpc('create_group_with_admin', {
    p_name: input.name,
    p_invite_code: input.inviteCode,
    p_owner_id: input.ownerId,
    p_today: input.today ?? todayStockholm(),
  });
  if (error) throw failure(error);
  return (Array.isArray(data) ? data[0] : data) as CreatedGroup;
}

export interface ActiveMembership {
  group_id: string;
  role: GroupRole;
}

/**
 * Användarens aktiva medlemskap, läst färskt ur group_members (aldrig ur JWT), eller null om hen saknar ett. Kastar MembershipError
 * ('unavailable') vid databasfel eller en roll som inte finns i GROUP_ROLES: en okänd roll gissas aldrig.
 */
export async function getActiveMembership(userId: string, db: SupabaseClient = getSupabaseClient()): Promise<ActiveMembership | null> {
  const { data, error } = await db
    .from('group_members')
    .select('group_id, role')
    .eq('user_id', userId)
    .is('left_at', null)
    .maybeSingle();
  if (error) throw new MembershipError('unavailable', error);
  if (!data) return null;
  const row = data as { group_id: string; role: string };
  if (!(GROUP_ROLES as readonly string[]).includes(row.role)) throw new MembershipError('unavailable', { code: 'invalid_role' });
  return { group_id: row.group_id, role: row.role as GroupRole };
}
