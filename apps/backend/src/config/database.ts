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
  logger.info(`🔑 Service Key: ${supabaseServiceRoleKey ? 'set' : 'missing'}`); // aldrig något av nyckelns innehåll

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

export default supabase;

// Export direct client getter for convenience
export function getSupabaseClient() {
  return initializeSupabase();
}