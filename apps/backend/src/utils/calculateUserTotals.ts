import { getSupabaseClient } from '../config/database.js';
import { logger } from './logger.js';
import { getLevelFromXP } from '../services/levelService.js';
import { reconcileTokensForLevel } from '../services/challengeService.js';
import { recordLevelUps, recordRunMilestones } from '../services/activityLog.js';
import { evaluateBadges } from '../services/badgeService.js';
import { recordRankPassesForXp } from '../services/rankNews.js';
import { errorCode } from './errorCode.js';
import { getActiveMembership } from './membership.js';
import { rebuildGroupTitleRanking } from '../services/groupRanking.js';

export interface CalculateUserTotalsOptions {
  /**
   * Skriv NYA rank_passed (xp) efter totalskrivningen. Default true. Massvägar (historikimporten vid anslutning, massraderingen vid
   * bortkoppling) skickar false: en ökning skriver ingenting och kostar inga extra queries. En MINSKNING retractar ändå dagens
   * egna rader (retract_only), så att en bortkoppling inte lämnar en falsk nyhet kvar (ADR 011 beslut 6.4, 13.4).
   */
  emitRankNews?: boolean;
}

/**
 * Räknar om användarens totaler och skriver dem (enda skribenten, ADR 005). Kastar ALDRIG: alla fel fångas och loggas.
 * Returnerar om uppdateringen av `users` lyckades (true) eller inte (false: en läsning (runs, users, streak) eller skrivning föll, eller något kastade före
 * skrivningen). Badges, titlar och Pack News som felar EFTER en lyckad skrivning ändrar inte svaret. Anropare som bara vill ha den gamla
 * best-effort-beteendet ignorerar värdet; en omräkning som ska kunna återhämtas (RUN-322) rensar sin markering bara på `true`.
 */
export async function calculateUserTotals(userId: string, options: CalculateUserTotalsOptions = {}): Promise<boolean> {
  const { emitRankNews = true } = options;
  let totalsWritten = false;
  try {
    const startTime = Date.now();
    const supabase = getSupabaseClient();

    // Get all runs for the user (bara XP och distans behövs här; titlarna läser sina egna rundor i processGroupTitles)
    const { data: runs, error } = await supabase
      .from('runs')
      .select('xp_gained, distance')
      .eq('user_id', userId)
      .order('date', { ascending: true });

    if (error) {
      logger.error(`Error fetching user runs (${errorCode(error)})`);
      return false;
    }

    // OBS: ingen tidig return vid noll rundor (bugg #3). Raderas sista rundan
    // måste totaler, level, streak, tokens och titlar nollställas/omräknas —
    // annars står gammal XP/streak kvar. Beräkningen nedan hanterar tom lista:
    // totalXP = event_xp, distans 0, streak 0, titlar återkallas.
    const userRuns = runs ?? [];

    // Fetch event_xp separately — accumulated from event settlements.
    // current_level/total_km/group_id läses i SAMMA select och är "föregående värden" för Pack News
    // (level_up/run_milestone, ADR 008); gruppen för Pack News kommer ur users.group_id, inte ur anroparens JWT. Titelomräkningen
    // använder inte den utan användarens aktiva medlemskap i group_members (längre ner).
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('event_xp, current_level, total_km, total_xp, group_id')
      .eq('id', userId)
      .single();

    // Utan raden vet vi inte event_xp: en 0 här skulle skriva total_xp och nivå UTAN eventpoängen. Hellre ingen skrivning alls
    // (som runs- och streakläsningen) än fel totaler; anroparen får false och kan försöka igen.
    if (userError || !userData) {
      logger.error(`Error fetching user row for totals (${userError ? errorCode(userError) : 'no_row'})`);
      return false;
    }
    const eventXP: number = userData.event_xp ?? 0;
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
      logger.error(`Error updating user totals (${errorCode(updateError)})`);
    } else {
      totalsWritten = true;
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
      logger.error(`❌ Error evaluating badges (${errorCode(badgeError)})`);
    }

    // 🏆 Titelomräkningen är gruppavgränsad (ADR 012 beslut 4): användarens AKTIVA medlemskap i group_members, läst färskt (JWT-gruppen blir
    // inaktuell efter groups/join, och users.group_id är bara en pekare). Bara den gruppens medlemmar räknas om och bara dess ranking byggs om.
    // Utan aktivt medlemskap finns inga titlar alls (ingen spelar utan grupp, F2): ingen omräkning, ingen ranking.
    try {
      const membership = await getActiveMembership(userId, supabase);

      if (!membership) {
        logger.info(`🏆 User ${userId} has no active group membership — no titles to process`);
      } else {
        const groupId = membership.group_id;
        const { EnhancedTitleService } = await import('../services/enhancedTitleService.js');
        const titleService = new EnhancedTitleService();

        logger.info(`🏆 Processing titles for group ${groupId}...`);
        const titleRun = await titleService.processGroupTitles(groupId);
        // RUN-158: processGroupTitles kastar inte vid fel hos enskilda medlemmar (RUN-157) — utan varningen
        // skulle ett delvis misslyckat omräkningspass se lyckat ut i loggen.
        if (titleRun && titleRun.failed > 0) {
          logger.warn(`⚠️ Group ${groupId}: titles failed for ${titleRun.failed} of ${titleRun.total} users`);
        } else {
          logger.info('✅ Group titles processed successfully');
        }

        // Gruppens ranking byggs om ur fullständiga user_titles. Bara den här gruppen: ingen global ombyggnad i skrivvägen.
        logger.info('🏆 Refreshing group title leaderboard...');
        try {
          await rebuildGroupTitleRanking(groupId, supabase);
          logger.info('✅ Title leaderboard refreshed successfully');
        } catch (leaderboardError) {
          logger.error(`❌ Failed to refresh title leaderboard (${errorCode(leaderboardError)})`);
        }
      }
    } catch (titleError) {
      logger.error(`❌ Error processing titles (${errorCode(titleError)})`);
      // Don't throw - user totals were saved successfully
    }

    logger.info(`✅ calculateUserTotals:${userId} completed in ${Date.now() - startTime}ms`);
  } catch (error) {
    logger.error(`Error in calculateUserTotals (${errorCode(error)})`);
  }
  return totalsWritten;
}