const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkAdminSettings() {
    console.log('🔍 Checking admin_settings table...');
    
    const { data: settings, error } = await supabase
        .from('admin_settings')
        .select('*')
        .single();

    if (error) {
        console.error('❌ Error fetching admin settings:', error.message);
        return;
    }

    console.log('⚙️ Current admin settings:');
    console.log(JSON.stringify(settings, null, 2));
}

checkAdminSettings();