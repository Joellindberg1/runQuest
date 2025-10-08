// Quick fix script to manually trigger totals update for a user
// Run this after adding a manual run to ensure totals are correct

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

// Load environment variables
config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fixUserTotals(userName) {
  try {
    console.log(`🔧 FIXING TOTALS FOR: ${userName}...\n`);

    // 1. Find user
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, name, email, total_xp, total_km, current_level')
      .eq('name', userName)
      .single();

    if (userError || !user) {
      console.error('❌ Could not find user:', userName);
      return;
    }

    console.log(`👤 Found user: ${user.name} (${user.email})`);
    console.log(`Before: ${user.total_xp} XP, ${user.total_km} km, Level ${user.current_level}`);

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

    // 3. Calculate correct totals
    const correctTotalXP = runs.reduce((sum, run) => sum + run.xp_gained, 0);
    const correctTotalKm = runs.reduce((sum, run) => sum + run.distance, 0);

    // 4. Calculate correct level
    const { data: levels } = await supabase
      .from('level_requirements')
      .select('level, xp_required')
      .order('level');
    
    let correctLevel = 1;
    for (const level of levels) {
      if (correctTotalXP >= level.xp_required) {
        correctLevel = level.level;
      }
    }

    // 5. Update user totals
    const { error: updateError } = await supabase
      .from('users')
      .update({
        total_xp: correctTotalXP,
        total_km: correctTotalKm,
        current_level: correctLevel,
        updated_at: new Date().toISOString()
      })
      .eq('id', user.id);

    if (updateError) {
      console.error('❌ Error updating totals:', updateError);
    } else {
      console.log(`✅ TOTALS FIXED!`);
      console.log(`After: ${correctTotalXP} XP, ${correctTotalKm} km, Level ${correctLevel}`);
      console.log(`Changes: +${correctTotalXP - user.total_xp} XP, +${correctTotalKm - user.total_km} km`);
    }

  } catch (error) {
    console.error('❌ Fix failed:', error);
  }
}

// Fix Joel's totals (replace with any user name as needed)
const userToFix = process.argv[2] || 'Joel Lindberg';
fixUserTotals(userToFix);