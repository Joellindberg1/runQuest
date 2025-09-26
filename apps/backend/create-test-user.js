// 🔧 Create test user with known password
import dotenv from 'dotenv';
dotenv.config();

import bcrypt from 'bcryptjs';
import { getSupabaseClient } from './src/config/database.js';

async function createTestUser() {
  console.log('🔧 Creating test user...');
  
  const supabase = getSupabaseClient();
  
  // Hash password 'test123'  
  const passwordHash = await bcrypt.hash('test123', 10);
  console.log('🔑 Password hash:', passwordHash);
  
  const { data, error } = await supabase
    .from('users')
    .insert({
      name: 'Test User',
      email: 'test@example.com',
      password_hash: passwordHash
    })
    .select()
    .single();
    
  if (error) {
    console.error('❌ Error creating user:', error);
  } else {
    console.log('✅ Test user created:', data);
  }
}

createTestUser().catch(console.error);