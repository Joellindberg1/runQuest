// XP calculation functions — local copy for Railway deployment
// Railway deploys apps/backend in isolation; packages/shared is not available.
// This file mirrors packages/shared/src/xpCalculation.ts.
// TODO: configure Railway to deploy the full monorepo and remove this file.

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

function calculateRunXP(distanceKm: number, settings: AdminSettings): XPResult {
  const safeSettings = {
    base_xp: settings?.base_xp || 15,
    xp_per_km: settings?.xp_per_km || 2,
    bonus_5km: settings?.bonus_5km || 5,
    bonus_10km: settings?.bonus_10km || 15,
    bonus_15km: settings?.bonus_15km || 25,
    bonus_20km: settings?.bonus_20km || 50,
    min_run_distance: settings?.min_run_distance || 1.0
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

function calculateStreakMultiplier(streakDay: number, multipliers: StreakMultiplier[]): number {
  if (!streakDay || streakDay <= 0) return 1.0;
  if (!multipliers || !Array.isArray(multipliers) || multipliers.length === 0) return 1.0;

  let currentMultiplier = 1.0;
  for (const mult of multipliers) {
    if (streakDay >= mult.days) {
      currentMultiplier = mult.multiplier;
    }
  }
  return currentMultiplier;
}

export function calculateCompleteRunXP(
  distanceKm: number,
  streakDay: number,
  settings: AdminSettings,
  multipliers: StreakMultiplier[]
): CompleteXPResult {
  const xpResult = calculateRunXP(distanceKm, settings);
  const multiplier = calculateStreakMultiplier(streakDay, multipliers);
  const multipliedXP = (xpResult.baseXP + xpResult.kmXP) * multiplier;
  const streakBonus = multipliedXP - (xpResult.baseXP + xpResult.kmXP);
  const finalXP = Math.floor(multipliedXP + xpResult.distanceBonus);

  return {
    baseXP: xpResult.baseXP,
    kmXP: xpResult.kmXP,
    distanceBonus: xpResult.distanceBonus,
    totalXP: xpResult.totalXP,
    streakBonus: Math.floor(streakBonus),
    multiplier,
    finalXP,
    breakdown: {
      base: `Base XP: ${xpResult.baseXP}`,
      km: `KM XP: ${xpResult.kmXP}`,
      distance: `Distance Bonus: ${xpResult.distanceBonus}`,
      streak: `Streak Bonus: ${streakBonus} (${multiplier}x on ${xpResult.baseXP + xpResult.kmXP} XP)`,
      total: `Final XP: ${finalXP}`
    }
  };
}
