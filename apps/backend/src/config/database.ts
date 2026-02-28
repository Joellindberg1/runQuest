// 🗄️ Supabase Database Connection
import { createClient } from '@supabase/supabase-js';

let supabaseClient: any = null;

// Lazy initialization function
function initializeSupabase() {
  if (supabaseClient) {
    return supabaseClient;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  console.log('🔧 Initializing Supabase connection...');
  console.log(`📍 URL: ${supabaseUrl}`);
  console.log(`🔑 Service Key: ${supabaseServiceRoleKey ? `${supabaseServiceRoleKey.substring(0, 15)}...` : 'missing'}`);

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error('❌ Missing Supabase configuration!');
    throw new Error('Missing Supabase environment variables');
  }

  // Create Supabase client with service role (can bypass RLS)
  supabaseClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  console.log('✅ Supabase client initialized successfully');
  return supabaseClient;
}

// Getter for supabase client
export const supabase = {
  get client() {
    return initializeSupabase();
  }
};

// Test database connection function
export async function testDatabaseConnection() {
  try {
    console.log('🔍 Testing database connection...');
    
    const client = initializeSupabase();
    
    const { error, count } = await client
      .from('users')
      .select('id', { count: 'exact', head: true });

    if (error) {
      console.error('❌ Database connection failed:', error.message);
      return { success: false, error: error.message };
    }

    console.log(`✅ Database connection successful!`);
    console.log(`📊 Users table accessible, total users: ${count}`);

    return {
      success: true,
      message: 'Database connection working',
      usersCount: count
    };
    
  } catch (error) {
    console.error('❌ Database test failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export default supabase;

// Export direct client getter for convenience
export function getSupabaseClient() {
  return initializeSupabase();
}