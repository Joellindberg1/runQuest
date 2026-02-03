// Standalone XP calculation functions for production deployment
// Copied from packages/shared to avoid import path issues

interface AdminSettings {
  base_xp: number;
  xp_per_km: number;
  bonus_5km: number;
  bonus_10km: number;
  bonus_15km: number;
  bonus_20km: number;
  min_run_distance: number;
}

interface StreakMultiplier {
  days: number;
  multiplier: number;
}

interface XPResult {
  baseXP: number;
  kmXP: number;
  distanceBonus: number;
  totalXP: number;
  breakdown?: {
    baseCalculation: string;
    kmCalculation: string;
    bonusCalculation: string;
    totalCalculation: string;
  };
}

interface CompleteXPResult {
  baseXP: number;
  kmXP: number;
  distanceBonus: number;
  totalXP: number;
  streakBonus: number;
  multiplier: number;
  finalXP: number;
  breakdown?: {
    base: string;
    km: string;
    distance: string;
    streak: string;
    total: string;
  };
}

/**
 * ✅ UNIFIED BASE XP CALCULATION
 * Calculates XP for a run based on distance and admin settings
 */
function calculateRunXP(distanceKm: number, settings: AdminSettings): XPResult {
  console.log(`🏃 Calculating base XP for ${distanceKm}km run...`);
  
  // Ensure we have valid settings with correct defaults matching admin_settings
  const safeSettings = {
    base_xp: settings?.base_xp || 15,
    xp_per_km: settings?.xp_per_km || 2,
    bonus_5km: settings?.bonus_5km || 5,      // Correct: 5 XP for 5km+
    bonus_10km: settings?.bonus_10km || 15,   // Correct: 15 XP for 10km+
    bonus_15km: settings?.bonus_15km || 25,   // Correct: 25 XP for 15km+
    bonus_20km: settings?.bonus_20km || 50,   // Correct: 50 XP for 20km+
    min_run_distance: settings?.min_run_distance || 1.0
  };

  console.log(`🔧 Using settings:`, safeSettings);

  // Phase 1: Base XP calculation (only if meets minimum distance)
  const meetsMinimum = distanceKm >= safeSettings.min_run_distance;
  const baseXP = meetsMinimum ? safeSettings.base_xp : 0;
  
  const baseCalculation = meetsMinimum 
    ? `${distanceKm}km >= ${safeSettings.min_run_distance}km minimum → ${baseXP} base XP`
    : `${distanceKm}km < ${safeSettings.min_run_distance}km minimum → 0 base XP`;

  console.log(`✅ Base XP: ${baseCalculation}`);

  // Phase 2: Distance XP calculation (per kilometer)
  const kmXP = Math.floor(distanceKm * safeSettings.xp_per_km);
  const kmCalculation = `${distanceKm}km × ${safeSettings.xp_per_km} XP/km = ${kmXP} XP`;

  console.log(`✅ KM XP: ${kmCalculation}`);

  // Phase 3: Distance bonus calculation
  let distanceBonus = 0;
  let bonusCalculation = '';

  if (distanceKm >= 20) {
    distanceBonus = safeSettings.bonus_20km;
    bonusCalculation = `${distanceKm}km ≥ 20km → ${distanceBonus} bonus XP`;
  } else if (distanceKm >= 15) {
    distanceBonus = safeSettings.bonus_15km;
    bonusCalculation = `${distanceKm}km ≥ 15km → ${distanceBonus} bonus XP`;
  } else if (distanceKm >= 10) {
    distanceBonus = safeSettings.bonus_10km;
    bonusCalculation = `${distanceKm}km ≥ 10km → ${distanceBonus} bonus XP`;
  } else if (distanceKm >= 5) {
    distanceBonus = safeSettings.bonus_5km;
    bonusCalculation = `${distanceKm}km ≥ 5km → ${distanceBonus} bonus XP`;
  } else {
    bonusCalculation = `${distanceKm}km < 5km → 0 bonus XP`;
  }

  console.log(`✅ Distance Bonus: ${bonusCalculation}`);

  // Phase 4: Total calculation
  const totalXP = baseXP + kmXP + distanceBonus;
  const totalCalculation = `${baseXP} (base) + ${kmXP} (km) + ${distanceBonus} (bonus) = ${totalXP} total XP`;

  console.log(`🎯 Final Result: ${totalCalculation}`);

  return {
    baseXP,
    kmXP,
    distanceBonus,
    totalXP,
    breakdown: {
      baseCalculation,
      kmCalculation,
      bonusCalculation,
      totalCalculation
    }
  };
}

