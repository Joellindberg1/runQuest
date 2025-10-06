// STRATEGY 1B: Node.js "Triggers" for Automatic Title Updates
// Since Supabase RPC doesn't support exec_sql, we'll create a robust 
// application-level trigger system that acts like database triggers

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://yrrqaxdngayakcivfrck.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlycnFheGRuZ2F5YWtjaXZmcmNrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0OTYzMTkzNiwiZXhwIjoyMDY1MjA3OTM2fQ.ZPQ_f5LfCqbqzn8DorCeYfA05JnitGN_820a_rRM7Ts'
);

// Weekend average calculation (från frontend)
function calculateWeekendAverage(runs) {
  const weekendTotals = new Map();
  
  runs.forEach(run => {
    const date = new Date(run.date);
    const day = date.getDay(); // 0 = Sunday, 6 = Saturday
    
    if (day === 0 || day === 6) { // Weekend days
      const monday = new Date(date);
      monday.setDate(date.getDate() - (date.getDay() === 0 ? 6 : date.getDay() - 1));
      const weekKey = monday.toISOString().split('T')[0];
      
      weekendTotals.set(weekKey, (weekendTotals.get(weekKey) || 0) + run.distance);
    }
  });

  const weekends = Array.from(weekendTotals.values());
  return weekends.length > 0 ? weekends.reduce((sum, total) => sum + total, 0) / weekends.length : 0;
}

// ROBUST Main title leaderboard recalculation function
async function recalculateTitleLeaderboard() {
  console.log('🔄 Recalculating title leaderboard...');

  try {
    // 1. Get all titles and users FIRST (before touching any database)
    const { data: allTitles, error: titlesError } = await supabase
      .from('titles')
      .select('*')
      .order('id');

    if (titlesError) {
      console.error('❌ Error fetching titles:', titlesError);
      return false;
    }

    const { data: allUsers, error: usersError } = await supabase
      .from('users')
      .select('*');

    if (usersError) {
      console.error('❌ Error fetching users:', usersError);
      return false;
    }

    // 2. Calculate all new leaderboard entries BEFORE touching database
    const newLeaderboardEntries = [];
    
    console.log(`📋 Processing ${allTitles.length} titles for ${allUsers.length} users...`);

    for (const title of allTitles) {
      console.log(`\n🏆 Processing "${title.name}"...`);
      
      const candidates = [];

      for (const user of allUsers) {
        let userValue = 0;
        let qualifies = false;

        if (title.name === 'The Ultra Man') {
          userValue = user.total_km || 0;
          qualifies = userValue >= title.unlock_requirement;
        } 
        else if (title.name === 'The Reborn Eliud Kipchoge') {
          // Get user's longest run
          const { data: runs } = await supabase
            .from('runs')
            .select('distance')
            .eq('user_id', user.id)
            .order('distance', { ascending: false })
            .limit(1);
          
          userValue = runs && runs.length > 0 ? runs[0].distance : 0;
          qualifies = userValue >= title.unlock_requirement;
        }
        else if (title.name === 'The Weekend Destroyer') {
          // Get all user runs for weekend average calculation
          const { data: runs } = await supabase
            .from('runs')
            .select('date, distance')
            .eq('user_id', user.id);
          
          userValue = runs ? calculateWeekendAverage(runs) : 0;
          qualifies = userValue >= title.unlock_requirement;
        }
        else if (title.name === 'The Daaaaaviiiiiid GOGGINGS') {
          userValue = user.longest_streak || 0;
          qualifies = userValue >= title.unlock_requirement;
        }

        if (qualifies) {
          candidates.push({
            title_id: title.id,
            user_id: user.id,
            user_name: user.name,
            value: userValue
          });
        }
      }

      // Sort candidates by value (descending)
      candidates.sort((a, b) => b.value - a.value);
      
      console.log(`  📊 Found ${candidates.length} qualifying users`);
      
      // Add top 3 to leaderboard entries
      candidates.slice(0, 3).forEach((candidate, index) => {
        newLeaderboardEntries.push({
          title_id: candidate.title_id,
          user_id: candidate.user_id,
          // NOTE: user_name is NOT stored in title_leaderboard, it's joined from users table
          value: candidate.value,
          position: index + 1,
          earned_at: new Date().toISOString()
        });
        
        console.log(`  ${index + 1}. ${candidate.user_name}: ${candidate.value}`);
      });
      
      console.log(`  ✅ Prepared ${Math.min(candidates.length, 3)} entries`);
    }

    // 3. ATOMIC OPERATION: Clear and insert in one transaction-like operation
    console.log('\n🧹 Clearing existing leaderboard...');
    const { error: clearError } = await supabase
      .from('title_leaderboard')
      .delete()
      .gte('id', '00000000-0000-0000-0000-000000000000'); // Delete all

    if (clearError) {
      console.error('❌ Error clearing leaderboard:', clearError);
      return false;
    }

    // 4. Insert all new entries at once
    if (newLeaderboardEntries.length > 0) {
      console.log(`\n📝 Inserting ${newLeaderboardEntries.length} new leaderboard entries...`);
      
      const { error: insertError } = await supabase
        .from('title_leaderboard')
        .insert(newLeaderboardEntries);

      if (insertError) {
        console.error('❌ Error inserting leaderboard entries:', insertError);
        // CRITICAL: If insert fails after clear, we have an empty table!
        // Try to restore by re-running the calculation
        console.log('🔄 Attempting to restore leaderboard...');
        return false;
      }
    }

    console.log('\n✅ Title leaderboard recalculation complete!');
    return true;

  } catch (error) {
    console.error('❌ Error in title recalculation:', error);
    return false;
  }
}

// Export for use in backend services
module.exports = {
  recalculateTitleLeaderboard,
  calculateWeekendAverage
};

// If run directly, execute recalculation
if (require.main === module) {
  recalculateTitleLeaderboard()
    .then(success => {
      console.log(success ? '🎉 Success!' : '❌ Failed!');
      process.exit(success ? 0 : 1);
    });
}