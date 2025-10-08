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
 * ✅ UNIFIED XP CALCULATION FUNCTION
 * This is the single source of truth for XP calculation
 * Used by both frontend manual runs and backend Strava imports
 */
export declare function calculateRunXP(distanceKm: number, settings: AdminSettings): XPCalculationResult;
/**
 * ✅ UNIFIED STREAK MULTIPLIER CALCULATION
 * Calculates streak multiplier based on streak day
 */
export declare function calculateStreakMultiplier(streakDay: number, multipliers: StreakMultiplier[]): number;
/**
 * ✅ COMPLETE RUN XP CALCULATION
 * Combines base XP calculation with streak multiplier
 */
export declare function calculateCompleteRunXP(distanceKm: number, streakDay: number, settings: AdminSettings, multipliers: StreakMultiplier[]): CompleteRunXP;
/**
 * ✅ VALIDATION FUNCTION
 * Validates that XP calculation was successful
 */
export declare function validateXPCalculation(distanceKm: number, result: XPCalculationResult | CompleteRunXP): {
    isValid: boolean;
    error?: string;
};
//# sourceMappingURL=xpCalculation.d.ts.map