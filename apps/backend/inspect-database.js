// 🔍 Database inspection tool
import dotenv from 'dotenv';
dotenv.config();

import { getSupabaseClient } from './src/config/database.js';

async function inspectDatabase() {
  console.log('🔍 Inspecting database structure and data...\n');
  
  const supabase = getSupabaseClient();
  
  try {
    // First, try to get table structure info
    console.log('1. Checking users table structure:');
    const { data: tableInfo, error: tableError } = await supabase
      .rpc('get_table_columns', { table_name: 'users' })
      .select();
    
    if (tableError) {
      console.log('   ⚠️ Could not get table structure:', tableError.message);
    } else {
      console.log('   ✅ Table structure:', tableInfo);
    }

    // Try different queries to understand what we can access
    console.log('\n2. Checking what columns we can read:');
    
    const queries = [
      { name: 'Basic info', select: 'id, name' },
      { name: 'With email', select: 'id, name, email' },
      { name: 'With password_hash', select: 'id, name, password_hash' },
      { name: 'All available', select: '*' }
    ];
    
    for (const query of queries) {
      console.log(`\n   Testing: ${query.name}`);
      const { data, error } = await supabase
        .from('users')
        .select(query.select)
        .limit(2);
      
      if (error) {
        console.log(`   ❌ ${query.name}: ${error.message}`);
      } else {
        console.log(`   ✅ ${query.name}:`, JSON.stringify(data, null, 2));
      }
    }
    
    // Check user count
    console.log('\n3. Total users count:');
    const { count } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true });
    console.log(`   📊 Total users: ${count}`);
    
    // Check if there are any users with password_hash
    console.log('\n4. Users with password_hash (for login capability):');
    const { data: usersWithPassword, error: pwError } = await supabase
      .from('users')
      .select('id, name, email')
      .not('password_hash', 'is', null)
      .limit(5);
      
    if (pwError) {
      console.log(`   ❌ Could not check password_hash: ${pwError.message}`);
    } else {
      console.log(`   ✅ Users with passwords:`, usersWithPassword);
    }
    
  } catch (error) {
    console.error('❌ Database inspection failed:', error);
  }
}

inspectDatabase().catch(console.error);