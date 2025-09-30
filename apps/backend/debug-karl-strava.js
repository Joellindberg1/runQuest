import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function debugKarlStravaSync() {
  try {
    console.log('🔍 Debugging Karl Strava sync...');
    
    // 1. Check if Karl has Strava tokens
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
    
    // 2. Check Strava tokens
    const { data: tokens, error: tokenError } = await supabase
      .from('strava_tokens')
      .select('*')
      .eq('user_id', karlUser.id)
      .single();
      
    if (tokenError) {
      console.error('❌ No Strava tokens found:', tokenError);
      return;
    }
    
    console.log('✅ Strava tokens found:', {
      expires_at: tokens.expires_at,
      connection_date: tokens.connection_date,
      has_access_token: !!tokens.access_token,
      has_refresh_token: !!tokens.refresh_token
    });
    
    // 3. Check if token is expired
    const now = Math.floor(Date.now() / 1000);
    const isExpired = tokens.expires_at && tokens.expires_at < now;
    console.log(`🕐 Token status: ${isExpired ? 'EXPIRED' : 'VALID'}`);
    
    if (isExpired) {
      console.log('⚠️ Token is expired, needs refresh');
    }
    
    // 4. Try to fetch activities from Strava
    console.log('\n🔄 Testing Strava API call...');
    
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const after = Math.floor(thirtyDaysAgo.getTime() / 1000);
    
    const stravaResponse = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=50`,
      {
        headers: {
          'Authorization': `Bearer ${tokens.access_token}`,
          'Content-Type': 'application/json',
        },
      }
    );
    
    if (!stravaResponse.ok) {
      const errorData = await stravaResponse.json();
      console.error('❌ Strava API error:', stravaResponse.status, errorData);
      return;
    }
    
    const activities = await stravaResponse.json();
    console.log(`📊 Fetched ${activities.length} activities from Strava`);
    
    // 5. Filter for running activities
    const runningActivities = activities.filter(activity => activity.type === 'Run');
    console.log(`🏃‍♂️ Found ${runningActivities.length} running activities`);
    
    if (runningActivities.length > 0) {
      console.log('\n📋 Recent running activities:');
      runningActivities.slice(0, 5).forEach((activity, index) => {
        const distance = (activity.distance / 1000).toFixed(2);
        const date = activity.start_date_local.split('T')[0];
        console.log(`${index + 1}. ${date}: ${distance}km (ID: ${activity.id})`);
      });
    }
    
    // 6. Check existing runs in database
    const { data: existingRuns, error: runsError } = await supabase
      .from('runs')
      .select('external_id, date, distance')
      .eq('user_id', karlUser.id)
      .eq('source', 'strava')
      .not('external_id', 'is', null)
      .order('date', { ascending: false });
    
    if (runsError) {
      console.error('❌ Error fetching existing runs:', runsError);
    } else {
      console.log(`\n💾 Found ${existingRuns?.length || 0} existing Strava runs in database:`);
      existingRuns?.slice(0, 5).forEach((run, index) => {
        console.log(`${index + 1}. ${run.date}: ${run.distance}km (External ID: ${run.external_id})`);
      });
    }
    
  } catch (error) {
    console.error('💥 Debug error:', error);
  }
}

debugKarlStravaSync().then(() => process.exit(0));