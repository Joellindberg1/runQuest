// 🏆 Challenge Scheduler
import { logger } from '../utils/logger.js';
import cron from 'node-cron';
import { getSupabaseClient } from '../config/database.js';
import { settleChallenge } from '../services/challengeService.js';
import { retractChallengeReceived } from '../services/activityLog.js';
import { MS_DAY, addDays } from '@runquest/shared';
import { todayStockholm, at3amStockholm } from '../utils/dateUtils.js';
import { summarizeSettled } from './settledSummary.js';
import { errorCode, errorWithCode } from '../utils/errorCode.js';

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
    logger.error(`❌ Error fetching challenges to settle (${errorCode(error)})`); return;
  }
  if (!challenges?.length) return;

  logger.info(`⏰ Settling ${challenges.length} ended challenge(s)...`);
  const results = await Promise.allSettled(challenges.map((c: any) => settleChallenge(c.id)));
  summarizeSettled('[ChallengeScheduler] Settling ended challenges', results);
}

// ─── Auto-start legendary (after 4 days no response) ────────────────────────

async function autoStartLegendaryChallenges(): Promise<void> {
  const supabase = getSupabaseClient();
  const cutoff = new Date(Date.now() - 4 * MS_DAY).toISOString();

  const { data: challenges, error } = await supabase
    .from('challenges')
    .select('id, duration_days')
    .eq('status', 'pending')
    .eq('tier', 'legendary')
    .lte('legendary_sent_at', cutoff);

  // Kastar utan egen logg: tickens sammanfattning (startChallengeScheduler) loggar felet en gång, med koden.
  if (error) throw errorWithCode('Failed to fetch legendary challenges to auto-start', error);
  if (!challenges?.length) return;

  logger.info(`⚔️ Auto-starting ${challenges.length} legendary challenge(s)...`);

  const startDate = todayStockholm();

  const results = await Promise.allSettled(
    challenges.map(async (c: any) => {
      const endDate = addDays(startDate, c.duration_days);
      const determineAt = at3amStockholm(addDays(startDate, c.duration_days + 1)).toISOString();
      const { error: startError } = await supabase
        .from('challenges')
        .update({ status: 'active', start_date: startDate, end_date: endDate, determine_at: determineAt })
        .eq('id', c.id);
      if (startError) {
        throw errorWithCode(`Failed to auto-start legendary challenge ${c.id}`, startError);
      }
    })
  );
  // Felen på enskilda utmaningar loggas här, en gång och med sina koder. De kastas inte vidare: då loggade tickens sammanfattning samma fel igen.
  summarizeSettled('[ChallengeScheduler] Auto-starting legendary challenges', results);
}

// ─── Auto-decline minor/major (after 3 days no response) ────────────────────

export async function autoDeclinePendingChallenges(): Promise<void> {
  const supabase = getSupabaseClient();
  const cutoff = new Date(Date.now() - 3 * MS_DAY).toISOString();

  const { data: challenges, error } = await supabase
    .from('challenges')
    .select('id, challenger_id, opponent_id')
    .in('status', ['pending'])
    .in('tier', ['minor', 'major'])
    .lte('created_at', cutoff);

  if (error) throw errorWithCode('Failed to fetch pending challenges to auto-decline', error);
  if (!challenges?.length) return;

  logger.info(`🚫 Auto-declining ${challenges.length} unanswered challenge(s)...`);

  const results = await Promise.allSettled(
    challenges.map(async (c: any) => {
      // Restore token and reset challenge_active before deleting (FK order)
      const [tokenRes, usersRes] = await Promise.all([
        supabase
          .from('user_challenge_tokens')
          .update({ sent_at: null, challenge_id: null })
          .eq('challenge_id', c.id),
        supabase
          .from('users')
          .update({ challenge_active: false })
          .in('id', [c.challenger_id, c.opponent_id]),
      ]);
      // Misslyckad återställning → utmaningen raderas inte (token skulle peka på en borttagen rad, spelarna stå kvar som upptagna).
      // Båda stegen är idempotenta, så nästa körning försöker igen.
      const restoreError = tokenRes.error ?? usersRes.error;
      if (restoreError) {
        throw errorWithCode(`Failed to restore token/challenge_active for auto-declined challenge ${c.id}`, restoreError);
      }
      const { error: deleteError } = await supabase.from('challenges').delete().eq('id', c.id);
      if (deleteError) logger.error(`❌ Failed to delete auto-declined challenge ${c.id} (${errorCode(deleteError)})`);
      else await retractChallengeReceived(c.id);
    })
  );
  summarizeSettled('[ChallengeScheduler] Auto-declining challenges', results);
}

// ─── Scheduler entry point ───────────────────────────────────────────────────

export function startChallengeScheduler(): void {
  logger.info('🏆 Starting challenge scheduler...');

  // Settle ended challenges — every hour
  cron.schedule('5 * * * *', async () => {
    logger.info('⏰ [ChallengeScheduler] Checking for ended challenges...');
    try { await settleEndedChallenges(); } catch (e) { logger.error(`❌ settleEndedChallenges error (${errorCode(e)})`); }
  });

  // Auto-start legendary + auto-decline minor/major — every 6 hours
  cron.schedule('10 */6 * * *', async () => {
    logger.info('⏰ [ChallengeScheduler] Auto-start/decline check...');
    try {
      const results = await Promise.allSettled([autoStartLegendaryChallenges(), autoDeclinePendingChallenges()]);
      summarizeSettled('[ChallengeScheduler] Auto-manage tick', results);
    } catch (e) {
      logger.error(`❌ Challenge auto-manage error (${errorCode(e)})`);
    }
  });

  logger.info('✅ Challenge scheduler started');
}
