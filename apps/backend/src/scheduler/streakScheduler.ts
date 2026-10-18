// Dagligt streak-underhåll (bugg #7): current_streak räknades tidigare bara
// om när användaren SKREV något — slutade någon springa stod gammal streak
// kvar i users-tabellen för alltid. Det här jobbet räknar om alla användares
// streaks varje natt. Idempotent: ren omräkning ur runs-historiken.
//
// "Idag" i omräkningen är Stockholm-dagen (stockholmDay i packages/shared/src/calendar.ts, via
// StreakService), så jobbet ger samma svar vilken tid på dygnet det än körs. 03:00 Stockholm
// är bara en lugn tid för nattjobbet — ingen dygnsgräns hänger på klockslaget.
import cron from 'node-cron';
import { getSupabaseClient } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { StreakService } from '../services/streakService.js';
import { summarizeSettled } from './settledSummary.js';
import { errorCode } from '../utils/errorCode.js';

export async function recalculateAllStreaks(): Promise<void> {
  const supabase = getSupabaseClient();
  const { data: users, error } = await supabase.from('users').select('id');

  if (error || !users?.length) {
    if (error) logger.error(`❌ [StreakScheduler] Fetch users error (${errorCode(error)})`);
    return;
  }

  const results = await Promise.allSettled(
    users.map((u: { id: string }) => StreakService.updateUserStreak(u.id))
  );
  const { succeeded, total } = summarizeSettled('[StreakScheduler] Streak recalculation', results);
  logger.info(`✅ [StreakScheduler] Recalculated streaks for ${succeeded}/${total} users`);
}

export function startStreakScheduler(): void {
  logger.info('🔥 Starting streak scheduler...');

  cron.schedule('0 3 * * *', async () => {
    logger.info('⏰ [StreakScheduler] Nightly streak recalculation...');
    try {
      await recalculateAllStreaks();
    } catch (e) {
      logger.error(`❌ [StreakScheduler] Recalculation error (${errorCode(e)})`);
    }
  }, { timezone: 'Europe/Stockholm' });

  logger.info('✅ Streak scheduler started');
}
