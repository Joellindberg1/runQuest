// Add admin field to users table and set Joel as admin
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function setupAdminSystem() {
  try {
    console.log('🔧 Setting up database-driven admin system...');
    
    // First, check if is_admin column exists
    console.log('1️⃣ Checking current table structure...');
    const { data: tableInfo, error: tableError } = await supabase
      .from('users')
      .select('*')
      .limit(1);
    
    if (tableError) {
      console.error('❌ Error checking table:', tableError);
      return;
    }
    
    console.log('📊 Current user table columns:', Object.keys(tableInfo[0]));
    
    // Add is_admin column if it doesn't exist
    if (!tableInfo[0].hasOwnProperty('is_admin')) {
      console.log('2️⃣ Adding is_admin column to users table...');
      
      // Note: This requires direct SQL since Supabase client doesn't support ALTER TABLE
      const { data, error } = await supabase.rpc('exec_sql', {
        sql: 'ALTER TABLE users ADD COLUMN is_admin BOOLEAN DEFAULT FALSE;'
      });
      
      if (error) {
        console.log('⚠️ Column might already exist or need manual creation');
        console.log('💡 You may need to run this SQL manually in Supabase dashboard:');
        console.log('   ALTER TABLE users ADD COLUMN is_admin BOOLEAN DEFAULT FALSE;');
      } else {
        console.log('✅ is_admin column added successfully');
      }
    } else {
      console.log('✅ is_admin column already exists');
    }
    
    // Set Joel as admin
    console.log('3️⃣ Setting Joel Lindberg as admin...');
    const { data: updateResult, error: updateError } = await supabase
      .from('users')
      .update({ is_admin: true })
      .eq('name', 'Joel Lindberg');
    
    if (updateError) {
      console.error('❌ Error setting admin status:', updateError);
    } else {
      console.log('✅ Joel Lindberg is now admin');
    }
    
    // Verify admin users
    console.log('4️⃣ Current admin users:');
    const { data: admins, error: adminError } = await supabase
      .from('users')
      .select('id, name, email, is_admin')
      .eq('is_admin', true);
    
    if (adminError) {
      console.error('❌ Error fetching admins:', adminError);
    } else {
      if (admins.length === 0) {
        console.log('⚠️ No admin users found');
      } else {
        admins.forEach(admin => {
          console.log(`👑 Admin: ${admin.name} (${admin.email})`);
        });
      }
    }
    
  } catch (error) {
    console.error('❌ Script error:', error);
  }
}

setupAdminSystem();