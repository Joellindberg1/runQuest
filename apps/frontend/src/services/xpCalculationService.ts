
import { supabase } from '@/integrations/supabase/client'

export const xpCalculationService = {
  async getAdminSettings() {
    const { data, error } = await supabase
      .from('admin_settings')
      .select('*')
      .single()
    
    if (error) throw error
    return data
  },

  async getStreakMultipliers() {
    const { data, error } = await supabase
      .from('streak_multipliers')
      .select('*')
      .order('days')
    
    if (error) throw error
    return data
  },

  getDistanceBonus(distance: number, settings: any): number {
    if (distance >= 20) return settings.bonus_20km
    if (distance >= 15) return settings.bonus_15km
    if (distance >= 10) return settings.bonus_10km
    if (distance >= 5) return settings.bonus_5km
    return 0
  },

  getStreakMultiplier(streakDays: number, multipliers: any[]): number {
    let currentMultiplier = 1.0
    
    for (const mult of multipliers) {
      if (streakDays >= mult.days) {
        currentMultiplier = mult.multiplier
      }
    }
    
    return currentMultiplier
  }
}
