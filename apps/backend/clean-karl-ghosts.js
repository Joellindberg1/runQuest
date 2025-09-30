import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function cleanKarlGhostRecords() {
  try {
    console.log('🔍 Searching for Karl ghost records...');
    
    // Get Karl's user ID
    const { data: karlUser, error: userError } = await supabase
      .from('users')
      .select('id, name')
      .ilike('name', '%karl%persson%')
      .single();
      
    if (userError) {
      console.error('❌ Error finding Karl:', userError);
      return;
    }
    
    console.log(`✅ Found user: ${karlUser.name} (${karlUser.id})`);
    
    // 1. Check for any runs with NULL or 0 XP that might be ghosts
    const { data: suspiciousRuns, error: suspiciousError } = await supabase
      .from('runs')
      .select('*')
      .eq('user_id', karlUser.id)
      .or('xp_gained.is.null,xp_gained.eq.0');
      
    if (suspiciousError) {
      console.error('❌ Error checking suspicious runs:', suspiciousError);
    } else {
      console.log(`🔍 Found ${suspiciousRuns?.length || 0} runs with NULL/0 XP:`);
      suspiciousRuns?.forEach((run, index) => {
        console.log(`  ${index + 1}. Date: ${run.date}, Distance: ${run.distance}, XP: ${run.xp_gained}, Source: ${run.source}, External ID: ${run.external_id}`);
      });
    }
    
    // 2. Check for any Strava runs with external_id
    const { data: stravaRuns, error: stravaError } = await supabase
      .from('runs')
      .select('*')
      .eq('user_id', karlUser.id)
      .eq('source', 'strava')
      .not('external_id', 'is', null);
      
    if (stravaError) {
      console.error('❌ Error checking Strava runs:', stravaError);
    } else {
      console.log(`\n🔗 Found ${stravaRuns?.length || 0} Strava runs with external_id:`);
      stravaRuns?.forEach((run, index) => {
        console.log(`  ${index + 1}. Date: ${run.date}, Distance: ${run.distance}, XP: ${run.xp_gained}, External ID: ${run.external_id}`);
      });
    }
    
    // 3. Check for runs from today specifically
    const { data: todayRuns, error: todayError } = await supabase
      .from('runs')
      .select('*')
      .eq('user_id', karlUser.id)
      .eq('date', '2025-09-30');
      
    if (todayError) {
      console.error('❌ Error checking today runs:', todayError);
    } else {
      console.log(`\n📅 Found ${todayRuns?.length || 0} runs from today (2025-09-30):`);
      todayRuns?.forEach((run, index) => {
        console.log(`  ${index + 1}. Distance: ${run.distance}, XP: ${run.xp_gained}, Source: ${run.source}, External ID: ${run.external_id}`);
      });
      
      // Clean up any problematic runs from today
      if (todayRuns && todayRuns.length > 0) {
        console.log('\n🧹 Cleaning up runs from today...');
        
        const { error: deleteError } = await supabase
          .from('runs')
          .delete()
          .eq('user_id', karlUser.id)
          .eq('date', '2025-09-30');
          
        if (deleteError) {
          console.error('❌ Error deleting today runs:', deleteError);
        } else {
          console.log(`✅ Cleaned up ${todayRuns.length} runs from today`);
        }
      }
    }
    
    console.log('\n🎯 Ghost record cleanup completed!');
    
  } catch (error) {
    console.error('💥 Error:', error);
  }
}

cleanKarlGhostRecords().then(() => process.exit(0));