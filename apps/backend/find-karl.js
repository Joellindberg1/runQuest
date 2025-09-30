// Find Karl's user_id
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function findKarl() {
  console.log('🔍 Looking for Karl Persson...');
  
  const { data: users, error } = await supabase
    .from('users')
    .select('id, display_name, email')
    .ilike('display_name', '%karl%');
  
  if (error) {
    console.error('❌ Error:', error);
    return;
  }
  
  console.log('👥 Found users:', users);
  
  if (users && users.length > 0) {
    const karl = users[0];
    console.log('✅ Karl found:', karl);
    
    // Now check his Strava token
    const { data: tokens, error: tokenError } = await supabase
      .from('strava_tokens')
      .select('*')
      .eq('user_id', karl.id);
    
    if (tokenError) {
      console.error('❌ Token error:', tokenError);
    } else {
      console.log('🔑 Karl\'s tokens:', tokens);
    }
  }
}

findKarl();