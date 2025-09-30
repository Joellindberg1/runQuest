// Check runs table structure
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkRunsTable() {
  console.log('🔍 Checking runs table structure...');
  
  // Get a sample run to see the structure
  const { data: sampleRuns, error } = await supabase
    .from('runs')
    .select('*')
    .limit(1);
  
  if (error) {
    console.error('❌ Error:', error);
  } else if (sampleRuns && sampleRuns.length > 0) {
    console.log('📊 Runs table columns:', Object.keys(sampleRuns[0]));
    console.log('📝 Sample run:', JSON.stringify(sampleRuns[0], null, 2));
  } else {
    console.log('❌ No runs found');
  }
}

checkRunsTable();