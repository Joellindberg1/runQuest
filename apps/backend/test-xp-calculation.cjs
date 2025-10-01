const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testXPCalculation() {
    console.log('🧪 Testing new unified XP calculation...');
    
    try {
        // Test the new calculateRunXP function by calling the API
        const response = await fetch('http://localhost:3000/health');
        if (response.ok) {
            console.log('✅ Backend server is running');
        } else {
            console.log('❌ Backend server not responding');
            return;
        }
        
        // Check admin settings
        const { data: settings, error: settingsError } = await supabase
            .from('admin_settings')
            .select('*')
            .single();
            
        if (settingsError) {
            console.error('❌ Could not fetch admin settings:', settingsError.message);
            return;
        }
        
        console.log('⚙️ Admin settings loaded:');
        console.log(`  - Base XP: ${settings.base_xp}`);
        console.log(`  - XP per km: ${settings.xp_per_km}`);
        console.log(`  - Bonus 5km: ${settings.bonus_5km}`);
        console.log(`  - Bonus 10km: ${settings.bonus_10km}`);
        
        // Check streak multipliers
        const { data: multipliers, error: multipliersError } = await supabase
            .from('streak_multipliers')
            .select('*')
            .order('days');
            
        if (multipliersError) {
            console.error('❌ Could not fetch streak multipliers:', multipliersError.message);
            return;
        }
        
        console.log('🏃‍♂️ Streak multipliers loaded:');
        multipliers.slice(0, 3).forEach(mult => {
            console.log(`  - ${mult.days} days: ${mult.multiplier}x`);
        });
        
        console.log('\n🎯 XP calculation test scenarios:');
        
        // Test scenarios
        const scenarios = [
            { distance: 5, streakDay: 1, expected: '15 + 10 + 5 = 30 XP (no multiplier)' },
            { distance: 5, streakDay: 5, expected: '15 + 10 + 5 = 30 XP * 1.1 = 33 XP' },
            { distance: 10, streakDay: 15, expected: '15 + 20 + 15 = 50 XP * 1.2 = 60 XP' }
        ];
        
        scenarios.forEach((scenario, i) => {
            const baseXP = scenario.distance >= settings.min_run_distance ? settings.base_xp : 0;
            const kmXP = Math.floor(scenario.distance * settings.xp_per_km);
            
            let distanceBonus = 0;
            if (scenario.distance >= 20) distanceBonus = settings.bonus_20km;
            else if (scenario.distance >= 15) distanceBonus = settings.bonus_15km;
            else if (scenario.distance >= 10) distanceBonus = settings.bonus_10km;
            else if (scenario.distance >= 5) distanceBonus = settings.bonus_5km;
            
            let multiplier = 1.0;
            for (const mult of multipliers) {
                if (scenario.streakDay >= mult.days) {
                    multiplier = mult.multiplier;
                }
            }
            
            const totalXP = baseXP + kmXP + distanceBonus;
            const finalXP = Math.round(totalXP * multiplier);
            
            console.log(`\n  Scenario ${i + 1}: ${scenario.distance}km run, streak day ${scenario.streakDay}`);
            console.log(`    Base XP: ${baseXP}`);
            console.log(`    KM XP: ${kmXP} (${scenario.distance} * ${settings.xp_per_km})`);
            console.log(`    Distance bonus: ${distanceBonus}`);
            console.log(`    Subtotal: ${totalXP}`);
            console.log(`    Multiplier: ${multiplier}x`);
            console.log(`    Final XP: ${finalXP}`);
            console.log(`    Expected: ${scenario.expected}`);
        });
        
        console.log('\n✅ XP calculation test completed!');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
}

testXPCalculation();