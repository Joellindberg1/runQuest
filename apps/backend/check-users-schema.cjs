const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkUsersSchema() {
    try {
        console.log('🔍 Checking users table schema...');
        
        // Try to get a single user with all possible columns
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .limit(1)
            .single();
            
        if (error) {
            console.error('❌ Error getting user:', error);
            return;
        }
        
        console.log('📊 Available columns in users table:', Object.keys(user));
        console.log('📋 Sample user data:', user);
        
        // Now test the exact query from the endpoint
        console.log('\n🧪 Testing the endpoint query...');
        const { data: users, error: queryError } = await supabase
            .from('users')
            .select('id, name, email, total_xp, current_level, total_runs, current_streak, created_at')
            .order('created_at', { ascending: true });

        if (queryError) {
            console.error('❌ Query error:', queryError);
        } else {
            console.log('✅ Query successful! Users count:', users.length);
        }
        
    } catch (error) {
        console.error('❌ Script error:', error);
    }
}

checkUsersSchema();