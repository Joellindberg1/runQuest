import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export class StreakService {
  /**
   * Beräknar streaks baserat på unika dagar, inte antal runs.
   * Hanterar runs som läggs in i efterhand korrekt.
   */
  static async calculateUserStreaks(userId, newRunDate = null) {
    // Hämta alla runs för användaren
    const { data: allRuns, error } = await supabase
      .from('runs')
      .select('date')
      .eq('user_id', userId)
      .order('date', { ascending: true });

    if (error) {
      console.error('Error fetching runs:', error);
      return { currentStreak: 0, streakDayForRun: 1, longestStreak: 0 };
    }

    // Om vi kollar en specifik run, inkludera den i beräkningen
    const runs = allRuns || [];
    if (newRunDate) {
      // Lägg till den nya runan temporärt för beräkning
      runs.push({ date: newRunDate });
    }

    // Skapa set av unika dagar (YYYY-MM-DD format)
    const uniqueDays = new Set(runs.map(run => run.date));
    const sortedDays = Array.from(uniqueDays).sort();

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
  static calculateLongestStreak(sortedDays) {
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
  static calculateCurrentStreak(sortedDays) {
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
  static calculateStreakDayForSpecificRun(sortedDays, targetDate) {
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
  static async updateUserStreak(userId) {
    const streakResult = await this.calculateUserStreaks(userId);
    
    const { error } = await supabase
      .from('users')
      .update({
        current_streak: streakResult.currentStreak,
        longest_streak: streakResult.longestStreak
      })
      .eq('id', userId);

    if (error) {
      console.error('Error updating user streak:', error);
    }
  }
}