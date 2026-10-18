import { supabase } from '../config/database';
import { logger } from '../utils/logger.js';
import { titleLeaderboardService } from './titleLeaderboardService';
import { titleEngineRegistry } from '../titleEngines/index';
import { emitTitleNews, snapshotTitleHolders } from './titleNews.js';
import { toRunData } from '../titleEngines/_utils';
import type { RunData, TitleContext, UserStats } from '../titleEngines/types';
import { errorCode } from '../utils/errorCode.js';

/**
 * Enhanced title processing service that integrates with the new optimized system
 */
export class EnhancedTitleService {

  /**
   * Process titles for a user after run updates.
   */
  async processUserTitlesAfterRun(
    userId: string,
    runs: any[],
    totalKm: number,
    longestStreak: number,
    ctx: TitleContext = { now: new Date() }
  ): Promise<void> {
    try {
      logger.info('🏆 Processing titles for user:', userId);
      logger.info('📈 Stats:', { totalKm, longestStreak, runsCount: runs.length });

      const { data: titles, error: titlesError } = await supabase.client
        .from('titles')
        .select('id, name, description, unlock_requirement, metric_key');

      if (titlesError) throw new Error(`Titles fetch failed: ${titlesError.message}`);

      const runData: RunData[] = runs.map(toRunData);
      const userStats: UserStats = { totalKm, longestStreak };

      const earnedAt = new Date().toISOString();

      const titleCheckResults = await Promise.allSettled(
        titles.map((title: any) => this.checkAndUpdateTitle(title, userId, runData, userStats, earnedAt, ctx))
      );

      const titlesToUpdate: string[] = titles
        .filter((_: any, i: number) =>
          titleCheckResults[i].status === 'fulfilled' &&
          (titleCheckResults[i] as PromiseFulfilledResult<boolean>).value
        )
        .map((t: any) => t.id);

      // Olika titlar har olika topplistor, så inom EN användare krockar ombyggnaderna inte. Mellan användare gör de det,
      // därför räknar processAllUsersTitles användarna en i taget (RUN-157).
      const refreshResults = await Promise.allSettled(
        titlesToUpdate.map((titleId: string) => titleLeaderboardService.refreshTitleLeaderboard(titleId))
      );

      // Alla titlar har försökts; ett enda fel gör ändå användarens omräkning misslyckad (förr loggat och sväljt, RUN-157).
      const failedChecks = titleCheckResults.filter(r => r.status === 'rejected').length;
      const failedRefreshes = refreshResults.filter(r => r.status === 'rejected').length;
      if (failedChecks + failedRefreshes > 0) {
        throw new Error(`${failedChecks} title check(s) and ${failedRefreshes} leaderboard refresh(es) failed`);
      }

      logger.info(`✅ Processed ${titles.length} titles, updated ${titlesToUpdate.length} leaderboards`);

    } catch (error) {
      logger.error(`❌ Error processing user titles (${errorCode(error)})`);
      throw error;
    }
  }

  /**
   * Calculate user achievement values from runs (public for use in API endpoints)
   */
  calculateUserValues(runs: any[], totalKm: number, longestStreak: number, ctx: TitleContext = { now: new Date() }) {
    const runData: RunData[] = runs.map(toRunData);
    const userStats: UserStats = { totalKm, longestStreak };

    const result: Record<string, number> = {};
    for (const [key, engine] of titleEngineRegistry) {
      result[key] = engine.calculate(runData, userStats, ctx);
    }
    return result;
  }

  /**
   * Check and update a specific title for a user. Databasfel kastas — i prod kan även triggern på user_titles,
   * som bygger om title_leaderboard, ge 23505 här.
   */
  private async checkAndUpdateTitle(
    title: any,
    userId: string,
    runs: RunData[],
    userStats: UserStats,
    earnedAt: string,
    ctx: TitleContext
  ): Promise<boolean> {
    try {
      const engine = titleEngineRegistry.get(title.metric_key);
      if (!engine) {
        logger.warn(`⚠️ No engine registered for metric_key: "${title.metric_key}" (title: "${title.name}")`);
        return false;
      }

      const userValue = engine.calculate(runs, userStats, ctx);
      logger.info(`🔍 Checking title: "${title.name}" — value: ${userValue}, required: ${title.unlock_requirement}`);

      const { data: existingTitle, error: existingError } = await supabase.client
        .from('user_titles')
        .select('id, value')
        .eq('user_id', userId)
        .eq('title_id', title.id)
        .single();

      if (existingError && existingError.code !== 'PGRST116') throw existingError;

      if (userValue < title.unlock_requirement) {
        // Bugg #10: kravet inte (längre) uppfyllt. Fanns en tilldelning —
        // t.ex. efter att rundan som gav titeln raderats — återkallas den.
        if (existingTitle) {
          const { error } = await supabase.client.from('user_titles').delete().eq('id', existingTitle.id);
          if (error) throw error;
          logger.info(`🗑️ Revoked "${title.name}" from user ${userId} (${userValue} < ${title.unlock_requirement})`);
          return true; // leaderboarden måste uppdateras
        }
        return false;
      }

      const titleData = { user_id: userId, title_id: title.id, value: userValue, earned_at: earnedAt };

      if (existingTitle) {
        if (existingTitle.value !== userValue) {
          const { error } = await supabase.client.from('user_titles').update(titleData).eq('id', existingTitle.id);
          if (error) throw error;
          logger.info(`🔄 Updated "${title.name}": ${existingTitle.value} → ${userValue}`);
        } else {
          logger.info(`✓ "${title.name}" value unchanged: ${userValue}`);
        }
      } else {
        const { error } = await supabase.client.from('user_titles').insert(titleData);
        if (error) throw error;
        logger.info(`🆕 Awarded "${title.name}" to user ${userId} with value ${userValue}`);
      }

      return true;

    } catch (error) {
      // Kastas vidare (RUN-157): en misslyckad skrivning ska räknas som fel, inte som "ingen ändring".
      logger.error(`❌ Error checking title "${title.name}" (${errorCode(error)})`);
      throw error;
    }
  }

