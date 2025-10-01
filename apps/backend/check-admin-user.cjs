const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkAdminUser() {
    try {
        console.log('🔍 Checking for Joel Lindberg in users table...');
        
        const { data: users, error } = await supabase
            .from('users')
            .select('id, name, email, is_admin')
            .ilike('name', '%joel%');
            
        if (error) {
            console.error('❌ Error:', error);
            return;
        }
        
        console.log('📊 Users found:', users);
        
        if (users.length === 0) {
            console.log('⚠️  No users found with name containing "joel"');
            console.log('🔍 Let\'s check all users...');
            
            const { data: allUsers, error: allError } = await supabase
                .from('users')
                .select('id, name, email, is_admin')
                .limit(10);
                
            if (allError) {
                console.error('❌ Error getting all users:', allError);
                return;
            }
            
            console.log('📊 All users:', allUsers);
        }
        
    } catch (error) {
        console.error('❌ Script error:', error);
    }
}

checkAdminUser();