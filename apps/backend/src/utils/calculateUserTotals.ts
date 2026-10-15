import { getSupabaseClient } from '../config/database.js';
import { logger } from './logger.js';
import { getLevelFromXP } from '../services/levelService.js';
import { reconcileTokensForLevel } from '../services/challengeService.js';
import { recordLevelUps, recordRunMilestones } from '../services/activityLog.js';
import { evaluateBadges } from '../services/badgeService.js';
import { recordRankPassesForXp } from '../services/rankNews.js';
import { errorCode } from './errorCode.js';

export interface CalculateUserTotalsOptions {
  /**
   * Skriv NYA rank_passed (xp) efter totalskrivningen. Default true. Massvägar (historikimporten vid anslutning, massraderingen vid
   * bortkoppling) skickar false: en ökning skriver ingenting och kostar inga extra queries. En MINSKNING retractar ändå dagens
   * egna rader (retract_only), så att en bortkoppling inte lämnar en falsk nyhet kvar (ADR 011 beslut 6.4, 13.4).
   */
  emitRankNews?: boolean;
}

export async function calculateUserTotals(userId: string, options: CalculateUserTotalsOptions = {}) {
  const { emitRankNews = true } = options;
  try {
    const startTime = Date.now();
    const supabase = getSupabaseClient();

    // Get all runs for the user
    const { data: runs, error } = await supabase
      .from('runs')
      .select('xp_gained, distance, date, start_time, total_elevation_gain, pace_std_dev, moving_time, run_weather(temperature_c, wind_speed_ms, wind_gusts_ms)')
      .eq('user_id', userId)
      .order('date', { ascending: true });

    if (error) {
      logger.error('Error fetching user runs:', error);
      return;
    }

    // OBS: ingen tidig return vid noll rundor (bugg #3). Raderas sista rundan
    // måste totaler, level, streak, tokens och titlar nollställas/omräknas —
    // annars står gammal XP/streak kvar. Beräkningen nedan hanterar tom lista:
    // totalXP = event_xp, distans 0, streak 0, titlar återkallas.
    const userRuns = runs ?? [];

    // Fetch event_xp separately — accumulated from event settlements.
    // current_level/total_km/group_id läses i SAMMA select och är "föregående värden" för Pack News
    // (level_up/run_milestone, ADR 008); gruppen (Pack News och titelomräkningen) kommer ur users.group_id, inte ur anroparens JWT.
    const { data: userData } = await supabase
      .from('users')
      .select('event_xp, current_level, total_km, total_xp, group_id')
      .eq('id', userId)
      .single();
    const eventXP: number = userData?.event_xp ?? 0;
    const prevLevel: number | null = typeof userData?.current_level === 'number' ? userData.current_level : null;
    const prevTotalKm: number | null = userData?.total_km == null ? null : Number(userData.total_km);
    const prevTotalXp: number | null = userData?.total_xp == null ? null : Number(userData.total_xp);
    const userGroupId: string | null = userData?.group_id ?? null;

    // Calculate totals
    const runsXP = userRuns.reduce((sum: number, run: any) => sum + (run.xp_gained || 0), 0);
    const totalXP = runsXP + eventXP;
    const totalDistance = userRuns.reduce((sum: number, run: any) => sum + (run.distance || 0), 0);

    // Fetch level and streak in parallel (current_level no longer needed here)
    const { StreakService } = await import('../services/streakService.js');
    const [level, streakResult] = await Promise.all([
      getLevelFromXP(totalXP),
      StreakService.calculateUserStreaks(userId),
    ]);
    const currentStreak = streakResult.currentStreak;
    const longestStreak = Math.max(streakResult.longestStreak, currentStreak);

    // Reconcile challenge tokens against the user's current level.
    // Awards tokens for newly reached levels; removes unsent tokens if level dropped.
    await reconcileTokensForLevel(userId, level);

    // Update user record with consistent level calculation
    const { error: updateError } = await supabase
      .from('users')
      .update({
        total_xp: totalXP,
        total_km: totalDistance,
        current_streak: currentStreak,
        longest_streak: longestStreak,
        current_level: level
      })
      .eq('id', userId);

    if (updateError) {
      logger.error('Error updating user totals:', updateError);
    } else {
      logger.info(`✅ Updated user ${userId} totals: ${totalXP} XP, Level ${level}, ${currentStreak} day streak`);

      // Pack News: loggen skrivs EFTER att totalerna sparats och rör aldrig deras beräkning (ADR 005/008).
      // Båda anropen är icke-kastande och jämför mot FÖREGÅENDE värden — ingen historieflod vid deploy.
      await recordLevelUps(userId, prevLevel, level, userGroupId);
      // users.total_km är numeric(8,2): jämförs avrundat så att "föregående" (lagrat) och "nytt" är på samma skala.
      await recordRunMilestones(userId, prevTotalKm, Math.round(totalDistance * 100) / 100, userGroupId);

      // rank_passed (xp) är den tredje observatören efter totalskrivningen (ADR 011 beslut 6). Den körs bara när total_xp ändrats, så
      // en vanlig skrivning kostar noll extra queries. En MINSKNING anropar också: dagens rader för de M som W åter ligger bakom retractas.
      // emitRankNews false stänger bara av NYA rader: en MINSKNING retractar ändå dagens rader (retract_only), annars står en falsk
      // nyhet kvar efter t.ex. en bortkoppling. En ökning med false ger noll anrop och noll extra queries.
      const retractOnly = !emitRankNews;
      if (userGroupId && prevTotalXp !== null && totalXP !== prevTotalXp && (emitRankNews || totalXP < prevTotalXp)) {
        try {
          if (retractOnly) await recordRankPassesForXp(userId, userGroupId, prevTotalXp, { mode: 'retract_only' });
          else await recordRankPassesForXp(userId, userGroupId, prevTotalXp);
        } catch (rankError) {
          logger.error(`❌ Error recording rank passes for user ${userId} (${errorCode(rankError)})`);
        }
      }
    }

    // 🏅 Badges utvärderas ur samma rundor, även vid noll rundor (raderade rundor nedgraderar/raderar). Körs före titlarna
    // och rör aldrig totalerna: evaluateBadges kastar inte, men try/catch här håller kedjan intakt även om det ändras (STATE zon 1).
    try {
      await evaluateBadges(userId, { longestStreak });
    } catch (badgeError) {
      logger.error('❌ Error evaluating badges:', badgeError);
    }

    // 🏆 Omräkningen av titlar är gruppavgränsad (RUN-104): bara användarens EGEN grupp, aldrig andra grupper.
    // Rankingen (update_all_title_leaderboards → title_leaderboard) är däremot GLOBAL: topp 10 per titel över alla grupper.
    // Gruppen är den färska users.group_id — JWT-gruppen blir inaktuell efter groups/join (STATE zon 8).
    // Användare utan grupp har inga gruppmedlemmar att rangordna mot: bara de egna titlarna räknas om.
    try {
      const { EnhancedTitleService } = await import('../services/enhancedTitleService.js');
      const titleService = new EnhancedTitleService();

      if (userGroupId) {
        logger.info(`🏆 Processing titles for group ${userGroupId}...`);
        const titleRun = await titleService.processAllUsersTitles(userGroupId);
        // RUN-158: processAllUsersTitles kastar inte vid fel hos enskilda användare (RUN-157) — utan varningen
        // skulle ett delvis misslyckat omräkningspass se lyckat ut i loggen.
        if (titleRun && titleRun.failed > 0) {
          logger.warn(`⚠️ Group ${userGroupId}: titles failed for ${titleRun.failed} of ${titleRun.total} users`);
        } else {
          logger.info('✅ Group titles processed successfully');
        }
      } else {
        logger.info(`🏆 User ${userId} has no group — processing own titles only...`);
        const runsWithAlias = userRuns.map((run: any) => ({ ...run, distance_km: run.distance }));
        // Kastar vid fel (RUN-157); fångas här så att den globala omräkningen nedan ändå körs, som i gruppvägen.
        try {
          await titleService.processUserTitlesAfterRun(userId, runsWithAlias, Math.round(totalDistance * 100) / 100, longestStreak); // numeric(8,2) som users.total_km i gruppvägen
          logger.info('✅ Own titles processed successfully');
        } catch (ownTitlesError) {
          logger.error('❌ Error processing own titles:', ownTitlesError);
        }
      }
      
      // Now refresh the title leaderboard with complete user_titles data
      logger.info('🏆 Refreshing title leaderboard...');
      const supabase = getSupabaseClient();
      const { error: leaderboardError } = await supabase.rpc('update_all_title_leaderboards');
      
      if (leaderboardError) {
        logger.error('❌ Failed to refresh title leaderboard:', leaderboardError);
      } else {
        logger.info('✅ Title leaderboard refreshed successfully');
      }
      
    } catch (titleError) {
      logger.error('❌ Error processing titles:', titleError);
      // Don't throw - user totals were saved successfully
    }

    logger.info(`✅ calculateUserTotals:${userId} completed in ${Date.now() - startTime}ms`);
  } catch (error) {
    logger.error('Error in calculateUserTotals:', error);
  }
}