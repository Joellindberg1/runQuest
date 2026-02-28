import { getSupabaseClient } from '../config/database.js';
import { logger } from '../utils/logger.js';

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
      // TODO: replace with a shared backend logger utility when available
      logger.error('Error fetching runs:', error);
      return { currentStreak: 0, streakDayForRun: 1, longestStreak: 0 };
    }

    // Om vi kollar en specifik run, inkludera den i beräkningen
    const runs = allRuns || [];
    if (newRunDate) {
      // Lägg till den nya runan temporärt för beräkning
      runs.push({ date: newRunDate });
    }

    // Skapa set av unika dagar (YYYY-MM-DD format)
    const uniqueDays = new Set(runs.map((run: any) => run.date));
    const sortedDays = Array.from(uniqueDays).sort() as string[];

    if (sortedDays.length === 0) {
      return { currentStreak: 0, streakDayForRun: 1, longestStreak: 0 };
    }

    // Beräkna longest streak
    const longestStreak = this.calculateLongestStreak(sortedDays);

    // Beräkna current streak (från senaste dagen bakåt)
    const currentStreak = this.calculateCurrentStreak(sortedDays);

    // Beräkna streak day för specifik run (om angiven)
    let streakDayForRun = 1;
    if (newRunDate) {
      streakDayForRun = this.calculateStreakDayForSpecificRun(sortedDays, newRunDate);
    }

    return {
      currentStreak,
      streakDayForRun,
      longestStreak
    };
  }

  /**
   * Beräknar den längsta streaken i en lista av dagar
   */
  private static calculateLongestStreak(sortedDays: string[]): number {
    if (sortedDays.length === 0) return 0;

    let longestStreak = 1;
    let currentStreak = 1;

    for (let i = 1; i < sortedDays.length; i++) {
      const prevDate = new Date(sortedDays[i - 1]);
      const currDate = new Date(sortedDays[i]);
      
      const daysDiff = Math.floor(
        (currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysDiff === 1) {
        currentStreak++;
      } else {
        longestStreak = Math.max(longestStreak, currentStreak);
        currentStreak = 1;
      }
    }

    return Math.max(longestStreak, currentStreak);
  }

  /**
   * Beräknar nuvarande aktiv streak (från senaste dagen bakåt)
   * En streak är endast aktiv om den inkluderar idag eller igår
   */
  private static calculateCurrentStreak(sortedDays: string[]): number {
    if (sortedDays.length === 0) return 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    // Kontrollera om senaste run är idag eller igår
    const latestDay = sortedDays[sortedDays.length - 1];
    if (latestDay !== todayStr && latestDay !== yesterdayStr) {
      return 0; // Streak är bruten
    }

    // Räkna bakåt från senaste dagen
    let streak = 1;
    for (let i = sortedDays.length - 2; i >= 0; i--) {
      const currDate = new Date(sortedDays[i]);
      const nextDate = new Date(sortedDays[i + 1]);
      
      const daysDiff = Math.floor(
        (nextDate.getTime() - currDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysDiff === 1) {
        streak++;
      } else {
        break;
      }
    }

    return streak;
  }

  /**
   * Beräknar vilken streak-dag en specifik run representerar
   * Kollar hur många konsekutiva dagar som leder upp till och inkluderar denna dag
   */
  private static calculateStreakDayForSpecificRun(sortedDays: string[], targetDate: string): number {
    const targetIndex = sortedDays.indexOf(targetDate);
    if (targetIndex === -1) return 1;

    let streakDay = 1;
    
    // Räkna bakåt från target datum
    for (let i = targetIndex - 1; i >= 0; i--) {
      const currDate = new Date(sortedDays[i]);
      const nextDate = new Date(sortedDays[i + 1]);
      
      const daysDiff = Math.floor(
        (nextDate.getTime() - currDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysDiff === 1) {
        streakDay++;
      } else {
        break;
      }
    }

    return streakDay;
  }

  /**
   * Uppdaterar användarens streak-information i databasen
   */
  static async updateUserStreak(userId: string): Promise<void> {
    const streakResult = await this.calculateUserStreaks(userId);
    
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from('users')
      .update({
        current_streak: streakResult.currentStreak,
        longest_streak: streakResult.longestStreak
      })
      .eq('id', userId);

    if (error) {
      // TODO: replace with a shared backend logger utility when available
      logger.error('Error updating user streak:', error);
    }
  }

  /**
   * Testar streak-servicen med exempel data
   */
  static testStreakLogic() {
    logger.info('🧪 Testing Streak Logic...\n');

    // Test case 1: Karl's actual situation
    const karlDays = ['2025-09-30'];
    logger.info('Test 1 - Karl (only 2025-09-30):');
    logger.info('Days:', karlDays);
    logger.info('Longest streak:', this.calculateLongestStreak(karlDays));
    logger.info('Current streak:', this.calculateCurrentStreak(karlDays));
    logger.info('Streak day for 2025-09-30:', this.calculateStreakDayForSpecificRun(karlDays, '2025-09-30'));
    logger.info('');

    // Test case 2: Consecutive days
    const consecutiveDays = ['2025-09-28', '2025-09-29', '2025-09-30'];
    logger.info('Test 2 - Consecutive (28, 29, 30):');
    logger.info('Days:', consecutiveDays);
    logger.info('Longest streak:', this.calculateLongestStreak(consecutiveDays));
    logger.info('Current streak:', this.calculateCurrentStreak(consecutiveDays));
    logger.info('Streak day for 2025-09-30:', this.calculateStreakDayForSpecificRun(consecutiveDays, '2025-09-30'));
    logger.info('');

    // Test case 3: Adding run in retrospect
    const retroDays = ['2025-09-28', '2025-09-29', '2025-09-30', '2025-10-01'];
    logger.info('Test 3 - Adding runs retrospectively (28, 29, 30, 01):');
    logger.info('Days:', retroDays);
    logger.info('Longest streak:', this.calculateLongestStreak(retroDays));
    logger.info('Current streak:', this.calculateCurrentStreak(retroDays));
    logger.info('Streak day for 2025-09-31 (if added):', this.calculateStreakDayForSpecificRun(retroDays, '2025-09-31'));
    logger.info('');

    // Test case 4: Multiple runs same day
    const sameDayDays = ['2025-09-28', '2025-09-29', '2025-09-30']; // Multiple runs on same day still count as one
    logger.info('Test 4 - Multiple runs same day:');
    logger.info('Days:', sameDayDays);
    logger.info('Longest streak:', this.calculateLongestStreak(sameDayDays));
    logger.info('Current streak:', this.calculateCurrentStreak(sameDayDays));
    logger.info('');
  }
}