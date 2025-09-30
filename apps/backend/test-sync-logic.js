// Test sync function directly for Karl
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testSyncLogic() {
  console.log('🔄 Testing sync logic for Karl...');
  const karlUserId = 'd802fe3f-81f6-4007-8834-59664fc9711d';
  
  // Get Karl's token
  const { data: tokens } = await supabase
    .from('strava_tokens')
    .select('*')
    .eq('user_id', karlUserId);
  
  if (!tokens || tokens.length === 0) {
    console.error('❌ No token found');
    return;
  }
  
  const token = tokens[0];
  
  // Check existing runs in database
  const { data: existingRuns } = await supabase
    .from('runs')
    .select('external_id, date, distance')
    .eq('user_id', karlUserId)
    .not('external_id', 'is', null);
  
  console.log(`💾 Existing Strava runs in database: ${existingRuns?.length || 0}`);
  const existingIds = new Set(existingRuns?.map(run => run.external_id) || []);
  
  // Calculate date range like the sync function does
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  thirtyDaysAgo.setHours(0, 0, 0, 0); // Start from beginning of day
  const after = Math.floor(thirtyDaysAgo.getTime() / 1000);
  
  console.log(`📅 Fetching activities after: ${new Date(after * 1000).toISOString()}`);
  console.log(`🆔 Existing external IDs: [${Array.from(existingIds).join(', ')}]`);
  
  // Fetch from Strava
  const stravaResponse = await fetch(
    `https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=50`,
    {
      headers: {
        'Authorization': `Bearer ${token.access_token}`,
        'Content-Type': 'application/json',
      },
    }
  );
  
  if (!stravaResponse.ok) {
    console.error('❌ Strava API error:', stravaResponse.status);
    return;
  }
  
  const activities = await stravaResponse.json();
  console.log(`📊 Fetched ${activities.length} activities from Strava`);
  
  // Log all activities
  if (activities.length > 0) {
    console.log('🔍 All activities found:');
    activities.forEach((activity, index) => {
      const distance = (activity.distance / 1000).toFixed(2);
      const date = activity.start_date_local.split('T')[0];
      console.log(`  ${index + 1}. ${date}: ${distance}km, Type: ${activity.type}, ID: ${activity.id}`);
    });
  }
  
  // Filter for running activities (same logic as sync function)
  const runningActivities = activities.filter(activity => 
    activity.type === 'Run' && 
    !existingIds.has(activity.id.toString())
  );
  
  console.log(`\\n🏃‍♂️ New running activities to sync: ${runningActivities.length}`);
  if (runningActivities.length > 0) {
    runningActivities.forEach((run, index) => {
      const distance = (run.distance / 1000).toFixed(2);
      const date = run.start_date_local.split('T')[0];
      console.log(`  ${index + 1}. ${date}: ${run.name} - ${distance}km, ID: ${run.id}`);
    });
  } else {
    console.log('❌ No new running activities found to sync');
    
    // Check specifically for today's 1.02km run
    const todaysRun = activities.find(a => 
      a.type === 'Run' && 
      Math.abs((a.distance / 1000) - 1.02) < 0.05
    );
    
    if (todaysRun) {
      console.log(`\\n🔍 Found today's 1.02km run but it was filtered out:`);
      console.log(`  - ID: ${todaysRun.id}`);
      console.log(`  - In existing IDs: ${existingIds.has(todaysRun.id.toString())}`);
      console.log(`  - Type: ${todaysRun.type}`);
    }
  }
}

testSyncLogic();