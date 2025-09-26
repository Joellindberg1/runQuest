// 🔧 Fix Joel Lindberg password
import dotenv from 'dotenv';
dotenv.config();

import bcrypt from 'bcryptjs';
import { getSupabaseClient } from './src/config/database.js';

async function fixJoelPassword() {
  console.log('🔧 Fixing Joel Lindberg password...');
  
  const supabase = getSupabaseClient();
  
  const plainPassword = '123599';
  const hashedPassword = await bcrypt.hash(plainPassword, 10);
  
  console.log(`🔑 New hash for Joel: ${hashedPassword.substring(0, 20)}...`);
  
  const { data, error } = await supabase
    .from('users')
    .update({ password_hash: hashedPassword })
    .eq('name', 'Joel Lindberg')
    .select('id, name')
    .single();
  
  if (error) {
    console.error('❌ Failed to update Joel:', error);
  } else {
    console.log('✅ Joel Lindberg password updated successfully');
    
    // Test the hash
    const isValid = await bcrypt.compare(plainPassword, hashedPassword);
    console.log(`🧪 Hash verification: ${isValid ? '✅ Valid' : '❌ Invalid'}`);
  }
}

fixJoelPassword().catch(console.error);