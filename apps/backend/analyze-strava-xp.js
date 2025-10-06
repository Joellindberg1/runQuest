// Analyze Strava XP issue for Nicklas vs Karl
import dotenv from 'dotenv';
import { getSupabaseClient } from './src/config/database.ts';

// Load environment variables
dotenv.config();

async function analyzeStravaRuns() {
  const supabase = getSupabaseClient();
  
  console.log('🔍 ANALYZING STRAVA XP ISSUE');
  console.log('=====================================');
  
  // Find Nicklas Von Elling
  const { data: nicklas } = await supabase
    .from('users')
    .select('id, name, email, total_xp, total_km')
    .ilike('name', '%nicklas%')
    .single();
    
  console.log('👤 Nicklas data:', nicklas);
  
  if (nicklas) {
    // Get Nicklas's runs
    const { data: nicklasRuns } = await supabase
      .from('runs')
      .select('*')
      .eq('user_id', nicklas.id)
      .order('date', { ascending: false });
      
    console.log(`🏃 Nicklas runs (${nicklasRuns?.length || 0} total):`);
    nicklasRuns?.forEach((run, i) => {
      console.log(`  Run ${i+1}: ${run.distance}km, XP: ${run.xp_gained || 0}, Date: ${run.date}, Source: ${run.source || 'manual'}`);
    });
  }
  
  console.log('\n=====================================');
  
  // Find Karl Persson
  const { data: karl } = await supabase
    .from('users')
    .select('id, name, email, total_xp, total_km')
    .ilike('name', '%karl%')
    .single();
    
  console.log('👤 Karl data:', karl);
  
  if (karl) {
    // Get Karl's runs
    const { data: karlRuns } = await supabase
      .from('runs')
      .select('*')
      .eq('user_id', karl.id)
      .order('date', { ascending: false });
      
    console.log(`🏃 Karl runs (${karlRuns?.length || 0} total):`);
    karlRuns?.forEach((run, i) => {
      console.log(`  Run ${i+1}: ${run.distance}km, XP: ${run.xp_gained || 0}, Date: ${run.date}, Source: ${run.source || 'manual'}`);
    });
  }
  
  console.log('\n🔍 ANALYSIS COMPLETE');
}

analyzeStravaRuns().catch(console.error);