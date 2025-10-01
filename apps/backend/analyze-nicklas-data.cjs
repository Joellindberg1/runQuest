const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function analyzeNicklasData() {
    console.log('🔍 Analyzing Nicklas Von Elling data...\n');
    
    try {
        // 1. Find Nicklas user
        const { data: users, error: userError } = await supabase
            .from('users')
            .select('*')
            .ilike('name', '%nicklas%von%elling%');
            
        if (userError || !users || users.length === 0) {
            console.error('❌ Could not find Nicklas Von Elling');
            return;
        }
        
        const nicklas = users[0];
        console.log(`👤 Found user: ${nicklas.name}`);
        console.log(`   ID: ${nicklas.id}`);
        console.log(`   Email: ${nicklas.email}`);
        console.log(`   Created: ${nicklas.created_at}`);
        
        // 2. Check Strava connection
        const { data: stravaTokens, error: stravaError } = await supabase
            .from('strava_tokens')
            .select('*')
            .eq('user_id', nicklas.id);
            
        if (stravaError) {
            console.error('❌ Error checking Strava connection:', stravaError.message);
            return;
        }
        
        if (stravaTokens && stravaTokens.length > 0) {
            const token = stravaTokens[0];
            console.log(`\n🔗 Strava connection:`);
            console.log(`   Connected: ${token.connection_date}`);
            console.log(`   Expires: ${new Date(token.expires_at * 1000).toISOString()}`);
            
            // Parse connection date
            const connectionDate = new Date(token.connection_date);
            console.log(`   Connection date parsed: ${connectionDate.toISOString().split('T')[0]}`);
        } else {
            console.log('\n❌ No Strava connection found');
        }
        
        // 3. Analyze runs
        const { data: runs, error: runsError } = await supabase
            .from('runs')
            .select('*')
            .eq('user_id', nicklas.id)
            .order('date', { ascending: true });
            
        if (runsError) {
            console.error('❌ Error fetching runs:', runsError.message);
            return;
        }
        
        console.log(`\n🏃‍♂️ Runs analysis (${runs?.length || 0} total runs):`);
        
        if (runs && runs.length > 0) {
            // Group by source
            const manualRuns = runs.filter(run => run.source !== 'strava');
            const stravaRuns = runs.filter(run => run.source === 'strava');
            
            console.log(`   Manual runs: ${manualRuns.length}`);
            console.log(`   Strava runs: ${stravaRuns.length}`);
            
            // Show problematic runs from September 27
            console.log(`\n📊 September 27 runs (the problematic date mentioned):`);
            const sept27Runs = runs.filter(run => run.date === '2025-09-27');
            
            if (sept27Runs.length > 0) {
                sept27Runs.forEach((run, i) => {
                    console.log(`\n   Run ${i + 1} (${run.source || 'manual'}):`);
                    console.log(`     Distance: ${run.distance}km`);
                    console.log(`     Base XP: ${run.base_xp}`);
                    console.log(`     KM XP: ${run.km_xp}`);
                    console.log(`     Distance bonus: ${run.distance_bonus}`);
                    console.log(`     Streak day: ${run.streak_day}`);
                    console.log(`     Multiplier: ${run.multiplier}`);
                    console.log(`     Total XP: ${run.xp_gained}`);
                    console.log(`     Created: ${run.created_at}`);
                });
            } else {
                console.log('   No runs found for September 27');
            }
            
            // Show earliest and latest runs
            console.log(`\n📅 Date range:`);
            console.log(`   Earliest run: ${runs[0].date} (${runs[0].source || 'manual'})`);
            console.log(`   Latest run: ${runs[runs.length - 1].date} (${runs[runs.length - 1].source || 'manual'})`);
            
            // Check for runs before Strava connection (if connected on Sept 30)
            if (stravaTokens && stravaTokens.length > 0) {
                const connectionDate = stravaTokens[0].connection_date.split('T')[0];
                const preConnectionStravaRuns = stravaRuns.filter(run => run.date < connectionDate);
                
                console.log(`\n⚠️  Potential retroactive Strava runs (before ${connectionDate}):`);
                if (preConnectionStravaRuns.length > 0) {
                    preConnectionStravaRuns.forEach(run => {
                        console.log(`   ${run.date}: ${run.distance}km, ${run.xp_gained} XP (created: ${run.created_at})`);
                    });
                } else {
                    console.log('   ✅ No retroactive Strava runs found!');
                }
            }
            
            // XP comparison for similar distances
            console.log(`\n🔄 XP comparison for similar distances:`);
            const distances = [...new Set(runs.map(run => Math.floor(run.distance)))];
            
            distances.slice(0, 3).forEach(dist => {
                const similarRuns = runs.filter(run => Math.floor(run.distance) === dist);
                if (similarRuns.length > 1) {
                    console.log(`\n   ~${dist}km runs:`);
                    similarRuns.forEach(run => {
                        console.log(`     ${run.date} (${run.source || 'manual'}): ${run.distance}km → ${run.xp_gained} XP`);
                        console.log(`       Base: ${run.base_xp}, KM: ${run.km_xp}, Bonus: ${run.distance_bonus}, Streak: ${run.streak_day}x${run.multiplier}`);
                    });
                }
            });
        }
        
        console.log('\n✅ Nicklas data analysis completed!');
        
    } catch (error) {
        console.error('❌ Analysis failed:', error.message);
    }
}

analyzeNicklasData();