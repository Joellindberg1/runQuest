const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkKarlData() {
  console.log('🔍 Looking for Karl Persson...');
  
  // Find Karl Persson
  const { data: karl, error: karlError } = await supabase
    .from('users')
    .select('id, name, email')
    .ilike('name', '%karl%')
    .single();
    
  if (karlError || !karl) {
    console.log('❌ Karl Persson not found:', karlError?.message);
    
    // Let's see all users
    const { data: allUsers } = await supabase
      .from('users')
      .select('id, name')
      .limit(10);
    console.log('👥 Available users:', allUsers?.map(u => u.name));
    return;
  }
  
  console.log('✅ Found Karl:', karl);
  
  // Check his runs
  const { data: runs } = await supabase
    .from('runs')
    .select('*')
    .eq('user_id', karl.id)
    .order('created_at', { ascending: false });
    
  console.log(`📊 Karl's runs: ${runs?.length || 0}`);
  runs?.forEach(run => {
    console.log(`  - Source: ${run.source} | Created: ${run.created_at} | Distance: ${run.distance}km | External: ${run.external_id || 'None'}`);
  });
  
  // Check specifically for Strava runs
  const { data: stravaRuns } = await supabase
    .from('runs')
    .select('*')
    .eq('user_id', karl.id)
    .eq('source', 'strava');
    
  console.log(`🔗 Karl's Strava runs: ${stravaRuns?.length || 0}`);
  
  // Check his Strava connection
  const { data: strava } = await supabase
    .from('strava_tokens')
    .select('*')
    .eq('user_id', karl.id)
    .single();
    
  console.log('🔗 Karl\'s Strava connection:', strava ? 'Connected' : 'Not connected');
  if (strava) {
    console.log('  - Connected:', strava.connection_date);
  }
}

checkKarlData().catch(console.error);