import { supabase } from '../config/database';
import { logger } from '../utils/logger.js';
import { rebuildGroupTitleRanking } from './groupRanking.js';
import { titleEngineRegistry } from '../titleEngines/index';
import { emitTitleNews, snapshotTitleHolders } from './titleNews.js';
import { titleInputs, type StoredTotals } from './titleInputs.js';
import { toRunData } from '../titleEngines/_utils';
import type { RunData, TitleContext, UserStats } from '../titleEngines/types';
import { errorCode, errorWithCode } from '../utils/errorCode.js';
import { titleWindow, type TitleWindow } from '@runquest/shared';

/** Vems titlar som räknas och i vilken grupp: titelvärdet är en funktion av (användare, grupp, fönster), ADR 012 beslut 1. */
export interface TitleMember {
  userId: string;
  groupId: string;
  /** Medlemskapets fönster (titleWindow ur group_members.starts_on): vilka rundor som räknas. */
  window: TitleWindow;
}

export interface TitleRunResult {
  total: number;
  processed: number;
  failed: number;
}

/**
 * Enhanced title processing service that integrates with the new optimized system
 */
export class EnhancedTitleService {

  /**
   * Process titles for one member of a group after run updates. `runs` är ALLA användarens rundor; medlemmens fönster
   * avgör vilka som räknas (titleInputs). user_titles skrivs med gruppen. Rankingen byggs INTE om här: det görs en gång per
   * gruppomräkning i processGroupTitles, efter att alla medlemmar skrivits (ADR 012 beslut 4.4, migration 058).
   *
   * VARNING: anropa den inte utanför processGroupTitles. En skrivning här utan att gruppens ranking byggs om efteråt lämnar title_leaderboard
   * gammal (migration 058 släppte triggern som förr höll den rätt). Metoden är publik bara för att testerna ska kunna spionera på den.
   */
  async processUserTitlesAfterRun(
    member: TitleMember,
    runs: any[],
    stored: StoredTotals,
    ctx: TitleContext = { now: new Date() }
  ): Promise<void> {
    const { userId, groupId } = member;
    if (typeof groupId !== 'string' || groupId === '') throw new Error('processUserTitlesAfterRun kräver groupId');
    logger.info('🏆 Processing titles for user:', userId);

    const { data: titles, error: titlesError } = await supabase.client
      .from('titles')
      .select('id, name, description, unlock_requirement, metric_key');

    if (titlesError) throw errorWithCode('Titles fetch failed', titlesError);

    const input = titleInputs(runs, member.window, stored);
    logger.info('📈 Stats:', { totalKm: input.stats.totalKm, longestStreak: input.stats.longestStreak, runsCount: input.runs.length });

    const runData: RunData[] = input.runs.map(toRunData);
    const userStats: UserStats = input.stats;

    const earnedAt = new Date().toISOString();

    const titleCheckResults = await Promise.allSettled(
      titles.map((title: any) => this.checkAndUpdateTitle(title, member, runData, userStats, earnedAt, ctx))
    );

    // Alla titlar har försökts; ett enda fel gör ändå användarens omräkning misslyckad (förr loggat och sväljt, RUN-157).
    // Felet som kastas bär koden från det första som föll, så att den som fångar loggar en kod och inte "(Error)".
    const rejected = titleCheckResults.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (rejected.length > 0) {
      throw errorWithCode(`${rejected.length} title check(s) failed (user ${userId})`, rejected[0].reason);
    }

    logger.info(`✅ Processed ${titles.length} titles`);
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
   * Check and update a specific title for a member of a group. Databasfel kastas (en dubbel rad ger 23505 på (user_id, group_id, title_id)).
   * Rankingen rörs inte här: den byggs om i processGroupTitles när alla medlemmar är skrivna.
   */
  private async checkAndUpdateTitle(
    title: any,
    member: TitleMember,
    runs: RunData[],
    userStats: UserStats,
    earnedAt: string,
    ctx: TitleContext
  ): Promise<void> {
    const { userId, groupId } = member;
    const engine = titleEngineRegistry.get(title.metric_key);
    if (!engine) {
      logger.warn(`⚠️ No engine registered for metric_key: "${title.metric_key}" (title: "${title.name}")`);
      return;
    }

    const userValue = engine.calculate(runs, userStats, ctx);
    logger.info(`🔍 Checking title: "${title.name}" — value: ${userValue}, required: ${title.unlock_requirement}`);

    // Raden är (användare, grupp, titel): samma användare kan ha olika värden i två grupper (ADR 012 beslut 1.1).
    const { data: existingTitle, error: existingError } = await supabase.client
      .from('user_titles')
      .select('id, value')
      .eq('user_id', userId)
      .eq('group_id', groupId)
      .eq('title_id', title.id)
      .single();

    // Kastas vidare (RUN-157): en misslyckad skrivning ska räknas som fel, inte som "ingen ändring". Utan egen logg: processGroupTitles
    // (eller anroparen av processUserTitlesAfterRun) fångar felet och loggar det en gång. Koden följer med, aldrig databastexten.
    const titleLabel = `title ${title.id} of user ${userId}`;
    if (existingError && existingError.code !== 'PGRST116') throw errorWithCode(`Failed to read ${titleLabel}`, existingError);

    if (userValue < title.unlock_requirement) {
      // Bugg #10: kravet inte (längre) uppfyllt. Fanns en tilldelning —
      // t.ex. efter att rundan som gav titeln raderats — återkallas den.
      if (existingTitle) {
        const { error } = await supabase.client.from('user_titles').delete().eq('id', existingTitle.id);
        if (error) throw errorWithCode(`Failed to revoke ${titleLabel}`, error);
        logger.info(`🗑️ Revoked "${title.name}" from user ${userId} (${userValue} < ${title.unlock_requirement})`);
      }
      return;
    }

    const titleData = { user_id: userId, group_id: groupId, title_id: title.id, value: userValue, earned_at: earnedAt };

    if (existingTitle) {
      if (existingTitle.value !== userValue) {
        const { error } = await supabase.client.from('user_titles').update(titleData).eq('id', existingTitle.id);
        if (error) throw errorWithCode(`Failed to update ${titleLabel}`, error);
        logger.info(`🔄 Updated "${title.name}": ${existingTitle.value} → ${userValue}`);
      } else {
        logger.info(`✓ "${title.name}" value unchanged: ${userValue}`);
      }
    } else {
      const { error } = await supabase.client.from('user_titles').insert(titleData);
      if (error) throw errorWithCode(`Failed to award ${titleLabel}`, error);
      logger.info(`🆕 Awarded "${title.name}" to user ${userId} with value ${userValue}`);
    }
  }

  /**
   * Process titles for the active members of ONE group (ADR 012 beslut 4). Medlemmarna läses ur group_members (left_at is null),
   * aldrig ur users.group_id, och varje medlems rundor räknas inom medlemskapets fönster (starts_on). Det finns inget läge
   * som blandar gruppers användare och inget för grupplösa.
   *
   * Fail-closed: utan groupId kastas det innan något läses.
   *
   * Pack News (ADR 008 beslut 6, ADR 012 beslut 5.3): gruppens position 1–2 ögonblicksfotograferas före och efter
   * och skillnaden loggas (title_unlocked/_taken/_revoked, endast framåt). `emitNews: false` för
   * regel-/data-underhåll (admin /titles/reprocess-all) så att flödet inte spammas.
   *
   * Rankingen (ADR 012 beslut 4.4, migration 058): gruppens title_leaderboard byggs om EN gång, efter att alla medlemmar skrivits och före
   * efter-ögonblicksbilden — den enda skrivaren av rankingen i en titelomräkning (förr: trigger på user_titles + ett rpc per titel och
   * användare + ett avslutande rpc i calculateUserTotals). Ombyggnaden stämplar title_leaderboard.updated_at för hela gruppen, vilket är klockan
   * som titleRecalcClock läser. Ett fel i ombyggnaden kastas med databasens kod (gruppomräkningen är misslyckad, inga nyheter skickas).
   *
   * Returnerar hur många medlemmar som räknades om och hur många som misslyckades (RUN-157) — ett fel hos en
   * användare kastar inte, så att övriga medlemmar och ombyggnaden av gruppens ranking ändå körs.
   */
  async processGroupTitles(
    groupId: string,
    options: { emitNews?: boolean } = {}
  ): Promise<TitleRunResult> {
    if (typeof groupId !== 'string' || groupId === '') {
      throw new Error('processGroupTitles kräver groupId');
    }
    const emitNews = options.emitNews ?? true;
    const holdersBefore = emitNews ? await snapshotTitleHolders(groupId) : null;

    logger.info(`🏆 Processing titles for the members of group ${groupId}...`);

    const { data: members, error: membersError } = await supabase.client
      .from('group_members')
      .select('user_id, starts_on')
      .eq('group_id', groupId)
      .is('left_at', null);
    if (membersError) throw errorWithCode('Group members fetch failed', membersError);

    const activeMembers = (members ?? []) as Array<{ user_id: string; starts_on: string | null }>;
    if (activeMembers.length === 0) {
      logger.info(`📊 Group ${groupId} has no active members`);
      return { total: 0, processed: 0, failed: 0 };
    }

    const { data: users, error: usersError } = await supabase.client
      .from('users')
      .select('id, total_km, longest_streak')
      .in('id', activeMembers.map((m) => m.user_id));
    if (usersError) throw errorWithCode('Users fetch failed', usersError);
    const storedByUser = new Map<string, StoredTotals>((users ?? []).map((u: any) => [u.id, { total_km: u.total_km, longest_streak: u.longest_streak }]));

    logger.info(`📊 Found ${activeMembers.length} members to process`);
    const startTime = Date.now();
    const ctx: TitleContext = { now: new Date() }; // ett "nu" för hela körningen, delat av alla användare

    // En användare i taget (RUN-157): skrivningarna till user_titles görs sekventiellt, och rankingen byggs om först när alla är gjorda
    // (parallella ombyggnader av samma (grupp, titel) krockade på (group_id, title_id, position) med 23505). Ett fel hos en användare
    // stoppar inte de övriga.
    let processedCount = 0;
    let failedCount = 0;
    for (const member of activeMembers) {
      try {
        const window = titleWindow({ starts_on: member.starts_on });
        const { data: runs, error: runsError } = await supabase.client
          .from('runs')
          .select('date, distance, start_time, total_elevation_gain, pace_std_dev, moving_time, run_weather(temperature_c, wind_speed_ms, wind_gusts_ms)')
          .eq('user_id', member.user_id)
          .order('date', { ascending: true });

        if (runsError) throw errorWithCode(`Runs fetch failed for user ${member.user_id}`, runsError);

        // Ingen tidig return vid noll rundor (bugg #3/#10): med tom lista
        // beräknar motorerna 0/−∞ → revocation-grenen rensar titlarna.
        const runsWithAlias = (runs ?? []).map((run: any) => ({ ...run, distance_km: run.distance }));
        await this.processUserTitlesAfterRun(
          { userId: member.user_id, groupId, window },
          runsWithAlias,
          storedByUser.get(member.user_id) ?? { total_km: null, longest_streak: null },
          ctx,
        );
        processedCount++;
      } catch (error) {
        failedCount++;
        logger.error(`❌ Title processing failed for user ${member.user_id} (${errorCode(error)})`);
      }
    }

    logger.info(`✅ Processed titles for ${processedCount}/${activeMembers.length} members in ${Date.now() - startTime}ms`);

    // EN ombyggnad av gruppens ranking (alla titlar), efter alla skrivningar och före efter-ögonblicksbilden. Kastar med databasens kod.
    await rebuildGroupTitleRanking(groupId, supabase.client);
    logger.info(`✅ Title ranking of group ${groupId} rebuilt`);

    if (holdersBefore) {
      const holdersAfter = await snapshotTitleHolders(groupId);
      if (holdersAfter) await emitTitleNews(groupId, holdersBefore, holdersAfter);
    }

    return { total: activeMembers.length, processed: processedCount, failed: failedCount };
  }

  /**
   * Process titles for every group that has an active member, ONE group at a time (RUN-157: sekventiellt, så att två gruppers
   * ombyggnader inte tävlar). Gruppen avgör ranking och nyheter; inget blandas över grupper. Räknarna summeras.
   *
   * En grupp som inte går att läsa stoppar inte de övriga; efter att alla försökts kastas ett fel med koden från den första som föll.
   */
  async processAllGroupsTitles(options: { emitNews?: boolean } = {}): Promise<TitleRunResult> {
    const emitNews = options.emitNews ?? true;

    const { data, error } = await supabase.client.from('group_members').select('group_id').is('left_at', null);
    if (error) throw errorWithCode('Groups fetch failed', error);
    const groupIds: string[] = [...new Set<string>((data ?? []).map((row: any) => row.group_id as string))].sort();

    const sum: TitleRunResult = { total: 0, processed: 0, failed: 0 };
    let failedGroups = 0;
    let firstFailure: unknown;
    for (const groupId of groupIds) {
      try {
        const result = await this.processGroupTitles(groupId, { emitNews });
        sum.total += result.total;
        sum.processed += result.processed;
        sum.failed += result.failed;
      } catch (groupError) {
        failedGroups++;
        firstFailure ??= groupError;
        logger.warn(`⚠️ Title recalculation failed for group ${groupId} (${errorCode(groupError)})`);
      }
    }

    if (failedGroups > 0) {
      throw errorWithCode(`Title recalculation failed for ${failedGroups} of ${groupIds.length} group(s)`, firstFailure);
    }
    return sum;
  }
}

export const enhancedTitleService = new EnhancedTitleService();
