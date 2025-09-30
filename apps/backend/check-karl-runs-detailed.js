// Check Karl's runs in database and longer Strava history
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkKarlRuns() {
  console.log('🔍 Checking Karl\'s runs...');
  const karlUserId = 'd802fe3f-81f6-4007-8834-59664fc9711d';
  
  // 1. Check recent runs in database
  const { data: dbRuns, error: dbError } = await supabase
    .from('runs')
    .select('*')
    .eq('user_id', karlUserId)
    .order('date', { ascending: false })
    .limit(10);
  
  if (dbError) {
    console.error('❌ Database error:', dbError);
  } else {
    console.log('💾 Recent runs in database:', dbRuns?.length || 0);
    dbRuns?.forEach((run, index) => {
      console.log(`${index + 1}. ${run.date}: ${run.distance}km, ${run.xp_gained || run.xp || 0} XP, external_id: ${run.external_id}`);
    });
  }
  
  // 2. Check Strava token
  const { data: tokens } = await supabase
    .from('strava_tokens')
    .select('*')
    .eq('user_id', karlUserId);
  
  if (tokens && tokens.length > 0) {
    const token = tokens[0];
    console.log('\\n🔑 Token info:', {
      expires_at: token.expires_at,
      expires_date: new Date(token.expires_at * 1000).toISOString()
    });
    
    // 3. Check longer Strava history (90 days)
    const ninetyDaysAgo = Math.floor(Date.now() / 1000) - 90 * 24 * 60 * 60;
    console.log('\\n📅 Checking Strava for last 90 days...');
    
    const stravaResponse = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?per_page=50&after=${ninetyDaysAgo}`,
      {
        headers: {
          'Authorization': `Bearer ${token.access_token}`
        }
      }
    );
    
    if (stravaResponse.ok) {
      const activities = await stravaResponse.json();
      const runningActivities = activities.filter(a => a.type === 'Run');
      
      console.log(`🏃 Found ${runningActivities.length} running activities in 90 days:`);
      runningActivities.forEach((run, index) => {
        console.log(`${index + 1}. ${run.start_date}: ${run.name}, ${(run.distance/1000).toFixed(2)}km, ID: ${run.id}`);
      });
      
      // 4. Check if any recent runs are missing from database
      if (runningActivities.length > 0) {
        console.log('\\n🔍 Checking for missing runs in database...');
        for (const activity of runningActivities) {
          const { data: existingRun } = await supabase
            .from('runs')
            .select('id, external_id')
            .eq('external_id', activity.id.toString())
            .single();
          
          if (!existingRun) {
            console.log(`❌ Missing in DB: ${activity.name} (${activity.id}) from ${activity.start_date}`);
          }
        }
      }
    } else {
      console.error('❌ Strava API error:', stravaResponse.status);
    }
  }
}

checkKarlRuns();