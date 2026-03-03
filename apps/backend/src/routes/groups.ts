// 👥 Group Routes
import { logger } from '../utils/logger.js';
import express from 'express';
import { getSupabaseClient } from '../config/database.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = express.Router();

// GET /api/groups/my - Get the current user's group info
router.get('/my', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const userId = req.user!.user_id;
    const groupId = req.user!.group_id;

    if (!groupId) {
      res.status(404).json({ error: 'You are not a member of any group' }); return;
    }

    logger.info(`👥 Fetching group info for user ${userId}, group ${groupId}`);

    const supabase = getSupabaseClient();

    const { data: group, error: groupError } = await supabase
      .from('groups')
      .select('id, name, invite_code, owner_id, created_at')
      .eq('id', groupId)
      .single();

    if (groupError || !group) {
      logger.error('❌ Error fetching group:', groupError);
      res.status(404).json({ error: 'Group not found' }); return;
    }

    const { data: members, error: membersError } = await supabase
      .from('users')
      .select('id, name, total_xp, current_level, profile_picture, challenge_active')
      .eq('group_id', groupId)
      .order('total_xp', { ascending: false });

    if (membersError) {
      logger.error('❌ Error fetching group members:', membersError);
      res.status(500).json({ error: 'Failed to fetch group members' }); return;
    }

    const isOwner = group.owner_id === userId;

    logger.info(`✅ Fetched group "${group.name}" with ${members?.length || 0} members`);

    res.json({
      success: true,
      data: {
        id: group.id,
        name: group.name,
        invite_code: isOwner ? group.invite_code : undefined,
        is_owner: isOwner,
        member_count: members?.length || 0,
        members: members || [],
        created_at: group.created_at
      }
    });

  } catch (error) {
    logger.error('❌ Error fetching group:', error);
    res.status(500).json({ error: 'Internal server error' }); return;
  }
});

// POST /api/groups/join - Join a group via invite_code
router.post('/join', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const userId = req.user!.user_id;
    const { invite_code } = req.body;

    if (!invite_code) {
      res.status(400).json({ error: 'invite_code is required' }); return;
    }

    logger.info(`👥 User ${userId} attempting to join group with invite code: ${invite_code}`);

    const supabase = getSupabaseClient();

    // Find the group by invite code
    const { data: group, error: groupError } = await supabase
      .from('groups')
      .select('id, name')
      .eq('invite_code', invite_code.toUpperCase())
      .single();

    if (groupError || !group) {
      res.status(404).json({ error: 'Invalid invite code' }); return;
    }

    // Update user's group_id
    const { error: updateError } = await supabase
      .from('users')
      .update({ group_id: group.id })
      .eq('id', userId);

    if (updateError) {
      logger.error('❌ Error joining group:', updateError);
      res.status(500).json({ error: 'Failed to join group' }); return;
    }

    logger.info(`✅ User ${userId} joined group "${group.name}" (${group.id})`);

    res.json({
      success: true,
      message: `Successfully joined group "${group.name}"`,
      group: {
        id: group.id,
        name: group.name
      }
    });

  } catch (error) {
    logger.error('❌ Error joining group:', error);
    res.status(500).json({ error: 'Internal server error' }); return;
  }
});

export default router;
