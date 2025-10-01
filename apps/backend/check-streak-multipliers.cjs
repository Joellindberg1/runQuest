const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkStreakMultipliers() {
    console.log('🔍 Checking streak_multipliers table...');
    
    const { data: multipliers, error } = await supabase
        .from('streak_multipliers')
        .select('*')
        .order('days');

    if (error) {
        console.error('❌ Error fetching streak multipliers:', error.message);
        return;
    }

    console.log('🏃‍♂️ Current streak multipliers:');
    if (multipliers && multipliers.length > 0) {
        multipliers.forEach(mult => {
            console.log(`  - ${mult.days} days: ${mult.multiplier}x multiplier`);
        });
    } else {
        console.log('  No multipliers found');
    }
}

checkStreakMultipliers();