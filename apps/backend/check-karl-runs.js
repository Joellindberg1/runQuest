import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkKarlRuns() {
  try {
    // Get Karl's recent runs
    const { data: karlUser, error: userError } = await supabase
      .from('users')
      .select('id, name, total_xp')
      .ilike('name', '%karl%persson%')
      .single();
      
    if (userError) {
      console.error('Error finding Karl:', userError);
      return;
    }
    
    console.log(`Found user: ${karlUser.name} (ID: ${karlUser.id}, XP: ${karlUser.total_xp})`);
    
    // Get his recent runs
    const { data: runs, error: runsError } = await supabase
      .from('runs')
      .select('*')
      .eq('user_id', karlUser.id)
      .order('date', { ascending: false })
      .limit(5);
      
    if (runsError) {
      console.error('Error fetching runs:', runsError);
      return;
    }
    
    console.log(`\n📊 Karl's last 5 runs:`);
    runs?.forEach((run, index) => {
      console.log(`${index + 1}. Date: ${run.date}`);
      console.log(`   Distance: ${run.distance} km`);
      console.log(`   XP: ${run.xp_gained || run.xp || 'N/A'}`);
      console.log(`   Source: ${run.source || 'manual'}`);
      console.log(`   Base XP: ${run.base_xp || 'N/A'}`);
      console.log(`   KM XP: ${run.km_xp || 'N/A'}`);
      console.log('   ---');
    });
    
  } catch (error) {
    console.error('Error:', error);
  }
}

checkKarlRuns().then(() => process.exit(0));