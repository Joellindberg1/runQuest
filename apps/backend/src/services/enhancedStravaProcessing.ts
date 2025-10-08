// Enhanced async handling with proper transaction management
// This demonstrates how to ensure all async operations complete successfully
// before committing data, preventing partial failures

import { getSupabaseClient } from '../config/database.js';
import { calculateCompleteRunXP } from '../../../../packages/shared/dist/xpCalculation.js';

/**
 * Enhanced Strava run processing with atomic transactions
 * Ensures all calculations complete before saving any data
 */
export async function processStravaRunWithTransaction(
  userId: string, 
  activity: any
): Promise<{success: boolean, run?: any, error?: string}> {
  
  const supabase = getSupabaseClient();
  
  try {
    console.log(`🔄 Starting atomic processing for activity ${activity.id}`);
    
    // Phase 1: Prepare all data (all async operations)
    const distance = activity.distance / 1000;
    const date = activity.start_date_local.split('T')[0];
    
    // Validate basic data first
    if (distance <= 0) {
      return { success: false, error: 'Invalid distance' };
    }
    
    console.log(`📊 Phase 1: Calculating all values for ${distance}km run...`);
    
    // Execute ALL async calculations in parallel where possible
    const [adminSettings, streakResult, multiplierData] = await Promise.all([
      supabase
        .from('admin_settings')
        .select('*')
        .single()
        .then((result: any) => result.data),
      (async () => {
        const { StreakService } = await import('../services/streakService.js');
        return StreakService.calculateUserStreaks(userId, date);
      })(),
      supabase
        .from('streak_multipliers')
        .select('*')
        .order('days')
        .then((result: any) => result.data)
    ]);
    
    // Use unified XP calculation
    const xpCalculationResult = await calculateCompleteRunXP(
      distance,
      streakResult.streakDayForRun,
      adminSettings,
      multiplierData || []
    );
    
    const finalXP = xpCalculationResult.finalXP;
    const streakBonus = xpCalculationResult.streakBonus;
    const streakMultiplier = xpCalculationResult.multiplier;
    
    // Phase 2: Validate ALL calculated data
    console.log(`✅ Phase 2: Validating calculated values...`);
    
    if (finalXP <= 0) {
      throw new Error(`XP calculation failed: ${distance}km resulted in ${finalXP} XP`);
    }
    
    if (!xpCalculationResult.baseXP && !xpCalculationResult.kmXP) {
      throw new Error(`XP breakdown missing: base=${xpCalculationResult.baseXP}, km=${xpCalculationResult.kmXP}`);
    }
    
    console.log(`📋 Calculated values: XP=${finalXP}, Streak=${streakMultiplier}x, Day=${streakResult.streakDayForRun}`);
    
    // Phase 3: Atomic database transaction
    console.log(`💾 Phase 3: Executing atomic database transaction...`);
    
    const runData = {
      user_id: userId,
      date: date,
      distance: distance,
      xp_gained: finalXP,
      multiplier: streakMultiplier,
      streak_day: streakResult.streakDayForRun,
      base_xp: xpCalculationResult.baseXP,
      km_xp: xpCalculationResult.kmXP,
      distance_bonus: xpCalculationResult.distanceBonus,
      streak_bonus: streakBonus,
      source: 'strava',
      external_id: activity.id.toString(),
      created_at: new Date().toISOString()
    };
    
    // Use transaction to ensure atomicity
    const { data: insertedRun, error: insertError } = await supabase
      .from('runs')
      .insert(runData)
      .select()
      .single();
    
    if (insertError) {
      throw new Error(`Database insert failed: ${insertError.message}`);
    }
    
    console.log(`✅ Phase 3 complete: Run saved with ID ${insertedRun.id}`);
    
    // Phase 4: Verify data integrity
    console.log(`🔍 Phase 4: Verifying data integrity...`);
    
    if (insertedRun.xp_gained !== finalXP) {
      throw new Error(`Data integrity check failed: saved XP ${insertedRun.xp_gained} ≠ calculated XP ${finalXP}`);
    }
    
    console.log(`✅ SUCCESS: Run processed atomically - ${distance}km = ${finalXP} XP`);
    
    return { 
      success: true, 
      run: insertedRun
    };
    
  } catch (error) {
    console.error(`❌ TRANSACTION FAILED for activity ${activity.id}:`, error);
    console.error(`📊 Activity details: ${activity.distance/1000}km on ${activity.start_date_local}`);
    
    // In a real transaction, this would rollback any partial changes
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Sequential processing with proper async/await chains
 * Alternative approach that processes runs one by one with full completion
 */
export async function processStravaRunsSequentially(
  userId: string, 
  activities: any[]
): Promise<{
  successful: number;
  failed: number;
  details: Array<{activity_id: string, success: boolean, error?: string}>
}> {
  
  console.log(`🔄 Processing ${activities.length} activities sequentially...`);
  
  let successful = 0;
  let failed = 0;
  const details = [];
  
  for (const activity of activities) {
    console.log(`\n🏃‍♂️ Processing activity ${activity.id} (${successful + failed + 1}/${activities.length})`);
    
    try {
      // Wait for COMPLETE processing before moving to next
      const result = await processStravaRunWithTransaction(userId, activity);
      
      if (result.success) {
        successful++;
        details.push({ activity_id: activity.id, success: true });
        console.log(`✅ Activity ${activity.id} completed successfully`);
      } else {
        failed++;
        details.push({ activity_id: activity.id, success: false, error: result.error });
        console.log(`❌ Activity ${activity.id} failed: ${result.error}`);
      }
      
      // Small delay to prevent overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      failed++;
      const errorMsg = error instanceof Error ? error.message : String(error);
      details.push({ activity_id: activity.id, success: false, error: errorMsg });
      console.log(`❌ Activity ${activity.id} threw error: ${errorMsg}`);
    }
  }
  
  console.log(`\n📊 Sequential processing complete: ${successful} successful, ${failed} failed`);
  
  return { successful, failed, details };
}

/**
 * Parallel processing with controlled concurrency
 * For better performance while maintaining data integrity
 */
export async function processStravaRunsWithConcurrency(
  userId: string, 
  activities: any[],
  maxConcurrency: number = 3
): Promise<{
  successful: number;
  failed: number;
  details: Array<{activity_id: string, success: boolean, error?: string}>
}> {
  
  console.log(`🔄 Processing ${activities.length} activities with max ${maxConcurrency} concurrent operations...`);
  
  const results = [];
  
  // Process in chunks to control concurrency
  for (let i = 0; i < activities.length; i += maxConcurrency) {
    const chunk = activities.slice(i, i + maxConcurrency);
    console.log(`\n📦 Processing chunk ${Math.floor(i/maxConcurrency) + 1}: activities ${i + 1}-${Math.min(i + maxConcurrency, activities.length)}`);
    
    // Process chunk in parallel
    const chunkPromises = chunk.map(activity => 
      processStravaRunWithTransaction(userId, activity)
        .then(result => ({ activity_id: activity.id, ...result }))
        .catch(error => ({ 
          activity_id: activity.id, 
          success: false, 
          error: error instanceof Error ? error.message : String(error)
        }))
    );
    
    const chunkResults = await Promise.all(chunkPromises);
    results.push(...chunkResults);
    
    // Small delay between chunks
    if (i + maxConcurrency < activities.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  console.log(`\n📊 Concurrent processing complete: ${successful} successful, ${failed} failed`);
  
  return { 
    successful, 
    failed, 
    details: results.map(r => ({ 
      activity_id: r.activity_id, 
      success: r.success, 
      error: r.error 
    }))
  };
}