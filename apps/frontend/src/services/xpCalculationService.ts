
import { supabase } from '@/integrations/supabase/client'
import type { AdminSettings, StreakMultiplier } from './types'

export const xpCalculationService = {
  async getAdminSettings(): Promise<AdminSettings> {
    const { data, error } = await supabase
      .from('admin_settings')
      .select('*')
      .single()
    
    if (error) throw error
    return data as AdminSettings
  },

  async getStreakMultipliers(): Promise<StreakMultiplier[]> {
    const { data, error } = await supabase
      .from('streak_multipliers')
      .select('*')
      .order('days')
    
    if (error) throw error
    return data as StreakMultiplier[]
  },

  getDistanceBonus(distance: number, settings: AdminSettings): number {
    if (distance >= 20) return settings.bonus_20km ?? 0
    if (distance >= 15) return settings.bonus_15km ?? 0
    if (distance >= 10) return settings.bonus_10km ?? 0
    if (distance >= 5) return settings.bonus_5km ?? 0
    return 0
  },

  getStreakMultiplier(streakDays: number, multipliers: StreakMultiplier[]): number {
    let currentMultiplier = 1.0
    
    for (const mult of multipliers) {
      if (streakDays >= mult.days) {
        currentMultiplier = mult.multiplier
      }
    }
    
    return currentMultiplier
  }
}
