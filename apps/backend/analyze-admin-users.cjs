const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkAdminUsers() {
    try {
        console.log('👑 ADMIN USER ANALYSIS');
        console.log('='.repeat(40));
        
        // Get all users with admin status
        const { data: allUsers, error } = await supabase
            .from('users')
            .select('id, name, email, is_admin, created_at')
            .order('created_at', { ascending: true });
            
        if (error) {
            console.error('❌ Error:', error);
            return;
        }
        
        console.log('\n📊 ALL USERS:');
        allUsers.forEach((user, index) => {
            const adminStatus = user.is_admin ? '👑 ADMIN' : '👤 USER';
            console.log(`${index + 1}. ${user.name} (${user.email}) - ${adminStatus}`);
        });
        
        // Count admin users
        const adminUsers = allUsers.filter(user => user.is_admin);
        console.log(`\n📈 ADMIN SUMMARY:`);
        console.log(`Total users: ${allUsers.length}`);
        console.log(`Admin users: ${adminUsers.length}`);
        console.log(`Regular users: ${allUsers.length - adminUsers.length}`);
        
        // Check for problematic users
        const adminNamedUsers = allUsers.filter(user => 
            user.name.toLowerCase().includes('admin')
        );
        
        console.log(`\n🔍 USERS WITH "ADMIN" IN NAME:`);
        if (adminNamedUsers.length > 0) {
            adminNamedUsers.forEach(user => {
                console.log(`- ${user.name} (${user.email})`);
                console.log(`  Admin status: ${user.is_admin ? 'YES' : 'NO'}`);
                console.log(`  Created: ${user.created_at}`);
                
                if (user.name.toLowerCase() === 'admin' && user.is_admin) {
                    console.log(`  ⚠️  POTENTIAL ISSUE: This might be an old admin user that could conflict`);
                }
            });
        } else {
            console.log('✅ No users with "admin" in name found');
        }
        
        console.log(`\n💡 RECOMMENDATION:`);
        if (adminNamedUsers.some(user => user.name.toLowerCase() === 'admin')) {
            console.log('🚨 Consider removing the "admin" user to avoid confusion');
            console.log('   The new database-driven admin system makes it unnecessary');
        } else {
            console.log('✅ No cleanup needed - admin system looks clean');
        }
        
    } catch (error) {
        console.error('❌ Script error:', error);
    }
}

checkAdminUsers();