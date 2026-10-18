// GET /api/groups/my och POST /api/groups/join (ADR 012 beslut 2.4, 2.5 och 8, ADR 007 A). Endast typer.
// `my_role` är användarens roll i sitt aktiva medlemskap, läst ur databasen (group_members) vid varje anrop, aldrig ur JWT.
import type { GroupRole } from '../groupRoles.js';
import type { ApiSuccess } from './common.js';

/** En medlem i listan över gruppens medlemmar (sorterad på total_xp, fallande). */
export interface GroupMemberSummary {
  id: string;
  name: string;
  total_xp: number;
  current_level: number;
  profile_picture?: string | null;
  challenge_active?: boolean;
}

export interface MyGroup {
  id: string;
  name: string;
  /** Bara för gruppens ägare (groups.owner_id); saknas för alla andra. */
  invite_code?: string;
  is_owner: boolean;
  /** Anroparens roll i gruppen: 'admin' (gruppens skapare) eller 'member'. */
  my_role: GroupRole;
  member_count: number;
  members: GroupMemberSummary[];
  created_at: string;
}

export type MyGroupResponse = ApiSuccess<MyGroup>;

export interface JoinGroupRequest {
  invite_code: string;
}

/**
 * Svar på POST /api/groups/join. 409 (`ApiError`) om användaren redan har ett aktivt medlemskap: man flyttas inte tyst mellan grupper,
 * och ett byte kräver säsongs-/RUN-95-arbetet (ADR 012 N3). Formen är oförändrad mot tidigare (`success`, `message`, `group`).
 */
export interface JoinGroupResponse {
  success: true;
  message: string;
  group: { id: string; name: string };
}
