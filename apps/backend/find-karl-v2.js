// Check users table structure and find Karl
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function findKarl() {
  console.log('🔍 Looking for Karl in users table...');
  
  // First get all users to see structure
  const { data: users, error } = await supabase
    .from('users')
    .select('*')
    .limit(5);
  
  if (error) {
    console.error('❌ Error:', error);
    return;
  }
  
  console.log('👥 Sample users:', JSON.stringify(users, null, 2));
  
  // Now look for Karl by name or email
  const { data: karlUsers, error: karlError } = await supabase
    .from('users')
    .select('*')
    .or('name.ilike.%karl%,email.ilike.%karl%');
  
  if (karlError) {
    console.error('❌ Karl search error:', karlError);
  } else {
    console.log('✅ Karl found:', karlUsers);
  }
}

findKarl();