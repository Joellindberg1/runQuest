import { levelService } from '../services/levelService.js';
import { getSupabaseClient } from '../config/database.js';

// Unified XP calculation using admin_settings
export async function calculateRunXP(distanceKm: number): Promise<{
  baseXP: number;
  kmXP: number;
  distanceBonus: number;
  totalXP: number;
}> {
  const supabase = getSupabaseClient();
  
  // Get admin settings for XP calculation
  const { data: settings, error } = await supabase
    .from('admin_settings')
    .select('base_xp, xp_per_km, bonus_5km, bonus_10km, bonus_15km, bonus_20km, min_run_distance')
    .single();
    
  if (error) {
    console.error('Error fetching admin settings:', error);
    // Fallback to default values
    const baseXP = distanceKm >= 1.6 ? 15 : 0;
    const kmXP = Math.floor(distanceKm * 2);
    const distanceBonus = getDistanceBonus(distanceKm, {
      bonus_5km: 5,
      bonus_10km: 15,
      bonus_15km: 25,
      bonus_20km: 50
    });
    return { baseXP, kmXP, distanceBonus, totalXP: baseXP + kmXP + distanceBonus };
  }
  
  // Base XP only if run meets minimum distance
  const baseXP = distanceKm >= settings.min_run_distance ? settings.base_xp : 0;
  
  // XP per kilometer
  const kmXP = Math.floor(distanceKm * settings.xp_per_km);
  
  // Distance bonus
  const distanceBonus = getDistanceBonus(distanceKm, settings);
  
  const totalXP = baseXP + kmXP + distanceBonus;
  
  return { baseXP, kmXP, distanceBonus, totalXP };
}

function getDistanceBonus(distance: number, settings: any): number {
  if (distance >= 20) return settings.bonus_20km;
  if (distance >= 15) return settings.bonus_15km;
  if (distance >= 10) return settings.bonus_10km;
  if (distance >= 5) return settings.bonus_5km;
  return 0;
}

// Legacy function for backward compatibility - now uses unified calculation
export async function calculateRunXPLegacy(distanceKm: number): Promise<number> {
  const result = await calculateRunXP(distanceKm);
  return result.totalXP;
}

export function metersToKm(meters: number): number {
  return meters / 1000;
}

export async function getLevelFromXP(totalXP: number): Promise<number> {
  return levelService.getLevelFromXP(totalXP);
}

export async function getXPForLevel(level: number): Promise<number> {
  return levelService.getXPForLevel(level);
}

export async function getLevelProgress(totalXP: number) {
  return levelService.getLevelProgress(totalXP);
}