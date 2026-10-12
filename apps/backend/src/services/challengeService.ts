// 🏆 Challenge Service — business logic
import { getSupabaseClient } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { recordChallengeSettled } from './activityLog.js';
import { MS_DAY } from '@runquest/shared';

// Boost-tillämpningen bor i @runquest/shared (boostDeltasForRuns) och anropas
// från reprocessRunsFromDate. multiplier_runs är statelös — `remaining` på
// user_boosts är boostens TOTALA antal laddningar och muteras aldrig;
// förbrukningen härleds ur löphistoriken så att omräkning förblir idempotent.

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

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to read challenge ${challengeId} for progress: ${error.message}`);
  }
  if (!challenge || !challenge.start_date) return null;

  const startDate = challenge.start_date;
  const endDate = challenge.end_date ?? new Date().toISOString().split('T')[0];

  const fetchValue = async (userId: string): Promise<number> => {
    // Läsfel kastas: ett fel som blev 0 skulle annars avgöra utmaningen på ofullständig data (0–0 = oavgjort).
    if (challenge.metric === 'runs') {
      const { count, error: countError } = await supabase
        .from('runs')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('date', startDate)
        .lte('date', endDate);
      if (countError) throw new Error(`Failed to read run count for challenge ${challengeId} (user ${userId}): ${countError.message}`);
      return count ?? 0;
    }

    const col = challenge.metric === 'km' ? 'distance' : 'xp_gained';
    const { data, error: runsError } = await supabase
      .from('runs')
      .select(col)
      .eq('user_id', userId)
      .gte('date', startDate)
      .lte('date', endDate);
    if (runsError) throw new Error(`Failed to read runs for challenge ${challengeId} (user ${userId}): ${runsError.message}`);

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

  // PGRST116 = utmaningen finns inte → inget att avgöra. Andra läsfel är inte "klart": de ska synas, och schedulern tar om.
  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to read challenge ${challengeId} for settling: ${error.message}`);
  }
  if (!challenge || challenge.status !== 'active') return;

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

  // 1. Claim: markera completed ENDAST om fortfarande active (bugg #6) —
  // vid överlappande instanser vinner exakt en, så W/D/L och boosts kan
  // aldrig delas ut dubbelt.
  const { data: claimed, error: claimError } = await supabase
    .from('challenges')
    .update({ status: 'completed', winner_id: winnerId, outcome, challenger_final_value: c.value, opponent_final_value: o.value })
    .eq('id', challengeId)
    .eq('status', 'active')
    .select('id');

  if (claimError) {
    // Ett fel är inte "redan avgjord": ingen annan instans har vunnit claimen, ingenting är skrivet, schedulern tar om.
    throw new Error(`Failed to claim challenge ${challengeId} for settling: ${claimError.message}`);
  }
  if (!claimed?.length) {
    logger.info(`↷ Challenge ${challengeId} already settled by another instance`);
    return;
  }

  // 2. Create boosts — FÖRST efter claimen, före allt annat som inte går att göra om. Misslyckas insertet släpps
  // claimen (utmaningen är active igen och schedulern avgör den om), och eftersom W/D/L och challenge_active
  // ännu inte rörts kan omförsöket inte dubbelräkna något. En draw ger inga boostar.
  if (outcome !== 'draw') {
    const now = new Date();

    const winnerBoost = {
      user_id: winnerId!,
      challenge_id: challengeId,
      outcome: 'winner',
      type: challenge.winner_type,
      delta: Number(challenge.winner_delta),
      remaining: challenge.winner_type === 'multiplier_runs' ? challenge.winner_duration : null,
      expires_at: challenge.winner_type === 'multiplier_days'
        ? new Date(now.getTime() + challenge.winner_duration * MS_DAY).toISOString()
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
        ? new Date(now.getTime() + challenge.loser_duration * MS_DAY).toISOString()
        : null,
    };

    const { error: boostError } = await supabase.from('user_boosts').insert([winnerBoost, loserBoost]);

    if (boostError) {
      logger.error(`❌ Boost insert failed for challenge ${challengeId}:`, boostError);
      const { error: releaseError } = await supabase
        .from('challenges')
        .update({ status: 'active', winner_id: null, outcome: null, challenger_final_value: null, opponent_final_value: null })
        .eq('id', challengeId)
        .eq('status', 'completed');
      if (releaseError) {
        // Fastlåst tillstånd: utmaningen är completed utan boostar och schedulern tar den aldrig igen. Spelarna ska
        // åtminstone inte hållas upptagna (challenge_active) — det återställs best-effort. W/D/L delas inte ut: något
        // avgjort resultat finns inte förrän någon rättat boostarna manuellt.
        logger.error(
          `🚨 KRITISK: challenge ${challengeId} is completed WITHOUT boosts and the claim could not be released — manual repair needed ` +
          `(insert winner/loser rows in user_boosts or set the challenge back to active):`,
          { boostError, releaseError },
        );
        const { error: freeError } = await supabase
          .from('users')
          .update({ challenge_active: false })
          .in('id', [challenge.challenger_id, challenge.opponent_id]);
        if (freeError) {
          logger.error(`🚨 KRITISK: could not reset challenge_active for the players of challenge ${challengeId} either:`, freeError);
        }
        throw new Error(
          `Failed to create boosts for challenge ${challengeId}: ${boostError.message}; ` +
          `the claim could not be released either (challenge stays completed without boosts): ${releaseError.message}`,
        );
      }
      throw new Error(`Failed to create boosts for challenge ${challengeId}: ${boostError.message} (claim released, will be retried)`);
    }
  }

  // Från och med här är boostarna utdelade: avgörandet släpps inte längre (ett omförsök skulle dela ut dem igen).
  // Delfel samlas, resten körs, och felet kastas efteråt så att det syns i schedulern/anroparen.
  const postClaimErrors: string[] = [];

  // 3. Reset challenge_active for both users
  const { error: activeError } = await supabase
    .from('users')
    .update({ challenge_active: false })
    .in('id', [challenge.challenger_id, challenge.opponent_id]);
  if (activeError) {
    logger.error(`❌ Failed to reset challenge_active after settling ${challengeId}:`, activeError);
    postClaimErrors.push(`challenge_active reset failed: ${activeError.message}`);
  }

  // 4. Update W/D/L
  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('id, wins, draws, losses')
    .in('id', [challenge.challenger_id, challenge.opponent_id]);

  if (usersError) {
    logger.error(`❌ Failed to read W/D/L after settling ${challengeId}:`, usersError);
    postClaimErrors.push(`W/D/L read failed: ${usersError.message}`);
  } else if (users) {
    const wdlResults = await Promise.all(
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
    for (const res of wdlResults) {
      if (res.error) {
        logger.error(`❌ Failed to update W/D/L after settling ${challengeId}:`, res.error);
        postClaimErrors.push(`W/D/L update failed: ${res.error.message}`);
      }
    }
  }

  // Pack News (ADR 008): loggas EFTER claim + boostar + W/D/L, icke-kastande. dedupe_key challenge_settled:<id>
  // ger exakt en rad även om avgörandet körs om.
  await recordChallengeSettled({
    ...challenge,
    outcome,
    challenger_final_value: c.value,
    opponent_final_value: o.value,
  });

  if (postClaimErrors.length > 0) {
    throw new Error(`Challenge ${challengeId} settled with errors: ${postClaimErrors.join('; ')}`);
  }

  if (outcome === 'draw') {
    logger.info(`🤝 Challenge ${challengeId} ended in a draw`);
    return;
  }

  logger.info(`✅ Challenge ${challengeId} settled. Winner: ${winnerId}, boosts created.`);
}