  /**
   * Process titles for the users of ONE group, or — only with an explicit `allGroups: true` — for every user.
   *
   * Fail-closed (RUN-104): varken groupId eller allGroups:true → kastar innan någon användare läses. Förr
   * räknade ett utelämnat groupId tyst om alla gruppers användare (Strava-importen). groupId vinner över allGroups.
   *
   * Pack News (ADR 008 beslut 6): innehavarna (position 1) ögonblicksfotograferas före och efter
   * och skillnaden loggas (title_unlocked/_taken/_revoked, endast framåt). `emitNews: false` för
   * regel-/data-underhåll (admin /titles/reprocess-all) så att flödet inte spammas.
   *
   * Returnerar hur många användare som räknades om och hur många som misslyckades (RUN-157) — ett fel hos en
   * användare kastar inte, så att övriga användare och den avslutande globala omräkningen ändå körs.
   */
  async processAllUsersTitles(
    groupId?: string,
    options: { emitNews?: boolean; allGroups?: boolean } = {}
  ): Promise<{ total: number; processed: number; failed: number }> {
    if (!groupId && options.allGroups !== true) {
      throw new Error('processAllUsersTitles kräver groupId eller { allGroups: true }');
    }
    const emitNews = options.emitNews ?? true;
    try {
      const holdersBefore = emitNews ? await snapshotTitleHolders() : null;

      logger.info(groupId
        ? `🏆 Processing titles for users in group ${groupId}...`
        : '🏆 Processing titles for ALL users...'
      );

      let query = supabase.client.from('users').select('id, total_km, longest_streak');
      if (groupId) query = query.eq('group_id', groupId);

      const { data: users, error: usersError } = await query;
      if (usersError) throw new Error(`Users fetch failed: ${usersError.message}`);

      logger.info(`📊 Found ${users.length} users to process`);
      const startTime = Date.now();
      const ctx: TitleContext = { now: new Date() }; // ett "nu" för hela körningen, delat av alla användare

      // En användare i taget (RUN-157): varje användares omräkning bygger om de DELADE topplistorna per titel
      // (update_title_leaderboard och triggern på user_titles: DELETE + INSERT). Parallella ombyggnader av samma
      // titel krockade på (title_id, position) med 23505. Ett fel hos en användare stoppar inte de övriga.
      let processedCount = 0;
      let failedCount = 0;
      for (const user of users as any[]) {
        try {
          const { data: runs, error: runsError } = await supabase.client
            .from('runs')
            .select('date, distance, start_time, total_elevation_gain, pace_std_dev, moving_time, run_weather(temperature_c, wind_speed_ms, wind_gusts_ms)')
            .eq('user_id', user.id)
            .order('date', { ascending: true });

          if (runsError) throw new Error(`Runs fetch failed: ${runsError.message}`);

          // Ingen tidig return vid noll rundor (bugg #3/#10): med tom lista
          // beräknar motorerna 0/−∞ → revocation-grenen rensar titlarna.
          const runsWithAlias = (runs ?? []).map((run: any) => ({ ...run, distance_km: run.distance }));
          await this.processUserTitlesAfterRun(user.id, runsWithAlias, user.total_km || 0, user.longest_streak || 0, ctx);
          processedCount++;
        } catch (error) {
          failedCount++;
          logger.error(`❌ Title processing failed for user ${user.id} (${errorCode(error)})`);
        }
      }

      if (failedCount > 0) logger.error(`❌ Title processing failed for ${failedCount}/${users.length} users`);

      logger.info(`✅ Processed titles for ${processedCount}/${users.length} users in ${Date.now() - startTime}ms`);

      if (holdersBefore) {
        const holdersAfter = await snapshotTitleHolders();
        if (holdersAfter) await emitTitleNews(holdersBefore, holdersAfter);
      }

      return { total: users.length, processed: processedCount, failed: failedCount };
    } catch (error) {
      logger.error(`❌ Error processing all users titles (${errorCode(error)})`);
      throw error;
    }
  }
}

export const enhancedTitleService = new EnhancedTitleService();
