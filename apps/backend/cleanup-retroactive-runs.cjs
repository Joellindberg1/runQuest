const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function cleanupRetroactiveRuns() {
    console.log('🧹 Cleaning up retroactive Strava runs for Nicklas Von Elling...\n');
    
    try {
        // Find Nicklas
        const { data: users, error: userError } = await supabase
            .from('users')
            .select('id, name')
            .ilike('name', '%nicklas%von%elling%')
            .single();
            
        if (userError || !users) {
            console.error('❌ Could not find Nicklas Von Elling');
            return;
        }
        
        console.log(`👤 Working with user: ${users.name} (${users.id})`);
        
        // Get Strava connection date
        const { data: stravaTokens, error: stravaError } = await supabase
            .from('strava_tokens')
            .select('connection_date')
            .eq('user_id', users.id)
            .single();
            
        if (stravaError || !stravaTokens) {
            console.error('❌ Could not find Strava connection');
            return;
        }
        
        const connectionDate = stravaTokens.connection_date.split('T')[0];
        console.log(`🔗 Strava connection date: ${connectionDate}`);
        
        // Find retroactive Strava runs (before connection date)
        const { data: retroactiveRuns, error: runsError } = await supabase
            .from('runs')
            .select('*')
            .eq('user_id', users.id)
            .eq('source', 'strava')
            .lt('date', connectionDate);
            
        if (runsError) {
            console.error('❌ Error finding retroactive runs:', runsError.message);
            return;
        }
        
        console.log(`\n🔍 Found ${retroactiveRuns?.length || 0} retroactive Strava runs:`);
        
        if (retroactiveRuns && retroactiveRuns.length > 0) {
            // Show runs that will be deleted
            retroactiveRuns.forEach((run, i) => {
                console.log(`   ${i + 1}. ${run.date}: ${run.distance}km, ${run.xp_gained} XP (external_id: ${run.external_id})`);
            });
            
            console.log(`\n⚠️  About to delete ${retroactiveRuns.length} retroactive Strava runs...`);
            console.log('   These runs should not exist because they predate the Strava connection.');
            
            // Delete the retroactive runs
            const { error: deleteError } = await supabase
                .from('runs')
                .delete()
                .eq('user_id', users.id)
                .eq('source', 'strava')
                .lt('date', connectionDate);
                
            if (deleteError) {
                console.error('❌ Error deleting retroactive runs:', deleteError.message);
                return;
            }
            
            console.log('✅ Successfully deleted retroactive Strava runs!');
            
            // Recalculate user totals after deletion
            console.log('\n🔄 Recalculating user totals...');
            
            // Get remaining runs to calculate new totals
            const { data: remainingRuns, error: remainingError } = await supabase
                .from('runs')
                .select('xp_gained, distance')
                .eq('user_id', users.id);
                
            if (remainingError) {
                console.error('❌ Error fetching remaining runs:', remainingError.message);
                return;
            }
            
            const newTotalXP = remainingRuns.reduce((sum, run) => sum + (run.xp_gained || 0), 0);
            const newTotalKm = remainingRuns.reduce((sum, run) => sum + (run.distance || 0), 0);
            const newTotalRuns = remainingRuns.length;
            
            // Update user totals (without total_runs since it doesn't exist)
            const { error: updateError } = await supabase
                .from('users')
                .update({
                    total_xp: newTotalXP,
                    total_km: newTotalKm
                })
                .eq('id', users.id);
                
            if (updateError) {
                console.error('❌ Error updating user totals:', updateError.message);
                return;
            }
            
            console.log(`✅ Updated user totals:`);
            console.log(`   Total XP: ${newTotalXP}`);
            console.log(`   Total KM: ${newTotalKm.toFixed(2)}`);
            console.log(`   Total Runs: ${newTotalRuns} (not stored in users table)`);
            
        } else {
            console.log('   ✅ No retroactive Strava runs found - database is clean!');
        }
        
        console.log('\n✅ Cleanup completed successfully!');
        
    } catch (error) {
        console.error('❌ Cleanup failed:', error.message);
    }
}

cleanupRetroactiveRuns();