// Unified XP Calculation System
// Shared logic for consistent XP calculation across frontend and backend.
// Ensures Strava imports and manual runs use identical calculation logic.

export interface AdminSettings {
  base_xp: number;
  xp_per_km: number;
  bonus_5km: number;
  bonus_10km: number;
  bonus_15km: number;
  bonus_20km: number;
  min_run_distance: number;
}

export interface StreakMultiplier {
  days: number;
  multiplier: number;
}

export interface XPCalculationResult {
  baseXP: number;
  kmXP: number;
  distanceBonus: number;
  totalXP: number;
  breakdown: {
    baseCalculation: string;
    kmCalculation: string;
    bonusCalculation: string;
    totalCalculation: string;
  };
}

export interface StreakCalculationResult {
  streakDay: number;
  multiplier: number;
  streakBonus: number;
  calculation: string;
}

export interface CompleteRunXP {
  baseXP: number;
  kmXP: number;
  distanceBonus: number;
  streakBonus: number;
  multiplier: number;
  finalXP: number;
  breakdown: {
    base: string;
    km: string;
    distance: string;
    streak: string;
    total: string;
  };
}

/**
 * Single source of truth for XP calculation.
 * Used by both frontend manual runs and backend Strava imports.
 */
export function calculateRunXP(
  distanceKm: number,
  settings: AdminSettings
): XPCalculationResult {
  if (!distanceKm || distanceKm <= 0) {
    return {
      baseXP: 0,
      kmXP: 0,
      distanceBonus: 0,
      totalXP: 0,
      breakdown: {
        baseCalculation: 'Invalid distance: 0km',
        kmCalculation: 'Invalid distance: 0km',
        bonusCalculation: 'Invalid distance: 0km',
        totalCalculation: 'Total: 0 XP'
      }
    };
  }

  const safeSettings = {
    base_xp: settings?.base_xp ?? 15,
    xp_per_km: settings?.xp_per_km ?? 2,
    bonus_5km: settings?.bonus_5km ?? 5,
    bonus_10km: settings?.bonus_10km ?? 15,
    bonus_15km: settings?.bonus_15km ?? 25,
    bonus_20km: settings?.bonus_20km ?? 50,
    min_run_distance: settings?.min_run_distance ?? 1.0
  };

  const meetsMinimum = distanceKm >= safeSettings.min_run_distance;
  const baseXP = meetsMinimum ? safeSettings.base_xp : 0;
  const baseCalculation = meetsMinimum
    ? `${distanceKm}km >= ${safeSettings.min_run_distance}km minimum → ${baseXP} base XP`
    : `${distanceKm}km < ${safeSettings.min_run_distance}km minimum → 0 base XP`;

  const kmXP = Math.floor(distanceKm * safeSettings.xp_per_km);
  const kmCalculation = `${distanceKm}km × ${safeSettings.xp_per_km} XP/km = ${kmXP} XP`;

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

  const totalXP = baseXP + kmXP + distanceBonus;
  const totalCalculation = `${baseXP} (base) + ${kmXP} (km) + ${distanceBonus} (bonus) = ${totalXP} total XP`;

  return {
    baseXP,
    kmXP,
    distanceBonus,
    totalXP,
    breakdown: { baseCalculation, kmCalculation, bonusCalculation, totalCalculation }
  };
}

/**
 * Calculates streak multiplier based on streak day.
 * Returns 1.0 if no streak or no valid multipliers.
 */
export function calculateStreakMultiplier(
  streakDay: number,
  multipliers: StreakMultiplier[]
): number {
  if (!streakDay || streakDay <= 0) return 1.0;

  if (!multipliers || !Array.isArray(multipliers) || multipliers.length === 0) {
    return 1.0;
  }

  let currentMultiplier = 1.0;
  for (const mult of multipliers) {
    if (streakDay >= mult.days) {
      currentMultiplier = mult.multiplier;
    }
  }
  return currentMultiplier;
}

/**
 * Combines base XP calculation with streak multiplier and optional boost delta.
 */
export function calculateCompleteRunXP(
  distanceKm: number,
  streakDay: number,
  settings: AdminSettings,
  multipliers: StreakMultiplier[],
  boostDelta: number = 0
): CompleteRunXP {
  const xpResult   = calculateRunXP(distanceKm, settings);
  const multiplier = calculateStreakMultiplier(streakDay, multipliers) + boostDelta;

  const multipliedXP = (xpResult.baseXP + xpResult.kmXP) * multiplier;
  const streakBonus  = multipliedXP - (xpResult.baseXP + xpResult.kmXP);
  const finalXP      = Math.floor(multipliedXP + xpResult.distanceBonus);

  const breakdown = {
    base:     `Base XP: ${xpResult.baseXP}`,
    km:       `KM XP: ${xpResult.kmXP}`,
    distance: `Distance Bonus: ${xpResult.distanceBonus}`,
    streak:   `Streak Bonus: ${streakBonus} (${multiplier}x on ${xpResult.baseXP + xpResult.kmXP} XP)`,
    total:    `Final XP: ${finalXP}`
  };

  return {
    baseXP: xpResult.baseXP,
    kmXP: xpResult.kmXP,
    distanceBonus: xpResult.distanceBonus,
    streakBonus: Math.floor(streakBonus),
    multiplier,
    finalXP,
    breakdown
  };
}

/**
 * Validates that an XP calculation result is internally consistent.
 */
export function validateXPCalculation(
  distanceKm: number,
  result: XPCalculationResult | CompleteRunXP
): { isValid: boolean; error?: string } {
  if (!distanceKm || distanceKm <= 0) {
    return { isValid: false, error: 'Invalid distance provided' };
  }

  const totalXP = 'finalXP' in result ? result.finalXP : result.totalXP;

  if (distanceKm >= 1.0 && totalXP <= 0) {
    return {
      isValid: false,
      error: `Run of ${distanceKm}km should generate XP but got ${totalXP}`
    };
  }

  if (!result.baseXP && result.baseXP !== 0) {
    return { isValid: false, error: 'Missing baseXP in calculation result' };
  }

  if (!result.kmXP && result.kmXP !== 0) {
    return { isValid: false, error: 'Missing kmXP in calculation result' };
  }

  return { isValid: true };
}