/**
 * ✅ UNIFIED STREAK MULTIPLIER CALCULATION
 * Calculates streak multiplier based on streak day
 */
function calculateStreakMultiplier(streakDay: number, multipliers: StreakMultiplier[]): number {
  console.log(`🔥 Calculating streak multiplier for day ${streakDay}...`);
  console.log(`🔧 Multipliers received:`, typeof multipliers, Array.isArray(multipliers), multipliers?.length || 'undefined');
  
  if (!streakDay || streakDay <= 0) {
    console.log(`📍 Streak day ${streakDay} → 1.0x multiplier (no streak)`);
    return 1.0;
  }

  if (!multipliers || !Array.isArray(multipliers) || multipliers.length === 0) {
    console.warn(`⚠️ No valid multipliers found (${typeof multipliers}, isArray: ${Array.isArray(multipliers)}), using default 1.0x`);
    return 1.0;
  }

  // Find the highest applicable multiplier
  let currentMultiplier = 1.0;
  
  for (const mult of multipliers) {
    if (streakDay >= mult.days) {
      currentMultiplier = mult.multiplier;
      console.log(`📈 Day ${streakDay} ≥ ${mult.days} days → ${mult.multiplier}x multiplier`);
    }
  }

  console.log(`🎯 Final multiplier: ${currentMultiplier}x`);
  return currentMultiplier;
}

/**
 * ✅ COMPLETE RUN XP CALCULATION
 * Combines base XP calculation with streak multiplier
 */
export function calculateCompleteRunXP(
  distanceKm: number, 
  streakDay: number, 
  settings: AdminSettings, 
  multipliers: StreakMultiplier[]
): CompleteXPResult {
  console.log(`🏃 Complete XP calculation for ${distanceKm}km run on streak day ${streakDay}`);
  
  // Phase 1: Calculate base XP
  const xpResult = calculateRunXP(distanceKm, settings);
  
  // Phase 2: Calculate streak multiplier
  const multiplier = calculateStreakMultiplier(streakDay, multipliers);
  
  // Phase 3: Apply multiplier to base + km XP only (not distance bonus)
  const multipliedXP = (xpResult.baseXP + xpResult.kmXP) * multiplier;
  const streakBonus = multipliedXP - (xpResult.baseXP + xpResult.kmXP);
  
  // Phase 4: Calculate final XP
  const finalXP = Math.floor(multipliedXP + xpResult.distanceBonus);
  
  const breakdown = {
    base: `Base XP: ${xpResult.baseXP}`,
    km: `KM XP: ${xpResult.kmXP}`,
    distance: `Distance Bonus: ${xpResult.distanceBonus}`,
    streak: `Streak Bonus: ${streakBonus} (${multiplier}x on ${xpResult.baseXP + xpResult.kmXP} XP)`,
    total: `Final XP: ${finalXP}`
  };

  console.log(`🎯 Complete calculation:`, breakdown);

  return {
    baseXP: xpResult.baseXP,
    kmXP: xpResult.kmXP,
    distanceBonus: xpResult.distanceBonus,
    totalXP: xpResult.totalXP,
    streakBonus: Math.floor(streakBonus),
    multiplier,
    finalXP,
    breakdown
  };
}