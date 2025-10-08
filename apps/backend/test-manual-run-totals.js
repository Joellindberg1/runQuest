// Test script to verify manual run totals update
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

// Load environment variables
config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testManualRunTotals() {
  try {
    console.log('🧪 TESTAR MANUELL RUN TOTALS UPDATE...\n');

    // 1. List all users to find the right one
    const { data: allUsers, error: usersError } = await supabase
      .from('users')
      .select('id, name, email, total_xp, total_km, current_level')
      .order('created_at', { ascending: false });

    if (usersError) {
      console.error('❌ Error fetching users:', usersError);
      return;
    }

    console.log('� ALL USERS:');
    allUsers.forEach((user, i) => {
      console.log(`${i+1}. ${user.name} (${user.email}) - ${user.total_xp} XP, ${user.total_km} km`);
    });

    // Use Joel Lindberg for testing since he reported the issue
    const user = allUsers.find(u => u.name === 'Joel Lindberg');
    if (!user) {
      console.log('❌ Joel Lindberg not found');
      return;
    }

    console.log(`\n🎯 TESTING USER: ${user.name} (${user.email})`);
    console.log(`Current totals: ${user.total_xp} XP, ${user.total_km} km, Level ${user.current_level}`);

    // 2. Get all runs for this user
    const { data: runs, error: runsError } = await supabase
      .from('runs')
      .select('id, date, distance, xp_gained')
      .eq('user_id', user.id)
      .order('date', { ascending: false });

    if (runsError) {
      console.error('❌ Error fetching runs:', runsError);
      return;
    }

    console.log(`\n🏃 RECENT RUNS (${runs.length} total):`);
    runs.slice(0, 5).forEach((run, i) => {
      console.log(`${i+1}. ${run.date}: ${run.distance}km → ${run.xp_gained} XP`);
    });

    // 3. Calculate manual totals
    const manualTotalXP = runs.reduce((sum, run) => sum + run.xp_gained, 0);
    const manualTotalKm = runs.reduce((sum, run) => sum + run.distance, 0);

    console.log(`\n🧮 MANUAL CALCULATION:`);
    console.log(`Total XP: ${manualTotalXP} (Database shows: ${user.total_xp})`);
    console.log(`Total KM: ${manualTotalKm} (Database shows: ${user.total_km})`);
    
    // 4. Check for discrepancy
    const xpDiscrepancy = manualTotalXP - user.total_xp;
    const kmDiscrepancy = manualTotalKm - user.total_km;

    if (xpDiscrepancy !== 0 || kmDiscrepancy !== 0) {
      console.log(`\n❌ DISCREPANCY FOUND!`);
      console.log(`XP difference: ${xpDiscrepancy}`);
      console.log(`KM difference: ${kmDiscrepancy}`);
      
      // 5. Force update totals manually
      console.log(`\n🔧 FORCING TOTALS UPDATE...`);
      
      // Calculate level
      const { data: levels } = await supabase
        .from('level_requirements')
        .select('level, xp_required')
        .order('level');
      
      let currentLevel = 1;
      for (const level of levels) {
        if (manualTotalXP >= level.xp_required) {
          currentLevel = level.level;
        }
      }
      
      const { error: updateError } = await supabase
        .from('users')
        .update({
          total_xp: manualTotalXP,
          total_km: manualTotalKm,
          current_level: currentLevel,
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id);
      
      if (updateError) {
        console.error('❌ Error updating totals:', updateError);
      } else {
        console.log(`✅ TOTALS FIXED!`);
        console.log(`New: ${manualTotalXP} XP, ${manualTotalKm} km, Level ${currentLevel}`);
      }
    } else {
      console.log(`\n✅ NO DISCREPANCY - Totals are correct!`);
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testManualRunTotals();