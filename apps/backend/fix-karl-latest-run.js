import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function calculateRunXP(distanceKm) {
  return Math.min(Math.floor(distanceKm * 17), 60);
}

async function fixKarlLatestRun() {
  try {
    console.log('🔧 Fixing Karl\\'s latest run XP...');
    
    // Update Karl's run from today (1.02km) with correct XP
    const correctXP = calculateRunXP(1.02);
    console.log(`💰 1.02km should give: ${correctXP} XP`);
    
    const { error: updateError } = await supabase
      .from('runs')
      .update({ 
        xp_gained: correctXP
      })
      .eq('date', '2025-09-30')
      .like('user_id', '%d802fe3f-81f6-4007-8834-59664fc9711d%');
      
    if (updateError) {
      console.error('❌ Error updating run:', updateError);
    } else {
      console.log(`✅ Updated Karl\\'s run with ${correctXP} XP`);
    }
    
  } catch (error) {
    console.error('💥 Error:', error);
  }
}

fixKarlLatestRun().then(() => process.exit(0));