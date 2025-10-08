// 🧮 Unified XP Calculation System
// Shared logic for consistent XP calculation across frontend and backend
// Ensures Strava imports and manual runs use identical calculation logic
/**
 * ✅ UNIFIED XP CALCULATION FUNCTION
 * This is the single source of truth for XP calculation
 * Used by both frontend manual runs and backend Strava imports
 */
export function calculateRunXP(distanceKm, settings) {
    console.log(`🧮 Calculating XP for ${distanceKm}km run...`);
    // Input validation with detailed logging
    if (!distanceKm || distanceKm <= 0) {
        console.warn(`⚠️ Invalid distance: ${distanceKm}km, returning 0 XP`);
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
    // Validate settings with robust fallbacks
    const safeSettings = {
        base_xp: settings?.base_xp ?? 15,
        xp_per_km: settings?.xp_per_km ?? 2,
        bonus_5km: settings?.bonus_5km ?? 5,
        bonus_10km: settings?.bonus_10km ?? 15,
        bonus_15km: settings?.bonus_15km ?? 25,
        bonus_20km: settings?.bonus_20km ?? 50,
        min_run_distance: settings?.min_run_distance ?? 1.0
    };
    console.log(`📊 Using settings:`, safeSettings);
    // Phase 1: Base XP calculation
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
    }
    else if (distanceKm >= 15) {
        distanceBonus = safeSettings.bonus_15km;
        bonusCalculation = `${distanceKm}km ≥ 15km → ${distanceBonus} bonus XP`;
    }
    else if (distanceKm >= 10) {
        distanceBonus = safeSettings.bonus_10km;
        bonusCalculation = `${distanceKm}km ≥ 10km → ${distanceBonus} bonus XP`;
    }
    else if (distanceKm >= 5) {
        distanceBonus = safeSettings.bonus_5km;
        bonusCalculation = `${distanceKm}km ≥ 5km → ${distanceBonus} bonus XP`;
    }
    else {
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
export function calculateStreakMultiplier(streakDay, multipliers) {
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
export function calculateCompleteRunXP(distanceKm, streakDay, settings, multipliers) {
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
        streakBonus: Math.floor(streakBonus),
        multiplier,
        finalXP,
        breakdown
    };
}
/**
 * ✅ VALIDATION FUNCTION
 * Validates that XP calculation was successful
 */
export function validateXPCalculation(distanceKm, result) {
    console.log(`🔍 Validating XP calculation for ${distanceKm}km...`);
    // Check if distance is valid
    if (!distanceKm || distanceKm <= 0) {
        return { isValid: false, error: 'Invalid distance provided' };
    }
    // Check if we got any XP for a valid distance
    const totalXP = 'finalXP' in result ? result.finalXP : result.totalXP;
    if (distanceKm >= 1.0 && totalXP <= 0) {
        return {
            isValid: false,
            error: `Run of ${distanceKm}km should generate XP but got ${totalXP}`
        };
    }
    // Check if result has required fields
    if (!result.baseXP && result.baseXP !== 0) {
        return { isValid: false, error: 'Missing baseXP in calculation result' };
    }
    if (!result.kmXP && result.kmXP !== 0) {
        return { isValid: false, error: 'Missing kmXP in calculation result' };
    }
    console.log(`✅ XP calculation validation passed: ${totalXP} XP for ${distanceKm}km`);
    return { isValid: true };
}
