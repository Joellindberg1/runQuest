
import { supabase } from '@/integrations/supabase/client'
import { RunData, ProcessedRun } from '@/types/run'
import { xpCalculationService } from './xpCalculationService'
import { streakCalculationService } from './streakCalculationService'
import { optimizedTitleService } from './optimizedTitleService' // Use new optimized service
import { userService } from './userService'

export const runService = {
  // Re-export methods from other services for backward compatibility
  async getAdminSettings() {
    return xpCalculationService.getAdminSettings()
  },

  async getStreakMultipliers() {
    return xpCalculationService.getStreakMultipliers()
  },

  async getUserFromLocalStorage() {
    return userService.getUserFromLocalStorage()
  },

  async getUserRuns(userId: string) {
    return userService.getUserRuns(userId)
  },

  async calculateRunXP(userId: string, runData: RunData): Promise<ProcessedRun> {
    const settings = await xpCalculationService.getAdminSettings()
    
    // This will be calculated after saving and recalculating all runs
    const baseXP = settings.base_xp
    const kmXP = runData.distance * settings.xp_per_km
    const distanceBonus = xpCalculationService.getDistanceBonus(runData.distance, settings)
    
    // Temporary values - will be recalculated after saving
    return {
      id: '', // Temporary, will be set by database
      user_id: userId,
      date: runData.date,
      distance: runData.distance,
      xp_gained: Math.floor(baseXP + kmXP + distanceBonus), // Temporary without multipliers
      multiplier: 1.0, // Temporary
      streak_day: 1, // Temporary
      base_xp: baseXP,
      km_xp: Math.floor(kmXP),
      distance_bonus: distanceBonus,
      streak_bonus: 0, // Temporary
      calculatedXP: {
        baseXP: baseXP,
        distanceXP: Math.floor(kmXP),
        distanceBonus: distanceBonus,
        streakBonus: 0,
        multiplier: 1.0,
        totalXP: Math.floor(baseXP + kmXP + distanceBonus)
      }
    }
  },

  calculateStreak(existingRuns: any[], newRunDate: string): { streakDay: number, streakBonus: number } {
    return streakCalculationService.calculateStreak(existingRuns, newRunDate)
  },

  getStreakMultiplier(streakDays: number, multipliers: any[]): number {
    return xpCalculationService.getStreakMultiplier(streakDays, multipliers)
  },

  getDistanceBonus(distance: number, settings: any): number {
    return xpCalculationService.getDistanceBonus(distance, settings)
  },

  async saveRun(userId: string, processedRun: ProcessedRun) {
    console.log('Saving run to database:', { userId, processedRun })
    
    const { data, error } = await supabase
      .from('runs')
      .insert({
        user_id: userId,
        date: processedRun.date,
        distance: processedRun.distance,
        xp_gained: processedRun.xp_gained,
        multiplier: processedRun.multiplier,
        streak_day: processedRun.streak_day,
        base_xp: processedRun.base_xp,
        km_xp: processedRun.km_xp,
        distance_bonus: processedRun.distance_bonus,
        streak_bonus: processedRun.streak_bonus
      })
      .select()
    
    if (error) {
      console.error('Error inserting run:', error)
      throw error
    }
    
    console.log('Run saved successfully:', data)
    
    // Optimized recalculation - only recalculate runs from the new run date onwards
    await this.recalculateRunsFromDate(userId, processedRun.date)
    await this.updateUserTotals(userId)
    
    return data
  },

  async recalculateRunsFromDate(userId: string, fromDate: string) {
    console.log('🔄 Recalculating runs from date:', fromDate, 'for user:', userId)
    
    const settings = await xpCalculationService.getAdminSettings()
    const multipliers = await xpCalculationService.getStreakMultipliers()
    
    // Get only runs from the new date onwards for faster processing
    const { data: runsToUpdate, error } = await supabase
      .from('runs')
      .select('*')
      .eq('user_id', userId)
      .gte('date', fromDate)
      .order('date', { ascending: true })
    
    if (error) {
      console.error('Error fetching runs to update:', error)
      return
    }

    if (!runsToUpdate || runsToUpdate.length === 0) {
      console.log('No runs found from the specified date onwards')
      return
    }

    // Get all runs before the fromDate to calculate proper streaks
    const { data: runsBefore, error: beforeError } = await supabase
      .from('runs')
      .select('*')
      .eq('user_id', userId)
      .lt('date', fromDate)
      .order('date', { ascending: true })
    
    if (beforeError) {
      console.error('Error fetching runs before date:', beforeError)
      return
    }
    
    const allRunsBefore = runsBefore || []
    
    console.log(`Recalculating ${runsToUpdate.length} runs starting from ${fromDate}`)
    
    for (let i = 0; i < runsToUpdate.length; i++) {
      const run = runsToUpdate[i]
      const runsBeforeThis = [...allRunsBefore, ...runsToUpdate.slice(0, i)]
      
      // Calculate streak for this run based on all previous runs
      const { streakDay, streakBonus } = streakCalculationService.calculateStreak(runsBeforeThis, run.date)
      const currentMultiplier = xpCalculationService.getStreakMultiplier(streakDay, multipliers)
      
      // Recalculate XP components
      const baseXP = settings.base_xp
      const kmXP = run.distance * settings.xp_per_km
      const distanceBonus = xpCalculationService.getDistanceBonus(run.distance, settings)
      
      // Apply multiplier to base and km XP only
      const multipliedXP = (baseXP + kmXP) * currentMultiplier
      const totalXP = Math.floor(multipliedXP + distanceBonus + streakBonus)
      
      // Update the run in database
      await supabase
        .from('runs')
        .update({
          xp_gained: totalXP,
          multiplier: currentMultiplier,
          streak_day: streakDay,
          base_xp: baseXP,
          km_xp: Math.floor(kmXP),
          distance_bonus: distanceBonus,
          streak_bonus: streakBonus
        })
        .eq('id', run.id)
      
      console.log(`✅ Updated run ${run.id} with streak day ${streakDay}, multiplier ${currentMultiplier}, XP ${totalXP}`)
    }
  },

  async recalculateAllRuns(userId: string) {
    console.log('🔄 Recalculating all runs for user:', userId)
    
    const settings = await xpCalculationService.getAdminSettings()
    const multipliers = await xpCalculationService.getStreakMultipliers()
    const allRuns = await userService.getUserRuns(userId)
    
    // Sort runs by date to calculate streaks correctly
    const sortedRuns = [...allRuns].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    
    for (let i = 0; i < sortedRuns.length; i++) {
      const run = sortedRuns[i]
      const runsBeforeThis = sortedRuns.slice(0, i)
      
      // Calculate streak for this run based on all previous runs
      const { streakDay, streakBonus } = streakCalculationService.calculateStreak(runsBeforeThis, run.date)
      const currentMultiplier = xpCalculationService.getStreakMultiplier(streakDay, multipliers)
      
      // Recalculate XP components
      const baseXP = settings.base_xp
      const kmXP = run.distance * settings.xp_per_km
      const distanceBonus = xpCalculationService.getDistanceBonus(run.distance, settings)
      
      // Apply multiplier to base and km XP only
      const multipliedXP = (baseXP + kmXP) * currentMultiplier
      const totalXP = Math.floor(multipliedXP + distanceBonus + streakBonus)
      
      // Update the run in database
      await supabase
        .from('runs')
        .update({
          xp_gained: totalXP,
          multiplier: currentMultiplier,
          streak_day: streakDay,
          base_xp: baseXP,
          km_xp: Math.floor(kmXP),
          distance_bonus: distanceBonus,
          streak_bonus: streakBonus
        })
        .eq('id', run.id)
      
      console.log(`✅ Updated run ${run.id} with streak day ${streakDay}, multiplier ${currentMultiplier}, XP ${totalXP}`)
    }
  },

  async updateUserTotals(userId: string) {
    const runs = await userService.getUserRuns(userId)
    await userService.updateUserTotals(userId, runs)
  },

  async checkAndUpdateUserTitles(userId: string, runs: any[], totalKm: number, longestStreak: number) {
    return optimizedTitleService.checkAndUpdateUserTitles(userId, runs, totalKm, longestStreak)
  },

  async checkTitle(titleName: string, userId: string, userValue: number, minRequirement: number, earnedAt: string, allRuns: any[]) {
    // This method is deprecated in the new optimized system
    console.log('📦 Legacy checkTitle() called - titles are now updated automatically on backend');
    return Promise.resolve();
  },

  async getTitleHolders() {
    return optimizedTitleService.getTitleHolders()
  },

  async getUserTitles(userId: string) {
    return optimizedTitleService.getUserTitles(userId)
  },

  async recalculateAllTitles() {
    console.log('🏆 Starting full title recalculation for all users...')
    
    try {
      // First, clear all current user titles to start fresh
      await supabase.from('user_titles').delete().gte('id', '00000000-0000-0000-0000-000000000000')
      console.log('✅ Cleared all existing user titles')

      // Get all users
      const { data: users, error: usersError } = await supabase
        .from('users')
        .select('id, name')

      if (usersError) {
        console.error('❌ Error fetching users:', usersError)
        return
      }

      // For each user, recalculate their titles based on current runs
      for (const user of users || []) {
        console.log(`🔍 Recalculating titles for user: ${user.name}`)
        
        const runs = await userService.getUserRuns(user.id)
        const totalKm = runs.reduce((sum, run) => sum + run.distance, 0)
        const longestStreak = streakCalculationService.calculateLongestStreak(runs)
        
        // Check and update titles for this user
        await this.checkAndUpdateUserTitles(user.id, runs, totalKm, longestStreak)
      }

      console.log('✅ Title recalculation completed for all users')
    } catch (error) {
      console.error('❌ Error during title recalculation:', error)
      throw error
    }
  },

  calculateLongestStreakUpToDate(runs: any[], cutoffDate: Date): number {
    return streakCalculationService.calculateLongestStreakUpToDate(runs, cutoffDate)
  },

  calculateWeekendAverageUpToDate(runs: any[], cutoffDate: Date): number {
    return streakCalculationService.calculateWeekendAverageUpToDate(runs, cutoffDate)
  },

  calculateWeekendAverage(runs: any[]) {
    return streakCalculationService.calculateWeekendAverage(runs)
  },

  calculateCurrentStreak(runs: any[]): number {
    return streakCalculationService.calculateCurrentStreak(runs)
  },

  calculateLongestStreak(runs: any[]): number {
    return streakCalculationService.calculateLongestStreak(runs)
  }
}

// Re-export types for backward compatibility
export type { RunData, ProcessedRun }
