import dotenv from 'dotenv';
import { getSupabaseClient } from './src/config/database.ts';

// Load environment variables
dotenv.config();

async function testXPCalculationDirect() {
  console.log('🧮 TESTING XP CALCULATION DIRECTLY');
  console.log('===================================');
  
  const supabase = getSupabaseClient();
  
  try {
    // Simulate the exact same logic as calculateRunXP
    const distanceKm = 3.47;
    
    console.log('Step 1: Fetch admin settings...');
    const { data: settings, error } = await supabase
      .from('admin_settings')
      .select('base_xp, xp_per_km, bonus_5km, bonus_10km, bonus_15km, bonus_20km, min_run_distance')
      .single();
      
    if (error) {
      console.error('❌ Error fetching admin settings:', error);
      return;
    }
    
    console.log('✅ Settings fetched:', settings);
    
    console.log('\nStep 2: Calculate XP values...');
    
    // Base XP only if run meets minimum distance
    const baseXP = distanceKm >= settings.min_run_distance ? settings.base_xp : 0;
    
    // XP per kilometer
    const kmXP = Math.floor(distanceKm * settings.xp_per_km);
    
    // Distance bonus
    let distanceBonus = 0;
    if (distanceKm >= 20) distanceBonus = settings.bonus_20km;
    else if (distanceKm >= 15) distanceBonus = settings.bonus_15km;
    else if (distanceKm >= 10) distanceBonus = settings.bonus_10km;
    else if (distanceKm >= 5) distanceBonus = settings.bonus_5km;
    
    const totalXP = baseXP + kmXP + distanceBonus;
    
    console.log('📋 CALCULATION RESULTS:');
    console.log('=======================');
    console.log('Distance:', distanceKm, 'km');
    console.log('Min distance required:', settings.min_run_distance);
    console.log('Meets minimum?', distanceKm >= settings.min_run_distance);
    console.log('Base XP:', baseXP);
    console.log('KM XP (', distanceKm, 'x', settings.xp_per_km, '):', kmXP);
    console.log('Distance bonus:', distanceBonus);
    console.log('Total XP:', totalXP);
    
    if (totalXP === 0) {
      console.log('\n❌ PROBLEM: Total XP is 0!');
      console.log('This should NOT happen for a', distanceKm, 'km run');
    } else {
      console.log('\n✅ XP calculation works correctly');
      console.log('The problem must be during the Strava import process');
    }

  } catch (error) {
    console.error('❌ Error during test:', error);
  }
}

testXPCalculationDirect();