// 🗄️ Supabase Database Connection
import { logger } from '../utils/logger.js';
import { createClient } from '@supabase/supabase-js';

let supabaseClient: any = null;

// Lazy initialization function
function initializeSupabase() {
  if (supabaseClient) {
    return supabaseClient;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  logger.info('🔧 Initializing Supabase connection...');
  logger.info(`📍 URL: ${supabaseUrl}`);
  logger.info(`🔑 Service Key: ${supabaseServiceRoleKey ? `${supabaseServiceRoleKey.substring(0, 15)}...` : 'missing'}`);

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    logger.error('❌ Missing Supabase configuration!');
    throw new Error('Missing Supabase environment variables');
  }

  // Create Supabase client with service role (can bypass RLS)
  supabaseClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  logger.info('✅ Supabase client initialized successfully');
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
    logger.info('🔍 Testing database connection...');
    
    const client = initializeSupabase();
    
    const { error, count } = await client
      .from('users')
      .select('id', { count: 'exact', head: true });

    if (error) {
      logger.error('❌ Database connection failed:', error.message);
      return { success: false, error: error.message };
    }

    logger.info(`✅ Database connection successful!`);
    logger.info(`📊 Users table accessible, total users: ${count}`);

    return {
      success: true,
      message: 'Database connection working',
      usersCount: count
    };
    
  } catch (error) {
    logger.error('❌ Database test failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export default supabase;

// Export direct client getter for convenience
export function getSupabaseClient() {
  return initializeSupabase();
}