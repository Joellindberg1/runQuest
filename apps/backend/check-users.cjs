// Check what users exist in database
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkUsers() {
  try {
    console.log('🔍 Checking users in database...');
    
    const { data: users, error } = await supabase
      .from('users')
      .select('id, name, email, created_at')
      .order('id', { ascending: true });

    if (error) {
      console.error('❌ Error:', error);
      return;
    }

    console.log('👥 Found users:');
    users.forEach(user => {
      console.log(`- ID: ${user.id}, Name: "${user.name}", Email: ${user.email}`);
    });
    
    console.log(`\n📊 Total users: ${users.length}`);
    
  } catch (error) {
    console.error('❌ Script error:', error);
  }
}

checkUsers();