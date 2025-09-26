// 🧪 Create mock Strava connection for Joel
import dotenv from 'dotenv';
dotenv.config();

import { getSupabaseClient } from './src/config/database.js';

async function createMockStravaForJoel() {
  console.log('🧪 Creating mock Strava connection for Joel Lindberg...');
  
  const supabase = getSupabaseClient();
  
  const joelId = '7f3f75a5-8ac1-4441-a305-25f07daeb957';
  
  // Create fake Strava tokens
  const mockTokens = {
    user_id: joelId,
    access_token: 'mock_strava_token_joel_123456',
    refresh_token: 'mock_refresh_token_joel_789',
    expires_at: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60), // 30 days from now
    connection_date: new Date().toISOString()
  };
  
  const { data, error } = await supabase
    .from('strava_tokens')
    .upsert(mockTokens)
    .select()
    .single();
  
  if (error) {
    console.error('❌ Failed to create mock Strava connection:', error);
  } else {
    console.log('✅ Mock Strava connection created for Joel!');
    console.log('🔑 Access token:', mockTokens.access_token);
    console.log('📅 Expires at:', new Date(mockTokens.expires_at * 1000).toLocaleString());
  }
}

createMockStravaForJoel().catch(console.error);