// 🏆 Challenge Service — business logic
import { getSupabaseClient } from '../config/database.js';
import { logger } from '../utils/logger.js';

// ─── Boosts ──────────────────────────────────────────────────────────────────

/** Returns sum of active boost deltas for a user (additive to streak multiplier). */
export async function getActiveBoostDelta(userId: string): Promise<number> {
  const supabase = getSupabaseClient();
  const now = new Date().toISOString();

  const { data: boosts } = await supabase
    .from('user_boosts')
    .select('type, delta, remaining, expires_at')
    .eq('user_id', userId);

  if (!boosts?.length) return 0;

  return boosts.reduce((sum: number, boost: any) => {
    if (boost.type === 'multiplier_days' && boost.expires_at && boost.expires_at > now) {
      return sum + Number(boost.delta);
    }
    if (boost.type === 'multiplier_runs' && boost.remaining > 0) {
      return sum + Number(boost.delta);
    }
    return sum;
  }, 0);
}

/** Decrement remaining count on run-based boosts after a run is logged. */
export async function decrementRunBoosts(userId: string): Promise<void> {
  const supabase = getSupabaseClient();

  const { data: boosts } = await supabase
    .from('user_boosts')
    .select('id, remaining')
    .eq('user_id', userId)
    .eq('type', 'multiplier_runs')
    .gt('remaining', 0);

  if (!boosts?.length) return;

  await Promise.all(
    boosts.map((b: any) =>
      supabase.from('user_boosts').update({ remaining: b.remaining - 1 }).eq('id', b.id)
    )
  );
}

// ─── Token reconciliation on level change ────────────────────────────────────

/**
 * Reconcile challenge tokens for a user against their current level.
 *
 * Uses `highest_rewarded_level` on the users table to determine which
 * levels have already been processed — this prevents retroactive token
 * bursts for existing users and correctly handles level regression.
 *
 * - Level up  (newLevel > highest): awards tokens for newly reached levels,
 *   then bumps highest_rewarded_level.
 * - Level down (newLevel < highest): removes UNSENT tokens for levels now
 *   above newLevel, then lowers highest_rewarded_level.
 * - No change (newLevel === highest): no-op.
 *
 * Sent tokens (linked to an active/pending challenge) are never removed.
 * Called from calculateUserTotals on every run add / update / delete.
 */
export async function reconcileTokensForLevel(
  userId: string,
  newLevel: number
): Promise<void> {
  const supabase = getSupabaseClient();

  const { data: user } = await supabase
    .from('users')
    .select('highest_rewarded_level')
    .eq('id', userId)
    .single();

  const highestRewarded: number = user?.highest_rewarded_level ?? 0;

  if (newLevel > highestRewarded) {
    // ── Level up: award tokens for newly reached levels ──────────────────
    const { data: levelRewards } = await supabase
      .from('level_challenge_rewards')
      .select('level, tier')
      .gt('level', highestRewarded)
      .lte('level', newLevel);

    for (const reward of levelRewards ?? []) {
      await awardTokenForLevel(userId, reward.level, reward.tier);
    }

    // Update after all inserts succeed (throw above keeps this unreached on failure)
    await supabase
      .from('users')
      .update({ highest_rewarded_level: newLevel })
      .eq('id', userId);

    if ((levelRewards ?? []).length > 0) {
      logger.info(`⬆️ User ${userId} rewarded through level ${newLevel}`);
    }

  } else if (newLevel < highestRewarded) {
    // ── Level regression: remove unsent tokens for lost levels ───────────
    const { data: orphaned } = await supabase
      .from('user_challenge_tokens')
      .select('id')
      .eq('user_id', userId)
      .gt('earned_at_level', newLevel)
      .is('sent_at', null);

    if (orphaned?.length) {
      const { error } = await supabase
        .from('user_challenge_tokens')
        .delete()
        .in('id', (orphaned as any[]).map((t) => t.id));
      if (error) {
        logger.error('❌ Failed to remove orphaned tokens:', error);
      } else {
        logger.info(`🗑️ Removed ${orphaned.length} orphaned token(s) for user ${userId} (regression to level ${newLevel})`);
      }
    }

    await supabase
      .from('users')
      .update({ highest_rewarded_level: newLevel })
      .eq('id', userId);
  }
  // newLevel === highestRewarded → nothing to do
}

