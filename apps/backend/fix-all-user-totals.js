import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
dotenv.config();

function getSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase configuration');
  }
  
  const client = createClient(supabaseUrl, supabaseServiceKey);
  return client;
}

async function fixAllUserTotals() {
  try {
    const supabase = getSupabaseClient();
    
    console.log('🔧 FIXING ALL USER TOTALS');
    console.log('=========================');
    
    // Get all users
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('id, name, total_xp, total_km')
      .order('name');
    
    if (usersError) {
      console.error('❌ Error fetching users:', usersError);
      return;
    }
    
    console.log(`👥 Found ${users.length} users to check and fix:`);
    
    let fixedCount = 0;
    
    for (const user of users) {
      console.log(`\n📊 Checking ${user.name}...`);
      
      // Get all runs for this user
      const { data: runs, error: runsError } = await supabase
        .from('runs')
        .select('xp_gained, distance')
        .eq('user_id', user.id);
      
      if (runsError) {
        console.error(`❌ Error fetching runs for ${user.name}:`, runsError);
        continue;
      }
      
      // Calculate correct totals
      const calculatedXP = runs?.reduce((sum, run) => sum + (run.xp_gained || 0), 0) || 0;
      const calculatedKM = runs?.reduce((sum, run) => sum + (run.distance || 0), 0) || 0;
      
      // Check if update is needed
      const xpMatch = user.total_xp === calculatedXP;
      const kmMatch = Math.abs(user.total_km - calculatedKM) < 0.01;
      
      console.log(`  Current: ${user.total_xp} XP, ${user.total_km} km`);
      console.log(`  Calculated: ${calculatedXP} XP, ${calculatedKM.toFixed(2)} km`);
      console.log(`  Runs: ${runs?.length || 0}`);
      
      if (!xpMatch || !kmMatch) {
        console.log(`  🔄 Needs fixing! Updating...`);
        
        // Calculate level (simple formula matching your system)
        const currentLevel = Math.max(1, Math.floor(Math.sqrt(calculatedXP / 100)) + 1);
        
        const { error: updateError } = await supabase
          .from('users')
          .update({
            total_xp: calculatedXP,
            total_km: calculatedKM,
            current_level: currentLevel,
            updated_at: new Date().toISOString()
          })
          .eq('id', user.id);
        
        if (updateError) {
          console.error(`  ❌ Error updating ${user.name}:`, updateError);
        } else {
          console.log(`  ✅ Fixed! Updated to ${calculatedXP} XP, ${calculatedKM.toFixed(2)} km, Level ${currentLevel}`);
          fixedCount++;
        }
      } else {
        console.log(`  ✅ Already correct`);
      }
    }
    
    console.log(`\n🎯 Summary:`);
    console.log(`✅ Checked ${users.length} users`);
    console.log(`🔧 Fixed ${fixedCount} users with incorrect totals`);
    console.log(`✅ All user totals are now synchronized with their runs!`);
    
    // 🏆 NOW trigger title leaderboard recalculation since we updated user totals
    console.log(`\n🏆 Triggering title leaderboard recalculation...`);
    try {
      // Import and run the title trigger system
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      
      const { stdout, stderr } = await execAsync('node titleTriggerSystem.cjs');
      
      if (stderr) {
        console.warn('Title recalculation stderr:', stderr);
      }
      
      console.log('✅ Title recalculation completed successfully!');
      console.log(stdout);
    } catch (titleError) {
      console.error('❌ Error triggering title recalculation:', titleError);
    }
    
    console.log(`\n🎯 FINAL STATUS: User totals fixed AND title leaderboard updated!`);
    
    // Show Nicklas specifically
    const nicklas = users.find(u => u.name.toLowerCase().includes('nicklas'));
    if (nicklas) {
      const { data: updatedNicklas } = await supabase
        .from('users')
        .select('total_xp, total_km, current_level')
        .eq('id', nicklas.id)
        .single();
      
      console.log(`\n👤 Nicklas Von Elling final totals:`);
      console.log(`   XP: ${updatedNicklas.total_xp}`);
      console.log(`   Distance: ${updatedNicklas.total_km} km`);
      console.log(`   Level: ${updatedNicklas.current_level}`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

fixAllUserTotals();