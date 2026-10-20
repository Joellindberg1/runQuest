// 👥 Group Routes
import { logger } from '../utils/logger.js';
import express from 'express';
import { getSupabaseClient } from '../config/database.js';
import { authenticateJWT } from '../middleware/auth.js';
import { errorCode } from '../utils/errorCode.js';
import { MembershipError, getActiveMembership, joinGroup } from '../utils/membership.js';
import { rebuildGroupRankingAfterJoin } from '../services/groupRanking.js';
import type { JoinGroupRequest, JoinGroupResponse, MyGroupResponse } from '@runquest/shared';
import { fail, ok, okWithLegacy } from '../utils/respond.js';
import { tokenGroupId } from '../utils/groupScope.js';

const router = express.Router();

// GET /api/groups/my - Get the current user's group info
router.get('/my', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const userId = req.user!.user_id;
    // Tom grupp i token: 404 här (inte tom data), för "min grupp" finns inte; klienten läser det som "inte med i någon grupp".
    const groupId = tokenGroupId(req);

    if (!groupId) {
      fail(res, 404, 'You are not a member of any group'); return;
    }

    logger.info(`👥 Fetching group info for user ${userId}, group ${groupId}`);

    // Rollen och medlemskapet läses färskt ur group_members, aldrig ur token. Utan ett aktivt medlemskap i just den här gruppen
    // lämnas ingen gruppdata ut (fail-closed), även om token säger att användaren är med.
    let membership;
    try {
      membership = await getActiveMembership(userId);
    } catch (error) {
      logger.error(`❌ Error fetching membership (${errorCode(error)})`);
      fail(res, 500, 'Internal server error'); return;
    }
    if (!membership || membership.group_id !== groupId) {
      fail(res, 404, 'You are not a member of any group'); return;
    }

    const supabase = getSupabaseClient();

    const { data: group, error: groupError } = await supabase
      .from('groups')
      .select('id, name, invite_code, owner_id, created_at')
      .eq('id', groupId)
      .single();

    if (groupError || !group) {
      logger.error(`❌ Error fetching group (${errorCode(groupError)})`);
      fail(res, 404, 'Group not found'); return;
    }

    const { data: members, error: membersError } = await supabase
      .from('users')
      .select('id, name, total_xp, current_level, profile_picture, challenge_active')
      .eq('group_id', groupId)
      .order('total_xp', { ascending: false });

    if (membersError) {
      logger.error(`❌ Error fetching group members (${errorCode(membersError)})`);
      fail(res, 500, 'Failed to fetch group members'); return;
    }

    const isOwner = group.owner_id === userId;

    logger.info(`✅ Fetched group ${group.id} with ${members?.length || 0} members`);

    ok<MyGroupResponse>(res, {
      id: group.id,
      name: group.name,
      invite_code: isOwner ? group.invite_code : undefined,
      is_owner: isOwner,
      my_role: membership.role,
      member_count: members?.length || 0,
      members: members || [],
      created_at: group.created_at
    });

  } catch (error) {
    logger.error(`❌ Error fetching group (${errorCode(error)})`);
    fail(res, 500, 'Internal server error'); return;
  }
});

// POST /api/groups/join - Join a group via invite_code
router.post('/join', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const userId = req.user!.user_id;
    const { invite_code }: Partial<JoinGroupRequest> = req.body ?? {};

    if (typeof invite_code !== 'string' || invite_code.trim() === '') {
      fail(res, 400, 'invite_code is required'); return;
    }

    // Invite-koden är en hemlighet som ger tillträde till gruppen: aldrig i loggen.
    logger.info(`👥 User ${userId} attempting to join a group with an invite code`);

    const supabase = getSupabaseClient();

    // Find the group by invite code
    const { data: group, error: groupError } = await supabase
      .from('groups')
      .select('id, name')
      .eq('invite_code', invite_code.toUpperCase())
      .single();

    if (groupError || !group) {
      fail(res, 404, 'Invalid invite code', 'invalid_invite_code'); return;
    }

    // Medlemskapet och pekaren users.group_id skrivs av join_group i en transaktion. Ett aktivt medlemskap ger 409: man flyttas inte tyst.
    try {
      await joinGroup({ userId, groupId: group.id, role: 'member' }, supabase);
    } catch (error) {
      if (error instanceof MembershipError && error.kind === 'already_member') {
        logger.info(`👥 User ${userId} already has an active membership`);
        fail(res, 409, 'You are already a member of a group', 'already_in_group'); return;
      }
      if (error instanceof MembershipError && error.kind === 'not_found') {
        fail(res, 404, 'Group or user not found'); return;
      }
      logger.error(`❌ Error joining group (${errorCode(error)})`);
      fail(res, 500, 'Failed to join group'); return;
    }

    // Gruppens ranking byggs om efter en lyckad join (ADR 012 beslut 2.4), utan titelnyheter. Ett fel fäller inte joinen: medlemskapet är redan sparat.
    await rebuildGroupRankingAfterJoin(group.id, supabase);
    logger.info(`✅ User ${userId} joined group ${group.id}`);

    const joined = { id: group.id, name: group.name };
    okWithLegacy<JoinGroupResponse>(res, { group: joined }, { message: `Successfully joined group "${group.name}"`, group: joined });

  } catch (error) {
    logger.error(`❌ Error joining group (${errorCode(error)})`);
    fail(res, 500, 'Internal server error'); return;
  }
});

export default router;