/** Insert a single challenge token for a given level/tier. Idempotent — skips if one already exists. */
async function awardTokenForLevel(userId: string, level: number, tier: string): Promise<void> {
  const supabase = getSupabaseClient();

  // Guard against duplicate inserts (e.g. if highest_rewarded_level update failed previously)
  const { data: existing } = await supabase
    .from('user_challenge_tokens')
    .select('id')
    .eq('user_id', userId)
    .eq('earned_at_level', level)
    .maybeSingle();

  if (existing) {
    logger.info(`ℹ️ Token for level ${level} already exists for user ${userId}, skipping`);
    return;
  }

  const [metricsRes, durationsRes, rewardsRes] = await Promise.all([
    supabase.from('challenge_metrics').select('id, metric').contains('tier_eligibility', [tier]).eq('active', true),
    supabase.from('challenge_durations').select('id, duration_days').contains('tier_eligibility', [tier]).eq('active', true),
    supabase.from('challenge_rewards').select('id').contains('tier_eligibility', [tier]).eq('active', true),
  ]);

  const metrics = (metricsRes.data ?? []) as { id: string; metric: string }[];
  const durations = (durationsRes.data ?? []) as { id: string; duration_days: number }[];
  const challengeRewards = (rewardsRes.data ?? []) as { id: string }[];

  if (!metrics.length || !durations.length || !challengeRewards.length) {
    logger.warn(`⚠️ No config found for tier "${tier}" at level ${level}`);
    return;
  }

  const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
  const metric = pick(metrics);
  const duration = pick(durations);
  const reward = pick(challengeRewards);

  const { error } = await supabase.from('user_challenge_tokens').insert({
    user_id: userId,
    metric_id: metric.id,
    duration_id: duration.id,
    reward_id: reward.id,
    tier,
    metric: metric.metric,
    duration_days: duration.duration_days,
    earned_at_level: level,
  });

  if (error) {
    logger.error(`❌ Failed to award ${tier} token at level ${level}:`, error);
    throw new Error(`Failed to award ${tier} token at level ${level}: ${error.message}`);
  }

  logger.info(`🎁 Awarded ${tier} token to user ${userId} at level ${level}`);
}

// ─── Progress ────────────────────────────────────────────────────────────────

export interface ProgressEntry {
  user_id: string;
  value: number;
}

/**
 * Calculate progress (metric sum) for both users in a challenge.
 * Returns null if the challenge is not active or lacks start_date.
 */
export async function getProgressForChallenge(challengeId: string): Promise<ProgressEntry[] | null> {
  const supabase = getSupabaseClient();

  const { data: challenge, error } = await supabase
    .from('challenges')
    .select('challenger_id, opponent_id, metric, start_date, end_date, status')
    .eq('id', challengeId)
    .single();

  if (error || !challenge || !challenge.start_date) return null;

  const startDate = challenge.start_date;
  const endDate = challenge.end_date ?? new Date().toISOString().split('T')[0];

  const fetchValue = async (userId: string): Promise<number> => {
    if (challenge.metric === 'runs') {
      const { count } = await supabase
        .from('runs')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('date', startDate)
        .lte('date', endDate);
      return count ?? 0;
    }

    const col = challenge.metric === 'km' ? 'distance' : 'xp_gained';
    const { data } = await supabase
      .from('runs')
      .select(col)
      .eq('user_id', userId)
      .gte('date', startDate)
      .lte('date', endDate);

    return (data ?? []).reduce((sum: number, r: any) => sum + (Number(r[col]) || 0), 0);
  };

  const [challengerValue, opponentValue] = await Promise.all([
    fetchValue(challenge.challenger_id),
    fetchValue(challenge.opponent_id),
  ]);

  return [
    { user_id: challenge.challenger_id, value: challengerValue },
    { user_id: challenge.opponent_id, value: opponentValue },
  ];
}

