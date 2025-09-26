import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn('⚠️ Missing Supabase environment variables');
  console.log('SUPABASE_URL:', !!supabaseUrl);
  console.log('SUPABASE_SERVICE_ROLE_KEY:', !!process.env.SUPABASE_SERVICE_ROLE_KEY);
  console.log('SUPABASE_SERVICE_KEY:', !!process.env.SUPABASE_SERVICE_KEY);
  console.log('SUPABASE_ANON_KEY:', !!process.env.SUPABASE_ANON_KEY);
  throw new Error('Missing Supabase environment variables');
}

console.log('✅ Supabase client configured with service role key');

// Create Supabase client for backend operations
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});