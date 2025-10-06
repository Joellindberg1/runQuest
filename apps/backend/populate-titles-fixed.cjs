// Script för att manuellt fylla title_leaderboard tabellen med korrekt ranking logik
const { createClient } = require('@supabase/supabase-js');

// Använd samma credentials som backend servern
const supabase = createClient(
  'https://yrrqaxdngayakcivfrck.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlycnFheGRuZ2F5YWtjaXZmcmNrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0OTYzMTkzNiwiZXhwIjoyMDY1MjA3OTM2fQ.ZPQ_f5LfCqbqzn8DorCeYfA05JnitGN_820a_rRM7Ts'
);

// Weekend average beräkning (kopierad från frontend)
function calculateWeekendAverage(runs) {
  const weekendTotals = new Map();
  
  runs.forEach(run => {
    const date = new Date(run.date);
    const day = date.getDay(); // 0 = Sunday, 6 = Saturday
    
    if (day === 0 || day === 6) { // Weekend days
      // Get the Monday of the week containing this weekend day
      const monday = new Date(date);
      monday.setDate(date.getDate() - (date.getDay() === 0 ? 6 : date.getDay() - 1));
      const weekKey = monday.toISOString().split('T')[0];
      
      weekendTotals.set(weekKey, (weekendTotals.get(weekKey) || 0) + run.distance);
    }
  });

  const weekends = Array.from(weekendTotals.values());
  return weekends.length > 0 ? weekends.reduce((sum, total) => sum + total, 0) / weekends.length : 0;
}

async function populateTitleLeaderboard() {
  console.log('🔄 Startar populering av title_leaderboard tabellen...');

  try {
    // Rensa befintlig data först
    console.log('🧹 Rensar befintlig title_leaderboard data...');
    const { data: existingData } = await supabase
      .from('title_leaderboard')
      .select('id');
    
    if (existingData && existingData.length > 0) {
      const { error: clearError } = await supabase
        .from('title_leaderboard')
        .delete()
        .in('id', existingData.map(row => row.id));

      if (clearError) {
        console.error('❌ Error clearing title_leaderboard:', clearError);
        return;
      }
      console.log(`🧹 Tog bort ${existingData.length} befintliga entries`);
    } else {
      console.log('📭 Inga befintliga entries att rensa');
    }

    // Hämta alla titlar
    const { data: titles, error: titlesError } = await supabase
      .from('titles')
      .select('*');

    if (titlesError) {
      console.error('❌ Error fetching titles:', titlesError);
      return;
    }

    console.log(`📋 Hittade ${titles.length} titlar att beräkna...`);

    // Hämta alla användare
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('id, name, total_km, longest_streak, total_xp');

    if (usersError) {
      console.error('❌ Error fetching users:', usersError);
      return;
    }

    console.log(`👥 Hittade ${users.length} användare`);

    // Beräkna för varje titel
    for (const title of titles) {
      console.log(`\n🏆 Beräknar för "${title.name}"...`);
      console.log(`  📏 Unlock requirement: ${title.unlock_requirement}`);

      let candidates = [];

      if (title.name === 'The Ultra Man') {
        // Total kilometers
        candidates = users
          .filter(u => (u.total_km || 0) >= title.unlock_requirement)
          .map(u => ({ ...u, value: u.total_km || 0 }))
          .sort((a, b) => b.value - a.value);

      } else if (title.name === 'The Daaaaaviiiiiid GOGGINGS') {
        // Longest streak
        candidates = users
          .filter(u => (u.longest_streak || 0) >= title.unlock_requirement)
          .map(u => ({ ...u, value: u.longest_streak || 0 }))
          .sort((a, b) => b.value - a.value);

      } else if (title.name === 'The Reborn Eliud Kipchoge') {
        // Längsta run - behöver kolla runs tabellen
        for (const user of users) {
          const { data: longestRun } = await supabase
            .from('runs')
            .select('distance')
            .eq('user_id', user.id)
            .order('distance', { ascending: false })
            .limit(1);

          const maxDistance = longestRun && longestRun.length > 0 ? longestRun[0].distance : 0;
          if (maxDistance >= title.unlock_requirement) {
            candidates.push({ ...user, value: maxDistance });
          }
        }
        candidates.sort((a, b) => b.value - a.value);

      } else if (title.name === 'The Weekend Destroyer') {
        // Weekend average - använd korrekt beräkning
        for (const user of users) {
          const { data: allRuns } = await supabase
            .from('runs')
            .select('distance, date')
            .eq('user_id', user.id);

          const weekendAvg = calculateWeekendAverage(allRuns || []);
          if (weekendAvg >= title.unlock_requirement) {
            candidates.push({ ...user, value: weekendAvg });
          }
        }
        candidates.sort((a, b) => b.value - a.value);
      }

      console.log(`  📊 ${candidates.length} användare kvalificerar`);

      // Debug: visa alla kandidater
      candidates.forEach((candidate, index) => {
        console.log(`    ${index + 1}. ${candidate.name}: ${candidate.value}`);
      });

      // Spara top 3 för denna titel (även om färre än 3 kvalificerar)
      const leaderboardEntries = [];
      for (let i = 0; i < Math.min(3, candidates.length); i++) {
        const candidate = candidates[i];
        const position = i + 1; // 1, 2, 3 för position
        const positionName = i === 0 ? 'holder' : i === 1 ? 'runner_up' : 'third_place';

        console.log(`  🏆 ${positionName}: ${candidate.name} (${candidate.value})`);

        leaderboardEntries.push({
          title_id: title.id,
          user_id: candidate.id,
          position: position,
          value: candidate.value,
          earned_at: new Date().toISOString()
        });
      }

      // Spara till databas
      if (leaderboardEntries.length > 0) {
        const { error: insertError } = await supabase
          .from('title_leaderboard')
          .insert(leaderboardEntries);

        if (insertError) {
          console.error(`❌ Error inserting leaderboard for ${title.name}:`, insertError);
        } else {
          console.log(`  ✅ Sparade ${leaderboardEntries.length} entries för ${title.name}`);
        }
      } else {
        console.log(`  ℹ️ Inga entries att spara för ${title.name}`);
      }
    }

    console.log('\n🎉 Title leaderboard population komplett!');

    // Visa en sammanfattning av vad som skapades
    console.log('\n📊 SAMMANFATTNING:');
    const { data: finalLeaderboard } = await supabase
      .from('title_leaderboard')
      .select(`
        position,
        value,
        titles(name),
        users(name)
      `);

    if (finalLeaderboard) {
      finalLeaderboard.forEach(entry => {
        console.log(`🏆 ${entry.titles.name} - ${entry.position}: ${entry.users.name} (${entry.value})`);
      });
    }

  } catch (error) {
    console.error('❌ Error in populateTitleLeaderboard:', error);
  }
}

populateTitleLeaderboard();