// ─── Settle challenge ────────────────────────────────────────────────────────

/**
 * Determine winner, create boosts, update W/D/L, mark challenge completed.
 * Safe to call multiple times — checks status = 'active' first.
 */
export async function settleChallenge(challengeId: string): Promise<void> {
  const supabase = getSupabaseClient();

  const { data: challenge, error } = await supabase
    .from('challenges')
    .select('*')
    .eq('id', challengeId)
    .single();

  if (error || !challenge || challenge.status !== 'active') return;

  const progress = await getProgressForChallenge(challengeId);
  if (!progress) {
    logger.warn(`⚠️ Could not get progress for challenge ${challengeId}`);
    return;
  }

  const [c, o] = progress;
  let winnerId: string | null = null;
  let loserId: string | null = null;
  let outcome: 'challenger_wins' | 'opponent_wins' | 'draw' = 'draw';

  if (c.value > o.value) {
    winnerId = challenge.challenger_id;
    loserId = challenge.opponent_id;
    outcome = 'challenger_wins';
  } else if (o.value > c.value) {
    winnerId = challenge.opponent_id;
    loserId = challenge.challenger_id;
    outcome = 'opponent_wins';
  }

  logger.info(`🏁 Settling challenge ${challengeId}: ${outcome} (${c.value} vs ${o.value})`);

  // 1. Update challenge record
  await supabase
    .from('challenges')
    .update({ status: 'completed', winner_id: winnerId, outcome, challenger_final_value: c.value, opponent_final_value: o.value })
    .eq('id', challengeId);

  // 2. Reset challenge_active for both users
  await supabase
    .from('users')
    .update({ challenge_active: false })
    .in('id', [challenge.challenger_id, challenge.opponent_id]);

  // 3. Update W/D/L
  const { data: users } = await supabase
    .from('users')
    .select('id, wins, draws, losses')
    .in('id', [challenge.challenger_id, challenge.opponent_id]);

  if (users) {
    await Promise.all(
      users.map((user: any) => {
        let update: Record<string, number>;
        if (outcome === 'draw') {
          update = { draws: user.draws + 1 };
        } else if (user.id === winnerId) {
          update = { wins: user.wins + 1 };
        } else {
          update = { losses: user.losses + 1 };
        }
        return supabase.from('users').update(update).eq('id', user.id);
      })
    );
  }

  if (outcome === 'draw') {
    logger.info(`🤝 Challenge ${challengeId} ended in a draw`);
    return;
  }

  // 4. Create boosts
  const now = new Date();

  const winnerBoost = {
    user_id: winnerId!,
    challenge_id: challengeId,
    outcome: 'winner',
    type: challenge.winner_type,
    delta: Number(challenge.winner_delta),
    remaining: challenge.winner_type === 'multiplier_runs' ? challenge.winner_duration : null,
    expires_at: challenge.winner_type === 'multiplier_days'
      ? new Date(now.getTime() + challenge.winner_duration * 86400000).toISOString()
      : null,
  };

  const loserBoost = {
    user_id: loserId!,
    challenge_id: challengeId,
    outcome: 'loser',
    type: challenge.loser_type,
    delta: Number(challenge.loser_delta), // negative
    remaining: challenge.loser_type === 'multiplier_runs' ? challenge.loser_duration : null,
    expires_at: challenge.loser_type === 'multiplier_days'
      ? new Date(now.getTime() + challenge.loser_duration * 86400000).toISOString()
      : null,
  };

  await supabase.from('user_boosts').insert([winnerBoost, loserBoost]);

  logger.info(`✅ Challenge ${challengeId} settled. Winner: ${winnerId}, boosts created.`);
}
