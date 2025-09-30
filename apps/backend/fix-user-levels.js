import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Level requirements from database
const levelRequirements = [
  0, 50, 102, 158, 217, 280, 349, 423, 504, 594,
  693, 806, 934, 1079, 1244, 1436, 1659, 1920, 2228, 2591,
  3026, 3549, 4181, 4953, 5902, 7089, 8584, 10482, 12912, 16071
];

function getLevelFromXP(totalXP) {
  for (let i = levelRequirements.length - 1; i >= 0; i--) {
    if (totalXP >= levelRequirements[i]) {
      return Math.min(i + 1, 30);
    }
  }
  return 1;
}

async function fixAllUserLevels() {
  try {
    console.log('🔧 Starting user level correction...');
    
    // Get all users with their current XP
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('id, name, total_xp, current_level');
      
    if (usersError) {
      console.error('Error fetching users:', usersError);
      return;
    }
    
    console.log(`📊 Found ${users.length} users to check`);
    
    const updates = [];
    
    for (const user of users) {
      const currentLevel = user.current_level || 1;
      const correctLevel = getLevelFromXP(user.total_xp || 0);
      
      if (currentLevel !== correctLevel) {
        console.log(`❌ ${user.name}: Level ${currentLevel} → ${correctLevel} (XP: ${user.total_xp})`);
        updates.push({
          id: user.id,
          name: user.name,
          currentLevel,
          correctLevel,
          xp: user.total_xp
        });
      } else {
        console.log(`✅ ${user.name}: Level ${currentLevel} correct (XP: ${user.total_xp})`);
      }
    }
    
    if (updates.length === 0) {
      console.log('🎉 All user levels are already correct!');
      return;
    }
    
    console.log(`\n🔄 Updating ${updates.length} users...`);
    
    // Update each user's level
    for (const update of updates) {
      const { error: updateError } = await supabase
        .from('users')
        .update({ current_level: update.correctLevel })
        .eq('id', update.id);
        
      if (updateError) {
        console.error(`❌ Failed to update ${update.name}:`, updateError);
      } else {
        console.log(`✅ Updated ${update.name}: Level ${update.currentLevel} → ${update.correctLevel}`);
      }
    }
    
    console.log('\n🎉 User level correction completed!');
    
  } catch (error) {
    console.error('💥 Error in fixAllUserLevels:', error);
  }
}

// Run the fix
fixAllUserLevels().then(() => {
  console.log('Done!');
  process.exit(0);
}).catch(console.error);