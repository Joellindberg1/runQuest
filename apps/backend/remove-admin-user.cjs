const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function removeAdminUser() {
    try {
        console.log('🗑️  REMOVING OLD ADMIN USER');
        console.log('='.repeat(40));
        
        // First, let's confirm the user exists and get details
        console.log('\n1️⃣ Finding admin user...');
        const { data: adminUser, error: findError } = await supabase
            .from('users')
            .select('*')
            .eq('name', 'admin')
            .single();
            
        if (findError) {
            console.log('❌ Error finding admin user:', findError.message);
            if (findError.code === 'PGRST116') {
                console.log('✅ Admin user already doesn\'t exist - nothing to do!');
                return;
            }
            return;
        }
        
        console.log('📋 Found admin user:');
        console.log(`   ID: ${adminUser.id}`);
        console.log(`   Name: ${adminUser.name}`);
        console.log(`   Email: ${adminUser.email}`);
        console.log(`   Is Admin: ${adminUser.is_admin}`);
        console.log(`   Created: ${adminUser.created_at}`);
        
        // Check if this user has any runs
        console.log('\n2️⃣ Checking for related data...');
        const { data: userRuns, error: runsError } = await supabase
            .from('runs')
            .select('id')
            .eq('user_id', adminUser.id);
            
        if (runsError) {
            console.error('❌ Error checking runs:', runsError.message);
            return;
        }
        
        console.log(`📊 User has ${userRuns.length} runs`);
        
        if (userRuns.length > 0) {
            console.log('⚠️  User has runs - we need to delete those first');
            
            // Delete user's runs first
            const { error: deleteRunsError } = await supabase
                .from('runs')
                .delete()
                .eq('user_id', adminUser.id);
                
            if (deleteRunsError) {
                console.error('❌ Error deleting runs:', deleteRunsError.message);
                return;
            }
            
            console.log('✅ Deleted user runs');
        }
        
        // Check for Strava tokens
        const { data: stravaTokens, error: stravaError } = await supabase
            .from('strava_tokens')
            .select('id')
            .eq('user_id', adminUser.id);
            
        if (!stravaError && stravaTokens.length > 0) {
            console.log(`📱 User has ${stravaTokens.length} Strava tokens - deleting...`);
            
            const { error: deleteStravaError } = await supabase
                .from('strava_tokens')
                .delete()
                .eq('user_id', adminUser.id);
                
            if (deleteStravaError) {
                console.error('❌ Error deleting Strava tokens:', deleteStravaError.message);
                return;
            }
            
            console.log('✅ Deleted Strava tokens');
        }
        
        // Check for user titles
        const { data: userTitles, error: titlesError } = await supabase
            .from('user_titles')
            .select('id')
            .eq('user_id', adminUser.id);
            
        if (!titlesError && userTitles.length > 0) {
            console.log(`🏆 User has ${userTitles.length} titles - deleting...`);
            
            const { error: deleteTitlesError } = await supabase
                .from('user_titles')
                .delete()
                .eq('user_id', adminUser.id);
                
            if (deleteTitlesError) {
                console.error('❌ Error deleting user titles:', deleteTitlesError.message);
                return;
            }
            
            console.log('✅ Deleted user titles');
        }
        
        // Finally, delete the user
        console.log('\n3️⃣ Deleting the admin user...');
        const { error: deleteUserError } = await supabase
            .from('users')
            .delete()
            .eq('id', adminUser.id);
            
        if (deleteUserError) {
            console.error('❌ Error deleting user:', deleteUserError.message);
            return;
        }
        
        console.log('✅ Successfully deleted admin user!');
        
        // Verify deletion
        console.log('\n4️⃣ Verifying deletion...');
        const { data: verifyUser, error: verifyError } = await supabase
            .from('users')
            .select('id')
            .eq('name', 'admin')
            .single();
            
        if (verifyError && verifyError.code === 'PGRST116') {
            console.log('✅ Confirmed: Admin user has been completely removed');
        } else if (verifyUser) {
            console.log('❌ Warning: Admin user still exists!');
        }
        
        // Show remaining admin users
        console.log('\n5️⃣ Current admin users:');
        const { data: remainingAdmins, error: adminError } = await supabase
            .from('users')
            .select('name, email, is_admin')
            .eq('is_admin', true);
            
        if (!adminError) {
            remainingAdmins.forEach(admin => {
                console.log(`👑 ${admin.name} (${admin.email})`);
            });
        }
        
        console.log('\n🎉 CLEANUP COMPLETE!');
        console.log('✅ Old admin user removed');
        console.log('✅ System is now clean and ready for production');
        
    } catch (error) {
        console.error('❌ Script error:', error);
    }
}

removeAdminUser();