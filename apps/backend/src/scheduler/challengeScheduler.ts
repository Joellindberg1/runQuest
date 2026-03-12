// 🏆 Challenge Scheduler
import { logger } from '../utils/logger.js';
import cron from 'node-cron';
import { getSupabaseClient } from '../config/database.js';
import { settleChallenge } from '../services/challengeService.js';
import { todayStockholm, addDaysToDate, at3amStockholm } from '../utils/dateUtils.js';

// ─── Settle ended challenges ─────────────────────────────────────────────────

async function settleEndedChallenges(): Promise<void> {
  const supabase = getSupabaseClient();
  const now = new Date().toISOString();

  const { data: challenges, error } = await supabase
    .from('challenges')
    .select('id')
    .eq('status', 'active')
    .lte('determine_at', now);

  if (error) {
    logger.error('❌ Error fetching challenges to settle:', error); return;
  }
  if (!challenges?.length) return;

  logger.info(`⏰ Settling ${challenges.length} ended challenge(s)...`);
  await Promise.allSettled(challenges.map((c: any) => settleChallenge(c.id)));
}

// ─── Auto-start legendary (after 4 days no response) ────────────────────────

async function autoStartLegendaryChallenges(): Promise<void> {
  const supabase = getSupabaseClient();
  const cutoff = new Date(Date.now() - 4 * 86400000).toISOString();

  const { data: challenges, error } = await supabase
    .from('challenges')
    .select('id, duration_days')
    .eq('status', 'pending')
    .eq('tier', 'legendary')
    .lte('legendary_sent_at', cutoff);

  if (error || !challenges?.length) return;

  logger.info(`⚔️ Auto-starting ${challenges.length} legendary challenge(s)...`);

  const startDate = todayStockholm();

  await Promise.all(
    challenges.map((c: any) => {
      const endDate = addDaysToDate(startDate, c.duration_days);
      const determineAt = at3amStockholm(addDaysToDate(startDate, c.duration_days + 1)).toISOString();
      return supabase
        .from('challenges')
        .update({ status: 'active', start_date: startDate, end_date: endDate, determine_at: determineAt })
        .eq('id', c.id);
    })
  );
}

// ─── Auto-decline minor/major (after 3 days no response) ────────────────────

async function autoDeclinePendingChallenges(): Promise<void> {
  const supabase = getSupabaseClient();
  const cutoff = new Date(Date.now() - 3 * 86400000).toISOString();

  const { data: challenges, error } = await supabase
    .from('challenges')
    .select('id, challenger_id, opponent_id')
    .in('status', ['pending'])
    .in('tier', ['minor', 'major'])
    .lte('created_at', cutoff);

  if (error || !challenges?.length) return;

  logger.info(`🚫 Auto-declining ${challenges.length} unanswered challenge(s)...`);

  await Promise.all(
    challenges.map(async (c: any) => {
      // Restore token and reset challenge_active before deleting (FK order)
      await Promise.all([
        supabase
          .from('user_challenge_tokens')
          .update({ sent_at: null, challenge_id: null })
          .eq('challenge_id', c.id),
        supabase
          .from('users')
          .update({ challenge_active: false })
          .in('id', [c.challenger_id, c.opponent_id]),
      ]);
      await supabase.from('challenges').delete().eq('id', c.id);
    })
  );
}

// ─── Scheduler entry point ───────────────────────────────────────────────────

export function startChallengeScheduler(): void {
  logger.info('🏆 Starting challenge scheduler...');

  // Settle ended challenges — every hour
  cron.schedule('5 * * * *', async () => {
    logger.info('⏰ [ChallengeScheduler] Checking for ended challenges...');
    try { await settleEndedChallenges(); } catch (e) { logger.error('❌ settleEndedChallenges error:', e); }
  });

  // Auto-start legendary + auto-decline minor/major — every 6 hours
  cron.schedule('10 */6 * * *', async () => {
    logger.info('⏰ [ChallengeScheduler] Auto-start/decline check...');
    try {
      await Promise.allSettled([autoStartLegendaryChallenges(), autoDeclinePendingChallenges()]);
    } catch (e) {
      logger.error('❌ Challenge auto-manage error:', e);
    }
  });

  logger.info('✅ Challenge scheduler started');
}
