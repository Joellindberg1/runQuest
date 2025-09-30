// Check Karl's activities for today (2025-09-30)
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkKarlTodaysRun() {
  console.log('🔍 Checking Karl\'s activities for today (2025-09-30)...');
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
  
  // Get today's start timestamp (midnight)
  const today = new Date('2025-09-30T00:00:00Z');
  const todayTimestamp = Math.floor(today.getTime() / 1000);
  
  console.log('📅 Checking from timestamp:', todayTimestamp, '(', today.toISOString(), ')');
  
  // Get activities from today onwards
  const stravaResponse = await fetch(
    `https://www.strava.com/api/v3/athlete/activities?per_page=20&after=${todayTimestamp}`,
    {
      headers: {
        'Authorization': `Bearer ${token.access_token}`
      }
    }
  );
  
  if (!stravaResponse.ok) {
    console.error('❌ Strava API error:', stravaResponse.status, stravaResponse.statusText);
    const errorText = await stravaResponse.text();
    console.error('Error details:', errorText);
    return;
  }
  
  const activities = await stravaResponse.json();
  console.log(`📊 Found ${activities.length} activities from today onwards:`);
  
  activities.forEach((activity, index) => {
    console.log(`${index + 1}. ${activity.start_date}: ${activity.name} (${activity.type}) - ${(activity.distance/1000).toFixed(2)}km, ID: ${activity.id}`);
  });
  
  // Filter for running activities
  const runningActivities = activities.filter(a => a.type === 'Run');
  console.log(`\\n🏃 Running activities today: ${runningActivities.length}`);
  
  runningActivities.forEach((run, index) => {
    console.log(`${index + 1}. ${run.start_date}: ${run.name} - ${(run.distance/1000).toFixed(2)}km, ID: ${run.id}`);
  });
  
  // Check if the 1.02km run exists
  const expectedRun = runningActivities.find(r => {
    const distanceKm = r.distance / 1000;
    return Math.abs(distanceKm - 1.02) < 0.05; // Within 50m tolerance
  });
  
  if (expectedRun) {
    console.log(`\\n✅ Found the 1.02km run: ${expectedRun.name} at ${expectedRun.start_date}`);
    console.log('📋 Run details:', {
      id: expectedRun.id,
      name: expectedRun.name,
      type: expectedRun.type,
      distance: `${(expectedRun.distance/1000).toFixed(2)}km`,
      start_date: expectedRun.start_date
    });
  } else {
    console.log('\\n❌ Could not find the 1.02km run in today\'s activities');
  }
}

checkKarlTodaysRun();