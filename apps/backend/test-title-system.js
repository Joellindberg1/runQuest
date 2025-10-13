// Test script to verify title system is working correctly
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testTitleSystem() {
  console.log('🧪 Testing Title System...\n');

  // 1. Check if title_leaderboard table exists and has data
  console.log('1️⃣ Checking title_leaderboard table...');
  const { data: leaderboardData, error: leaderboardError } = await supabase
    .from('title_leaderboard')
    .select('*')
    .limit(5);

  if (leaderboardError) {
    console.error('❌ Error reading title_leaderboard:', leaderboardError.message);
  } else {
    console.log(`✅ title_leaderboard exists with ${leaderboardData?.length || 0} rows (showing first 5)`);
    if (leaderboardData && leaderboardData.length > 0) {
      console.log('Sample data:', JSON.stringify(leaderboardData[0], null, 2));
    } else {
      console.log('⚠️ Table is EMPTY!');
    }
  }

  console.log('');

  // 2. Check if user_titles table exists and has data
  console.log('2️⃣ Checking user_titles table...');
  const { data: userTitlesData, error: userTitlesError } = await supabase
    .from('user_titles')
    .select('*')
    .limit(5);

  if (userTitlesError) {
    console.error('❌ Error reading user_titles:', userTitlesError.message);
  } else {
    console.log(`✅ user_titles exists with ${userTitlesData?.length || 0} rows (showing first 5)`);
    if (userTitlesData && userTitlesData.length > 0) {
      console.log('Sample data:', JSON.stringify(userTitlesData[0], null, 2));
    } else {
      console.log('⚠️ Table is EMPTY!');
    }
  }

  console.log('');

  // 3. Check if SQL functions exist
  console.log('3️⃣ Testing update_all_title_leaderboards() function...');
  try {
    const { data, error } = await supabase.rpc('update_all_title_leaderboards');
    
    if (error) {
      console.error('❌ Function call failed:', error.message);
      console.error('   Code:', error.code);
      console.error('   Details:', error.details);
      console.error('   Hint:', error.hint);
    } else {
      console.log('✅ Function executed successfully');
    }
  } catch (err) {
    console.error('❌ Exception calling function:', err.message);
  }

  console.log('');

  // 4. Check title_leaderboard again after function call
  console.log('4️⃣ Checking title_leaderboard after function call...');
  const { data: afterData, error: afterError } = await supabase
    .from('title_leaderboard')
    .select('*');

  if (afterError) {
    console.error('❌ Error reading title_leaderboard:', afterError.message);
  } else {
    console.log(`✅ title_leaderboard now has ${afterData?.length || 0} total rows`);
    if (afterData && afterData.length > 0) {
      // Group by title
      const byTitle = afterData.reduce((acc, row) => {
        if (!acc[row.title_id]) acc[row.title_id] = [];
        acc[row.title_id].push(row);
        return acc;
      }, {});
      
      console.log(`📊 Rankings for ${Object.keys(byTitle).length} titles:`);
      for (const [titleId, rankings] of Object.entries(byTitle)) {
        console.log(`   Title ${titleId}: ${rankings.length} positions`);
      }
    }
  }

  console.log('');

  // 5. Check if trigger exists
  console.log('5️⃣ Checking for trigger on user_titles...');
  const { data: triggerData, error: triggerError } = await supabase.rpc('pg_get_triggerdef', {
    oid: 'title_leaderboard_update_trigger'
  }).catch(() => ({ data: null, error: { message: 'Cannot check triggers via RPC' } }));

  if (triggerError) {
    console.log('⚠️ Cannot verify trigger existence via API');
    console.log('   Run this in Supabase SQL Editor to check:');
    console.log('   SELECT * FROM pg_trigger WHERE tgname = \'title_leaderboard_update_trigger\';');
  } else if (triggerData) {
    console.log('✅ Trigger exists');
  }

  console.log('\n📋 Summary:');
  console.log('─────────────────────────────────────');
  console.log(`user_titles rows: ${userTitlesData?.length || 0}`);
  console.log(`title_leaderboard rows: ${afterData?.length || 0}`);
  console.log('');
  
  if ((userTitlesData?.length || 0) === 0) {
    console.log('⚠️ PROBLEM: user_titles is empty!');
    console.log('   → Need to run processAllUsersTitles() to populate it');
  }
  
  if ((afterData?.length || 0) === 0) {
    console.log('⚠️ PROBLEM: title_leaderboard is empty!');
    console.log('   → SQL function may not exist or failed to execute');
  }
}

testTitleSystem().catch(console.error);
