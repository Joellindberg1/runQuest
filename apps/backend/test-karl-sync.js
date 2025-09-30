// Test Karl's Strava sync with debug logging
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testKarlSync() {
  console.log('🔍 Testing Karl Persson sync...');
  
  try {
    // 1. Kontrollera Karl's token
    const karlUserId = 'd802fe3f-81f6-4007-8834-59664fc9711d';
    const { data: tokens, error: tokenError } = await supabase
      .from('strava_tokens')
      .select('*')
      .eq('user_id', karlUserId);
    
    if (tokenError) {
      console.error('❌ Token fetch error:', tokenError);
      return;
    }
    
    if (!tokens || tokens.length === 0) {
      console.error('❌ No Strava token found for Karl');
      return;
    }
    
    const token = tokens[0];
    console.log('✅ Found token for Karl:', {
      expires_at: token.expires_at,
      scope: token.scope,
      created_at: token.created_at
    });
    
    // 2. Test Strava API call
    const stravaResponse = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?per_page=10&after=${Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60}`,
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
    console.log('📊 Strava API response:', {
      totalActivities: activities.length,
      activities: activities.map(a => ({
        id: a.id,
        name: a.name,
        type: a.type,
        start_date: a.start_date,
        distance: a.distance
      }))
    });
    
    // 3. Filtrera running activities
    const runningActivities = activities.filter(activity => activity.type === 'Run');
    console.log('🏃 Running activities found:', runningActivities.length);
    
    // 4. Kontrollera för duplicates
    for (const activity of runningActivities) {
      const { data: existingRun } = await supabase
        .from('runs')
        .select('id')
        .eq('external_id', activity.id.toString())
        .single();
      
      console.log(`Activity ${activity.id}: ${existingRun ? 'EXISTS' : 'NEW'}`);
    }
    
  } catch (error) {
    console.error('❌ Test error:', error);
  }
}

testKarlSync();