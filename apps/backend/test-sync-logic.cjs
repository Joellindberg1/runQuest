const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testNewSyncLogic() {
    console.log('🧪 Testing new Strava sync logic...\n');
    
    try {
        // Get Nicklas user info
        const { data: users, error: userError } = await supabase
            .from('users')
            .select('*')
            .ilike('name', '%nicklas%von%elling%')
            .single();
            
        if (userError || !users) {
            console.error('❌ Could not find Nicklas Von Elling');
            return;
        }
        
        console.log(`👤 Testing with user: ${users.name}`);
        
        // Check current Strava connection
        const { data: stravaTokens, error: stravaError } = await supabase
            .from('strava_tokens')
            .select('*')
            .eq('user_id', users.id)
            .single();
            
        if (stravaError || !stravaTokens) {
            console.error('❌ No Strava connection found');
            return;
        }
        
        const connectionDate = stravaTokens.connection_date.split('T')[0];
        console.log(`🔗 Connection date: ${connectionDate}`);
        console.log(`⏰ Token expires: ${new Date(stravaTokens.expires_at * 1000).toISOString()}`);
        
        // Count existing runs before sync
        const { data: existingRuns, error: runsError } = await supabase
            .from('runs')
            .select('*')
            .eq('user_id', users.id)
            .order('date', { ascending: false });
            
        if (runsError) {
            console.error('❌ Error fetching existing runs:', runsError.message);
            return;
        }
        
        const manualRuns = existingRuns.filter(run => run.source !== 'strava');
        const stravaRuns = existingRuns.filter(run => run.source === 'strava');
        
        console.log(`\n📊 Current state:`);
        console.log(`   Total runs: ${existingRuns.length}`);
        console.log(`   Manual runs: ${manualRuns.length}`);
        console.log(`   Strava runs: ${stravaRuns.length}`);
        
        if (stravaRuns.length > 0) {
            console.log(`   Latest Strava run: ${stravaRuns[0].date} (${stravaRuns[0].distance}km)`);
        }
        
        // Test the sync API endpoint
        console.log(`\n🔄 Testing manual sync via API...`);
        
        const response = await fetch('http://localhost:3000/api/strava/sync-all', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            console.error('❌ Sync API request failed:', response.status, response.statusText);
            return;
        }
        
        const syncResult = await response.json();
        console.log('✅ Sync completed:', syncResult);
        
        // Check runs after sync
        const { data: runsAfterSync, error: afterSyncError } = await supabase
            .from('runs')
            .select('*')
            .eq('user_id', users.id)
            .order('date', { ascending: false });
            
        if (afterSyncError) {
            console.error('❌ Error fetching runs after sync:', afterSyncError.message);
            return;
        }
        
        const newStravaRuns = runsAfterSync.filter(run => run.source === 'strava');
        const newRunsCount = newStravaRuns.length - stravaRuns.length;
        
        console.log(`\n📈 Results after sync:`);
        console.log(`   Total runs: ${runsAfterSync.length}`);
        console.log(`   Strava runs: ${newStravaRuns.length} (${newRunsCount >= 0 ? '+' + newRunsCount : newRunsCount})`);
        
        if (newRunsCount > 0) {
            console.log(`\n🆕 New Strava runs imported:`);
            const newRuns = newStravaRuns.slice(0, newRunsCount);
            newRuns.forEach((run, i) => {
                console.log(`   ${i + 1}. ${run.date}: ${run.distance}km, ${run.xp_gained} XP`);
                console.log(`      Base: ${run.base_xp}, KM: ${run.km_xp}, Bonus: ${run.distance_bonus}`);
                console.log(`      Streak: day ${run.streak_day}, multiplier ${run.multiplier}`);
            });
        }
        
        // Verify no retroactive runs were imported
        const retroactiveRuns = newStravaRuns.filter(run => run.date < connectionDate);
        
        if (retroactiveRuns.length > 0) {
            console.log(`\n❌ PROBLEM: Found ${retroactiveRuns.length} retroactive runs!`);
            retroactiveRuns.forEach(run => {
                console.log(`   ${run.date}: ${run.distance}km (should not exist before ${connectionDate})`);
            });
        } else {
            console.log(`\n✅ SUCCESS: No retroactive runs imported (connection date filter working!)`);
        }
        
        // Test XP calculation consistency
        console.log(`\n🧮 Testing XP calculation consistency:`);
        
        if (newStravaRuns.length > 0) {
            const testRun = newStravaRuns[0];
            
            // Calculate expected XP using admin settings
            const { data: settings, error: settingsError } = await supabase
                .from('admin_settings')
                .select('*')
                .single();
                
            if (!settingsError && settings) {
                const expectedBaseXP = testRun.distance >= settings.min_run_distance ? settings.base_xp : 0;
                const expectedKmXP = Math.floor(testRun.distance * settings.xp_per_km);
                
                let expectedBonus = 0;
                if (testRun.distance >= 20) expectedBonus = settings.bonus_20km;
                else if (testRun.distance >= 15) expectedBonus = settings.bonus_15km;
                else if (testRun.distance >= 10) expectedBonus = settings.bonus_10km;
                else if (testRun.distance >= 5) expectedBonus = settings.bonus_5km;
                
                console.log(`   Test run: ${testRun.date}, ${testRun.distance}km`);
                console.log(`   Expected XP: Base ${expectedBaseXP} + KM ${expectedKmXP} + Bonus ${expectedBonus} = ${expectedBaseXP + expectedKmXP + expectedBonus}`);
                console.log(`   Actual XP: Base ${testRun.base_xp} + KM ${testRun.km_xp} + Bonus ${testRun.distance_bonus} = ${testRun.base_xp + testRun.km_xp + testRun.distance_bonus}`);
                
                const expectedSubtotal = expectedBaseXP + expectedKmXP + expectedBonus;
                const actualSubtotal = testRun.base_xp + testRun.km_xp + testRun.distance_bonus;
                
                if (expectedSubtotal === actualSubtotal) {
                    console.log(`   ✅ XP calculation matches admin_settings!`);
                } else {
                    console.log(`   ❌ XP calculation mismatch! Expected ${expectedSubtotal}, got ${actualSubtotal}`);
                }
            }
        }
        
        console.log('\n✅ Sync logic test completed!');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
}

testNewSyncLogic();