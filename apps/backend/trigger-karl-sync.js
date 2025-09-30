// Trigger actual sync for Karl to test if it works
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function triggerKarlSync() {
  console.log('🔄 Triggering actual sync for Karl...');
  
  // Call the sync endpoint like the frontend would
  try {
    const response = await fetch('http://localhost:3001/api/strava/sync-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: 'd802fe3f-81f6-4007-8834-59664fc9711d'
      })
    });
    
    if (!response.ok) {
      console.error('❌ Sync endpoint error:', response.status, response.statusText);
      const errorText = await response.text();
      console.error('Error details:', errorText);
      return;
    }
    
    const result = await response.json();
    console.log('📊 Sync result:', result);
    
  } catch (error) {
    console.error('❌ Network error:', error);
    console.log('\\n💡 Backend not running. Let me check runs in database instead...');
    
    // Check if the runs are there now
    const { data: runs } = await supabase
      .from('runs')
      .select('*')
      .eq('user_id', 'd802fe3f-81f6-4007-8834-59664fc9711d')
      .order('date', { ascending: false })
      .limit(5);
    
    console.log('\\n📊 Recent runs in database:');
    runs?.forEach((run, index) => {
      console.log(`${index + 1}. ${run.date}: ${run.distance}km, ${run.xp_gained} XP, external_id: ${run.external_id}`);
    });
    
    // Check specifically for today's run
    const todaysRun = runs?.find(run => run.date === '2025-09-30' && Math.abs(run.distance - 1.02) < 0.05);
    if (todaysRun) {
      console.log('\n✅ Found today\'s 1.02km run in database!');
    } else {
      console.log('\n❌ Today\'s 1.02km run not found in database');
    }
  }
}

triggerKarlSync();