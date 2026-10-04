// Dagligt streak-underhåll (bugg #7): current_streak räknades tidigare bara
// om när användaren SKREV något — slutade någon springa stod gammal streak
// kvar i users-tabellen för alltid. Det här jobbet räknar om alla användares
// streaks varje natt. Idempotent: ren omräkning ur runs-historiken.
//
// 03:00 Stockholm är valt med flit: då är UTC-datumet alltid samma som
// Stockholm-datumet, så StreakService:s "idag/igår"-jämförelse (UTC-baserad,
// se streak-ADR-förslaget) blir korrekt även runt månadsskiften/DST.
import cron from 'node-cron';
import { getSupabaseClient } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { StreakService } from '../services/streakService.js';

export async function recalculateAllStreaks(): Promise<void> {
  const supabase = getSupabaseClient();
  const { data: users, error } = await supabase.from('users').select('id');

  if (error || !users?.length) {
    if (error) logger.error('❌ [StreakScheduler] Fetch users error:', error);
    return;
  }

  const results = await Promise.allSettled(
    users.map((u: { id: string }) => StreakService.updateUserStreak(u.id))
  );
  const failed = results.filter(r => r.status === 'rejected').length;
  logger.info(`✅ [StreakScheduler] Recalculated streaks for ${users.length - failed}/${users.length} users`);
}

export function startStreakScheduler(): void {
  logger.info('🔥 Starting streak scheduler...');

  cron.schedule('0 3 * * *', async () => {
    logger.info('⏰ [StreakScheduler] Nightly streak recalculation...');
    try {
      await recalculateAllStreaks();
    } catch (e) {
      logger.error('❌ [StreakScheduler] Recalculation error:', e);
    }
  }, { timezone: 'Europe/Stockholm' });

  logger.info('✅ Streak scheduler started');
}
