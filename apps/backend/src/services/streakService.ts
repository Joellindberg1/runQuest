import { getSupabaseClient } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { getXpConfig } from './xpConfig.js';
import { recordActivity } from './activityLog.js';
import {
  buildStreakBrokenDraft, currentStreak, isStreakBroken, longestStreak, stockholmDay, streakBrokenThreshold, streakDayForRun,
} from '@runquest/shared';

export interface StreakResult {
  currentStreak: number;
  streakDayForRun: number;
  longestStreak: number;
}

export interface Run {
  date: string;
  user_id: string;
}

export class StreakService {
  /**
   * Beräknar streaks baserat på unika dagar, inte antal runs.
   * Hanterar runs som läggs in i efterhand korrekt.
   * Själva räkningen ligger i @runquest/shared (streak.ts) och delas med frontend; "idag" är Stockholm-dagen.
   *
   * @param userId - Användarens ID
   * @param newRunDate - Datumet för den nya/aktuella runan (YYYY-MM-DD)
   * @returns StreakResult med current streak, streak day för specifik run, och longest streak
   */
  static async calculateUserStreaks(userId: string, newRunDate?: string): Promise<StreakResult> {
    // Hämta alla runs för användaren
    const supabase = getSupabaseClient();
    const { data: allRuns, error } = await supabase
      .from('runs')
      .select('date')
      .eq('user_id', userId)
      .order('date', { ascending: true });

    if (error) {
      // Kastar i stället för att returnera 0/0: anroparna skriver resultatet rakt in i users, och ett läsfel
      // är inte detsamma som "användaren har ingen streak" (RUN-215).
      logger.error('Error fetching runs:', error);
      throw new Error(`Failed to fetch runs for streak calculation (user ${userId}): ${error.message}`);
    }

    // Om vi kollar en specifik run, inkludera den i beräkningen (temporärt)
    const days: string[] = (allRuns ?? []).map((run: { date: string }) => run.date);
    if (newRunDate) days.push(newRunDate);

    if (days.length === 0) {
      return { currentStreak: 0, streakDayForRun: 1, longestStreak: 0 };
    }

    // Stockholm-dagen, inte UTC-dagen: 00:30 svensk tid är fortfarande gårdagen i UTC (runs.date är Stockholm-dagen).
    return {
      currentStreak: currentStreak(days, stockholmDay(new Date())),
      streakDayForRun: newRunDate ? streakDayForRun(days, newRunDate) : 1,
      longestStreak: longestStreak(days),
    };
  }

  /**
   * Uppdaterar användarens streak-information i databasen.
   *
   * Pack News (ADR 008): nattjobbet är det enda stället som upptäcker en streak som dött av att
   * användaren slutat springa. Föregående current_streak läses före uppdateringen; är den ≥ T
   * (lägsta days i streak_multipliers) och den nya 0 loggas streak_broken. calculateUserTotals
   * loggar INTE streak_broken — en streak som sjunker av en raderad runda är datakorrigering.
   */
  static async updateUserStreak(userId: string): Promise<void> {
    const streakResult = await this.calculateUserStreaks(userId);

    const supabase = getSupabaseClient();
    const { data: before, error: beforeError } = await supabase
      .from('users')
      .select('current_streak, group_id')
      .eq('id', userId)
      .single();

    // PGRST116 = användaren finns inte (då finns inget att uppdatera). Andra fel hade tyst släckt streak_broken-loggen.
    if (beforeError && beforeError.code !== 'PGRST116') {
      logger.error('Error fetching user streak before update:', beforeError);
      throw new Error(`Failed to fetch current streak (user ${userId}): ${beforeError.message}`);
    }

    const { error } = await supabase
      .from('users')
      .update({
        current_streak: streakResult.currentStreak,
        longest_streak: streakResult.longestStreak
      })
      .eq('id', userId);

    if (error) {
      // Kastas så att schedulern räknar användaren som misslyckad (och inte loggar streak_broken för en streak som aldrig skrevs).
      logger.error('Error updating user streak:', error);
      throw new Error(`Failed to update streak (user ${userId}): ${error.message}`);
    }

    await this.recordStreakBroken(userId, before?.current_streak, streakResult.currentStreak, before?.group_id);
  }

  /** Icke-kastande: loggen får aldrig fälla nattjobbet. */
  private static async recordStreakBroken(
    userId: string, prevStreak: number | null | undefined, newStreak: number, groupId: string | null | undefined,
  ): Promise<void> {
    try {
      if (!groupId || typeof prevStreak !== 'number' || prevStreak <= 0 || newStreak !== 0) return;

      const { streak_multipliers } = await getXpConfig();
      if (!isStreakBroken(prevStreak, newStreak, streakBrokenThreshold(streak_multipliers))) return;

      const { data: lastRuns } = await getSupabaseClient()
        .from('runs')
        .select('date')
        .eq('user_id', userId)
        .order('date', { ascending: false })
        .limit(1);
      const lastRunDate: string | undefined = lastRuns?.[0]?.date;
      if (!lastRunDate) return; // inga rundor kvar → streaken sjönk av en radering, inte av uppehåll

      await recordActivity(buildStreakBrokenDraft(userId, groupId, prevStreak, lastRunDate));
    } catch (e) {
      logger.error('❌ [StreakService] Failed to record streak_broken:', e);
    }
  }
}
