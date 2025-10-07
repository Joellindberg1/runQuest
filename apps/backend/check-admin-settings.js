import dotenv from 'dotenv';
import { getSupabaseClient } from './src/config/database.ts';

// Load environment variables
dotenv.config();

async function checkAdminSettings() {
  console.log('🔍 CHECKING ADMIN SETTINGS');
  console.log('===========================');
  
  const supabase = getSupabaseClient();
  
  try {
    // Check if admin_settings table exists and has data
    const { data: settings, error } = await supabase
      .from('admin_settings')
      .select('*');

    if (error) {
      console.log('❌ ERROR fetching admin_settings:', error);
      console.log('❌ This is likely why XP calculation returns 0!');
      return;
    }

    if (!settings || settings.length === 0) {
      console.log('❌ admin_settings table is empty!');
      console.log('❌ This explains why XP calculation fails!');
      return;
    }

    console.log('✅ Admin settings found:');
    console.log(settings[0]);

    // Test XP calculation with current settings
    const distance = 3.47;
    const setting = settings[0];
    
    console.log('\n🧮 TESTING XP CALCULATION:');
    console.log('===========================');
    console.log('Distance:', distance, 'km');
    console.log('Min run distance:', setting.min_run_distance);
    console.log('Base XP rule:', distance >= setting.min_run_distance ? setting.base_xp : 0);
    console.log('KM XP rule:', Math.floor(distance * setting.xp_per_km));
    
    let distanceBonus = 0;
    if (distance >= 20) distanceBonus = setting.bonus_20km;
    else if (distance >= 15) distanceBonus = setting.bonus_15km;
    else if (distance >= 10) distanceBonus = setting.bonus_10km;
    else if (distance >= 5) distanceBonus = setting.bonus_5km;
    
    console.log('Distance bonus rule:', distanceBonus);
    
    const baseXP = distance >= setting.min_run_distance ? setting.base_xp : 0;
    const kmXP = Math.floor(distance * setting.xp_per_km);
    const totalXP = baseXP + kmXP + distanceBonus;
    
    console.log('\n🎯 CALCULATED RESULT:');
    console.log('=====================');
    console.log('Base XP:', baseXP);
    console.log('KM XP:', kmXP);
    console.log('Distance Bonus:', distanceBonus);
    console.log('Total XP:', totalXP);

  } catch (error) {
    console.error('❌ Error during analysis:', error);
  }
}

checkAdminSettings();