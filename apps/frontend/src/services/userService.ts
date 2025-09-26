
import { supabase } from '@/integrations/supabase/client'
import { streakCalculationService } from './streakCalculationService'

export const userService = {
  async getUserFromLocalStorage() {
    const storedUser = localStorage.getItem('runquest_user')
    if (storedUser) {
      return JSON.parse(storedUser)
    }
    return null
  },

  async getUserRuns(userId: string) {
    const { data, error } = await supabase
      .from('runs')
      .select('*')
      .eq('user_id', userId)
      .order('date', { ascending: false })
    
    if (error) throw error
    return data
  },

  async updateUserTotals(userId: string, runs: any[]) {
    console.log('🔄 Starting updateUserTotals for user:', userId)
    
    const { data: levels, error: levelsError } = await supabase
      .from('level_requirements')
      .select('*')
      .order('level')
    
    if (levelsError) throw levelsError
    
    const totalXP = runs.reduce((sum, run) => sum + run.xp_gained, 0)
    const totalKm = runs.reduce((sum, run) => sum + run.distance, 0)
    
    let currentLevel = 1
    for (const level of levels) {
      if (totalXP >= level.xp_required) {
        currentLevel = level.level
      }
    }
    
    const currentStreak = streakCalculationService.calculateCurrentStreak(runs)
    const longestStreak = streakCalculationService.calculateLongestStreak(runs)
    
    console.log('📊 User stats calculated:', {
      totalXP,
      totalKm,
      currentLevel,
      currentStreak,
      longestStreak
    })
    
    const { error } = await supabase
      .from('users')
      .update({
        total_xp: totalXP,
        current_level: currentLevel,
        total_km: totalKm,
        current_streak: currentStreak,
        longest_streak: longestStreak,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId)
    
    if (error) throw error

    // Check if user qualifies for any titles after stats update
    const { titleService } = await import('./titleService')
    await titleService.checkAndUpdateUserTitles(userId, runs, totalKm, longestStreak)
  }
}
