// 🏆 Challenge Routes
import { logger } from '../utils/logger.js';
import express from 'express';
import { getSupabaseClient } from '../config/database.js';
import { authenticateJWT } from '../middleware/auth.js';
import {
  getProgressForChallenge,
  settleChallenge,
} from '../services/challengeService.js';

const router = express.Router();

// ─── GET /api/challenges/my ──────────────────────────────────────────────────
// Returns: tokens, sent_challenge, received_challenges, boosts, history, group_active
router.get('/my', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const userId = req.user!.user_id;
    const groupId = req.user!.group_id;
    const supabase = getSupabaseClient();

    const [tokensRes, activeChallengeRes, receivedRes, historyRes, boostsRes, groupActiveRes] = await Promise.all([
      // Unsent tokens — join reward for winner/loser delta display
      supabase
        .from('user_challenge_tokens')
        .select('id, tier, metric, duration_days, earned_at, reward_id, challenge_rewards(winner_delta, winner_duration, winner_type, loser_delta, loser_duration, loser_type)')
        .eq('user_id', userId)
        .is('sent_at', null)
        .order('earned_at', { ascending: false }),

      // Active or pending challenge where user is challenger
      supabase
        .from('challenges')
        .select('*')
        .eq('challenger_id', userId)
        .in('status', ['pending', 'active'])
        .maybeSingle(),

      // Pending challenges where user is opponent (received)
      supabase
        .from('challenges')
        .select('*')
        .eq('opponent_id', userId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false }),

      // Completed history (both sides)
      supabase
        .from('challenges')
        .select('*')
        .or(`challenger_id.eq.${userId},opponent_id.eq.${userId}`)
        .in('status', ['completed'])
        .order('created_at', { ascending: false })
        .limit(20),

      // Active boosts
      supabase
        .from('user_boosts')
        .select('id, challenge_id, outcome, type, delta, remaining, expires_at, created_at')
        .eq('user_id', userId),

      // All active challenges in the group (for Ongoing tab)
      groupId
        ? supabase.from('challenges').select('*').eq('group_id', groupId).eq('status', 'active')
        : Promise.resolve({ data: [] }),
    ]);

    // Flatten reward data into token objects
    const tokens = (tokensRes.data ?? []).map((t: any) => {
      const r = t.challenge_rewards ?? {};
      return {
        id: t.id,
        tier: t.tier,
        metric: t.metric,
        duration_days: t.duration_days,
        earned_at: t.earned_at,
        reward_id: t.reward_id,
        winner_delta: parseFloat(r.winner_delta ?? 0),
        winner_duration: r.winner_duration ?? 0,
        winner_type: r.winner_type ?? '',
        loser_delta: parseFloat(r.loser_delta ?? 0),
        loser_duration: r.loser_duration ?? 0,
        loser_type: r.loser_type ?? '',
      };
    });

    res.json({
      success: true,
      data: {
        tokens,
        sent_challenge: activeChallengeRes.data ?? null,
        received_challenges: receivedRes.data ?? [],
        boosts: boostsRes.data ?? [],
        history: historyRes.data ?? [],
        group_active: groupActiveRes.data ?? [],
      },
    });
  } catch (err) {
    logger.error('❌ Error fetching challenges:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/challenges/send ───────────────────────────────────────────────
// Body: { token_id, opponent_id }
router.post('/send', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const userId = req.user!.user_id;
    const groupId = req.user!.group_id;
    const { token_id, opponent_id } = req.body;

    if (!token_id || !opponent_id) {
      res.status(400).json({ error: 'token_id and opponent_id are required' }); return;
    }
    if (opponent_id === userId) {
      res.status(400).json({ error: 'You cannot challenge yourself' }); return;
    }

    const supabase = getSupabaseClient();

    // Fetch token, challenger, and opponent in parallel
    const [tokenRes, challengerRes, opponentRes] = await Promise.all([
      supabase
        .from('user_challenge_tokens')
        .select('id, user_id, tier, metric, duration_days, metric_id, duration_id, reward_id, sent_at')
        .eq('id', token_id)
        .single(),
      supabase
        .from('users')
        .select('id, current_level, group_id')
        .eq('id', userId)
        .single(),
      supabase
        .from('users')
        .select('id, current_level, group_id')
        .eq('id', opponent_id)
        .single(),
    ]);

    const token = tokenRes.data;
    const challenger = challengerRes.data;
    const opponent = opponentRes.data;

    if (!token || token.user_id !== userId) {
      res.status(403).json({ error: 'Token not found or does not belong to you' }); return;
    }
    if (token.sent_at !== null) {
      res.status(400).json({ error: 'Token has already been sent' }); return;
    }
    if (!challenger) {
      res.status(404).json({ error: 'Challenger not found' }); return;
    }
    if (!opponent) {
      res.status(404).json({ error: 'Opponent not found' }); return;
    }
    if (groupId && opponent.group_id !== groupId) {
      res.status(400).json({ error: 'Opponent is not in your group' }); return;
    }

    // Check for existing pending or active challenges for either party
    const { data: existingChallenges } = await supabase
      .from('challenges')
      .select('id, challenger_id, opponent_id')
      .in('status', ['pending', 'active'])
      .or(`challenger_id.eq.${userId},opponent_id.eq.${userId},challenger_id.eq.${opponent_id},opponent_id.eq.${opponent_id}`);

    const userBusy = existingChallenges?.some(
      c => c.challenger_id === userId || c.opponent_id === userId
    );
    const opponentBusy = existingChallenges?.some(
      c => c.challenger_id === opponent_id || c.opponent_id === opponent_id
    );

    if (userBusy) {
      res.status(400).json({ error: 'You already have an active or pending challenge' }); return;
    }
    if (opponentBusy) {
      res.status(400).json({ error: 'Opponent already has an active or pending challenge' }); return;
    }

    // Fetch reward details
    const { data: reward } = await supabase
      .from('challenge_rewards')
      .select('winner_type, winner_delta, winner_duration, loser_type, loser_delta, loser_duration')
      .eq('id', token.reward_id)
      .single();

    if (!reward) {
      res.status(500).json({ error: 'Failed to fetch reward config' }); return;
    }

    const sentAt = new Date().toISOString();
    const legendarySentAt = token.tier === 'legendary' ? sentAt : null;

    // Create challenge
    const { data: challenge, error: challengeError } = await supabase
      .from('challenges')
      .insert({
        group_id: groupId ?? opponent.group_id,
        tier: token.tier,
        challenger_id: userId,
        opponent_id,
        metric: token.metric,
        duration_days: token.duration_days,
        winner_type: reward.winner_type,
        winner_delta: reward.winner_delta,
        winner_duration: reward.winner_duration,
        loser_type: reward.loser_type,
        loser_delta: reward.loser_delta,
        loser_duration: reward.loser_duration,
        challenger_level: challenger.current_level,
        opponent_level: opponent.current_level,
        legendary_sent_at: legendarySentAt,
      })
      .select('id')
      .single();

    if (challengeError || !challenge) {
      logger.error('❌ Failed to create challenge:', challengeError);
      res.status(500).json({ error: 'Failed to create challenge' }); return;
    }

    // Mark token as sent + link to challenge
    await supabase
      .from('user_challenge_tokens')
      .update({ sent_at: sentAt, challenge_id: challenge.id })
      .eq('id', token_id);

    logger.info(`⚔️ Challenge sent: ${userId} → ${opponent_id} (${token.tier} / ${token.metric})`);

    res.status(201).json({ success: true, data: { challenge_id: challenge.id } });
  } catch (err) {
    logger.error('❌ Error sending challenge:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /api/challenges/:id/respond ────────────────────────────────────────
// Body: { action: 'accept' | 'decline' }
router.put('/:id/respond', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const userId = req.user!.user_id;
    const { id } = req.params;
    const { action } = req.body;

    if (!['accept', 'decline'].includes(action)) {
      res.status(400).json({ error: 'action must be "accept" or "decline"' }); return;
    }

    const supabase = getSupabaseClient();

    const { data: challenge, error } = await supabase
      .from('challenges')
      .select('*')
      .eq('id', id)
      .eq('opponent_id', userId)
      .eq('status', 'pending')
      .single();

    if (error || !challenge) {
      res.status(404).json({ error: 'Challenge not found or already responded' }); return;
    }

    if (action === 'decline') {
      if (challenge.tier === 'legendary') {
        res.status(400).json({ error: 'Legendary challenges cannot be declined' }); return;
      }

      // Restore token and reset challenge_active before deleting (FK order)
      await Promise.all([
        supabase
          .from('user_challenge_tokens')
          .update({ sent_at: null, challenge_id: null })
          .eq('challenge_id', id),
        supabase
          .from('users')
          .update({ challenge_active: false })
          .in('id', [challenge.challenger_id, challenge.opponent_id]),
      ]);
      await supabase.from('challenges').delete().eq('id', id);

      logger.info(`❌ Challenge ${id} declined by ${userId} — token restored to challenger`);
      res.json({ success: true, message: 'Challenge declined' }); return;
    }

    // Accept: activate challenge — starts tomorrow so neither party can time their acceptance
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const startDate = tomorrow.toISOString().split('T')[0];
    const endDate = new Date(tomorrow.getTime() + challenge.duration_days * 86400000)
      .toISOString()
      .split('T')[0];
    const determineAt = new Date(tomorrow.getTime() + (challenge.duration_days + 1) * 86400000).toISOString();

    await Promise.all([
      supabase
        .from('challenges')
        .update({ status: 'active', start_date: startDate, end_date: endDate, determine_at: determineAt })
        .eq('id', id),
      supabase
        .from('users')
        .update({ challenge_active: true })
        .in('id', [challenge.challenger_id, challenge.opponent_id]),
    ]);

    logger.info(`✅ Challenge ${id} accepted. Runs ${startDate} → ${endDate}`);

    res.json({ success: true, message: 'Challenge accepted', data: { start_date: startDate, end_date: endDate } });
  } catch (err) {
    logger.error('❌ Error responding to challenge:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/challenges/:id/progress ───────────────────────────────────────
router.get('/:id/progress', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const { id } = req.params;
    const supabase = getSupabaseClient();

    // Verify user is part of this challenge
    const { data: challenge } = await supabase
      .from('challenges')
      .select('challenger_id, opponent_id, status, metric, start_date, end_date, determine_at')
      .eq('id', id)
      .single();

    if (!challenge) {
      res.status(404).json({ error: 'Challenge not found' }); return;
    }

    // Auto-settle if past determine_at
    if (
      challenge.status === 'active' &&
      challenge.determine_at &&
      new Date(challenge.determine_at) <= new Date()
    ) {
      await settleChallenge(id);
    }

    const progress = await getProgressForChallenge(id);

    res.json({
      success: true,
      data: {
        challenge_id: id,
        metric: challenge.metric,
        start_date: challenge.start_date,
        end_date: challenge.end_date,
        progress: progress ?? [],
      },
    });
  } catch (err) {
    logger.error('❌ Error fetching challenge progress:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/challenges/group-stats ────────────────────────────────────────
// W/D/L leaderboard for all users in the group
router.get('/group-stats', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const groupId = req.user!.group_id;
    const supabase = getSupabaseClient();

    let query = supabase
      .from('users')
      .select('id, name, wins, draws, losses, challenge_active, current_level, profile_picture');

    if (groupId) {
      query = query.eq('group_id', groupId);
    }

    const { data: users, error } = await query.order('wins', { ascending: false });

    if (error) {
      logger.error('❌ Error fetching group stats:', error);
      res.status(500).json({ error: 'Failed to fetch group stats' }); return;
    }

    const stats = (users ?? []).map((u: any) => {
      const total = u.wins + u.draws + u.losses;
      const points = total > 0 ? (u.wins + u.draws * 0.5) / total : 0;
      return {
        user_id: u.id,
        name: u.name,
        wins: u.wins,
        draws: u.draws,
        losses: u.losses,
        total,
        points: Math.round(points * 1000) / 1000,
        challenge_active: u.challenge_active,
        current_level: u.current_level,
        profile_picture: u.profile_picture ?? null,
      };
    });

    // Sort by points desc, then wins desc
    stats.sort((a: any, b: any) => b.points - a.points || b.wins - a.wins);

    res.json({ success: true, data: stats });
  } catch (err) {
    logger.error('❌ Error fetching group stats:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
