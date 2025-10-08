import { config } from 'dotenv';
import { getSupabaseClient } from './src/config/database.js';

config();
const supabase = getSupabaseClient();

console.log('🔍 Quick check of streak_multipliers...');

try {
  const { data, error } = await supabase
    .from('streak_multipliers')
    .select('*')
    .limit(5);

  if (error) {
    console.error('❌ Error:', error.message);
    console.log('🔧 Creating default streak multipliers...');
    
    // Create some default multipliers
    const defaultMultipliers = [
      { days: 1, multiplier: 1.0 },
      { days: 3, multiplier: 1.1 },
      { days: 7, multiplier: 1.2 },
      { days: 14, multiplier: 1.3 },
      { days: 30, multiplier: 1.5 }
    ];
    
    const { error: insertError } = await supabase
      .from('streak_multipliers')
      .insert(defaultMultipliers);
      
    if (insertError) {
      console.error('❌ Failed to create multipliers:', insertError.message);
    } else {
      console.log('✅ Created default streak multipliers');
    }
  } else {
    console.log('✅ Found multipliers:', data);
  }
} catch (err) {
  console.error('❌ Exception:', err.message);
}

console.log('🎯 Done!');
process.exit(0);