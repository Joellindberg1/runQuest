// 🔧 Fix password hashes for existing users
import dotenv from 'dotenv';
dotenv.config();

import bcrypt from 'bcryptjs';
import { getSupabaseClient } from './src/config/database.js';

async function fixPasswordHashes() {
  console.log('🔧 Fixing password hashes for existing users...\n');
  
  const supabase = getSupabaseClient();
  
  // Users with plain text passwords that need to be hashed
  const usersToFix = [
    { name: 'Karl Persson', currentPassword: 'gbgvarvet26' },
    { name: 'Adam Einstein', currentPassword: 'gbgvarvet26ih' }
  ];
  
  for (const user of usersToFix) {
    try {
      console.log(`🔑 Processing ${user.name}...`);
      
      // Create proper bcrypt hash
      const hashedPassword = await bcrypt.hash(user.currentPassword, 10);
      console.log(`   📝 New hash created: ${hashedPassword.substring(0, 20)}...`);
      
      // Update user with proper hash
      const { data, error } = await supabase
        .from('users')
        .update({ password_hash: hashedPassword })
        .eq('name', user.name)
        .select('id, name')
        .single();
      
      if (error) {
        console.error(`   ❌ Failed to update ${user.name}:`, error.message);
      } else {
        console.log(`   ✅ Successfully updated ${user.name} (ID: ${data.id})`);
        
        // Test the new hash works
        const isValid = await bcrypt.compare(user.currentPassword, hashedPassword);
        console.log(`   🧪 Hash verification: ${isValid ? '✅ Valid' : '❌ Invalid'}`);
      }
      
    } catch (error) {
      console.error(`❌ Error processing ${user.name}:`, error);
    }
    console.log('');
  }
  
  console.log('🎉 Password hash fix completed!');
  console.log('\n📝 Updated login credentials:');
  console.log('   Karl Persson: gbgvarvet26');
  console.log('   Adam Einstein: gbgvarvet26ih');
}

fixPasswordHashes().catch(console.error);