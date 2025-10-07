
import { supabase } from '@/integrations/supabase/client'
import { RunData, ProcessedRun } from '@/types/run'
import { xpCalculationService } from './xpCalculationService'
import { streakCalculationService } from './streakCalculationService'
import { titleService } from './titleService' // Using title service via backend API
import { userService } from './userService'
import { isAbortError, handleError, withErrorHandling } from '@/utils/errorHandling'

// Request queuing to prevent concurrent recalculations per user
const userOperationQueues = new Map<string, Promise<any>>()

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
    const baseXP = settings.base_xp ?? 0
    const kmXP = runData.distance * (settings.xp_per_km ?? 0)
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
    // Ensure only one save operation per user at a time to prevent race conditions
    const existingOperation = userOperationQueues.get(userId)
    if (existingOperation) {
      console.log('⏳ Waiting for existing operation to complete for user:', userId)
      await existingOperation
    }
    
    // Create new operation promise
    const operation = this.performSaveRun(userId, processedRun)
    userOperationQueues.set(userId, operation)
    
    try {
      return await operation
    } finally {
      // Clean up completed operation
      userOperationQueues.delete(userId)
    }
  },

  async performSaveRun(userId: string, processedRun: ProcessedRun) {
    console.log('Saving run to database:', { userId, processedRun })
    
    try {
      // Database insert operation
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
        console.error('Database insert failed:', error)
        throw new Error(`Failed to save run: ${error.message}`)
      }
      
      console.log('Run saved successfully:', data)
      
      // Ensure all follow-up operations complete successfully
      try {
        await this.recalculateRunsFromDate(userId, processedRun.date)
        await this.updateUserTotals(userId)
      } catch (recalculationError) {
        console.error('Recalculation failed after saving run:', recalculationError)
        // Note: Run is already saved, but totals may be inconsistent
        const errorMessage = recalculationError instanceof Error ? recalculationError.message : 'Unknown recalculation error'
        throw new Error(`Run saved but recalculation failed: ${errorMessage}`)
      }
      
      return data
    } catch (error) {
      console.error('saveRun operation failed:', error)
      // Re-throw with more context for the caller
      const errorMessage = handleError(error, 'Run save operation')
      throw new Error(errorMessage)
    }
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
      
      // Recalculate XP components with null safety
      const baseXP = settings.base_xp ?? 0
      const kmXP = run.distance * (settings.xp_per_km ?? 0)
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
          base_xp: baseXP || undefined,
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
    
    // Prepare batch updates array with proper typing
    const batchUpdates: Array<{
      id: string
      xp_gained: number
      multiplier: number
      streak_day: number
      base_xp?: number
      km_xp: number
      distance_bonus: number
      streak_bonus: number
    }> = []
    
    for (let i = 0; i < sortedRuns.length; i++) {
      const run = sortedRuns[i]
      const runsBeforeThis = sortedRuns.slice(0, i)
      
      // Calculate streak for this run based on all previous runs
      const { streakDay, streakBonus } = streakCalculationService.calculateStreak(runsBeforeThis, run.date)
      const currentMultiplier = xpCalculationService.getStreakMultiplier(streakDay, multipliers)
      
      // Recalculate XP components with null safety
      const baseXP = settings.base_xp ?? 0
      const kmXP = run.distance * (settings.xp_per_km ?? 0)
      const distanceBonus = xpCalculationService.getDistanceBonus(run.distance, settings)
      
      // Apply multiplier to base and km XP only
      const multipliedXP = (baseXP + kmXP) * currentMultiplier
      const totalXP = Math.floor(multipliedXP + distanceBonus + streakBonus)
      
      // Add to batch update array instead of individual database call
      batchUpdates.push({
        id: run.id,
        xp_gained: totalXP,
        multiplier: currentMultiplier,
        streak_day: streakDay,
        base_xp: baseXP || undefined,
        km_xp: Math.floor(kmXP),
        distance_bonus: distanceBonus,
        streak_bonus: streakBonus
      })
      
      console.log(`✅ Calculated run ${run.id} with streak day ${streakDay}, multiplier ${currentMultiplier}, XP ${totalXP}`)
    }
    
    // Perform batch update instead of individual updates
    if (batchUpdates.length > 0) {
      console.log(`🚀 Performing batch update of ${batchUpdates.length} runs...`)
      
      // Use update operations for existing runs instead of upsert
      const updatePromises = batchUpdates.map(update => 
        supabase
          .from('runs')
          .update({
            xp_gained: update.xp_gained,
            multiplier: update.multiplier,
            streak_day: update.streak_day,
            base_xp: update.base_xp,
            km_xp: update.km_xp,
            distance_bonus: update.distance_bonus,
            streak_bonus: update.streak_bonus
          })
          .eq('id', update.id)
      )
      
      const results = await Promise.all(updatePromises)
      const errors = results.filter(result => result.error)
      
      if (errors.length > 0) {
        console.error('❌ Some batch updates failed:', errors)
        throw new Error(`Batch recalculation failed: ${errors.length} updates failed`)
      }
      
      console.log(`✅ Successfully batch updated ${batchUpdates.length} runs`)
    }
  },

  async updateUserTotals(userId: string) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => {
      console.log('⏰ updateUserTotals timeout - aborting request')
      controller.abort()
    }, 15000) // 15 second timeout
    
    try {
      console.log('🔄 Triggering backend user totals recalculation...');
      
      // Call backend API to recalculate totals and trigger title system
      const backendApi = (await import('./backendApi')).default;
      const response = await backendApi.authenticatedRequest('/auth/recalculate-totals', {
        method: 'POST',
        signal: controller.signal // Add abort signal for cleanup
      });
      
      if (response.success) {
        console.log('✅ Backend recalculation completed - titles updated automatically');
        return;
      } else {
        console.error('❌ Backend recalculation failed:', response.error);
      }
    } catch (error) {
      if (isAbortError(error)) {
        console.log('🔄 Request was aborted due to timeout - cleaned up successfully')
        throw new Error('User totals update timed out')
      }
      console.error('❌ Error calling backend recalculation:', error);
    } finally {
      // Always clean up timeout
      clearTimeout(timeoutId)
    }
    
    // Always run fallback to ensure data consistency
    console.log('🔄 Running fallback: direct user totals update + title trigger...');
    
    const fallbackController = new AbortController()
    const fallbackTimeoutId = setTimeout(() => fallbackController.abort(), 10000) // 10s for fallback
    
    try {
      const runs = await userService.getUserRuns(userId);
      await userService.updateUserTotals(userId, runs);
      console.log('✅ User totals updated via fallback');
      
      await this.triggerTitleRecalculation();
      console.log('✅ Title recalculation triggered via fallback');
      
    } catch (fallbackError) {
      if (isAbortError(fallbackError)) {
        console.log('🔄 Fallback was aborted due to timeout - cleaned up successfully')
        throw new Error('Fallback user totals update timed out')
      }
      console.error('❌ Fallback also failed:', fallbackError);
      const errorMessage = handleError(fallbackError, 'Fallback user totals update')
      throw new Error(`Both primary and fallback user totals update failed: ${errorMessage}`)
    } finally {
      // Always clean up fallback timeout
      clearTimeout(fallbackTimeoutId)
    }
  },

  async triggerTitleRecalculation() {
    try {
      console.log('🏆 Triggering title recalculation via backend...');
      
      const response = await fetch('http://localhost:3001/api/titles/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        const result = await response.json();
        console.log('✅ Title recalculation triggered successfully:', result.message);
        return true;
      } else {
        const errorText = await response.text();
        console.error('❌ Title recalculation failed:', response.status, errorText);
        return false;
      }
    } catch (error) {
      console.error('❌ Error triggering title recalculation:', error);
      return false;
    }
  },

  async checkAndUpdateUserTitles(userId: string, runs: any[], totalKm: number, longestStreak: number) {
    return titleService.checkAndUpdateUserTitles(userId, runs, totalKm, longestStreak)
  },

  async checkTitle(titleName: string, userId: string, userValue: number, minRequirement: number, earnedAt: string, allRuns: any[]) {
    // This method is deprecated in the new optimized system
    console.log('📦 Legacy checkTitle() called - titles are now updated automatically on backend');
    return Promise.resolve();
  },

  async getTitleHolders() {
    return titleService.getTitleHolders()
  },

  async getUserTitles(userId: string) {
    return titleService.getUserTitles(userId)
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
