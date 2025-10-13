/**
 * Debug script to check Weekend Destroyer title requirements and user values
 */

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function debugWeekendTitle() {
  console.log('\n🔍 DEBUGGING WEEKEND DESTROYER TITLE\n');

  // 1. Check title configuration
  const { data: titles } = await supabase
    .from('titles')
    .select('*')
    .eq('name', 'The Weekend Destroyer')
    .single();

  console.log('📋 Title Configuration:');
  console.log(JSON.stringify(titles, null, 2));
  console.log(`Unlock Requirement: ${titles?.unlock_requirement}`);

  // 2. Check user_titles for Weekend Destroyer
  const { data: userTitles } = await supabase
    .from('user_titles')
    .select('*, users(name), titles(name)')
    .eq('title_id', titles.id);

  console.log('\n👥 User Titles for Weekend Destroyer:');
  console.log(JSON.stringify(userTitles, null, 2));

  // 3. Check title_leaderboard
  const { data: leaderboard } = await supabase
    .from('title_leaderboard')
    .select('*, users(name), titles(name)')
    .eq('title_id', titles.id)
    .order('position', { ascending: true });

  console.log('\n🏆 Title Leaderboard for Weekend Destroyer:');
  console.log(JSON.stringify(leaderboard, null, 2));

  // 4. Get Joel's weekend runs
  const { data: users } = await supabase
    .from('users')
    .select('*')
    .eq('name', 'Joel Lindberg')
    .single();

  if (users) {
    const { data: runs } = await supabase
      .from('runs')
      .select('date, distance')
      .eq('user_id', users.id)
      .order('date', { ascending: true });

    console.log('\n🏃 Joel\'s Weekend Runs:');
    const weekendRuns = runs?.filter(run => {
      const day = new Date(run.date).getDay();
      return day === 0 || day === 6;
    });
    
    console.log(`Total weekend runs: ${weekendRuns?.length}`);
    weekendRuns?.forEach(run => {
      const date = new Date(run.date);
      const dayName = date.getDay() === 0 ? 'Sunday' : 'Saturday';
      console.log(`  ${date.toISOString().split('T')[0]} (${dayName}): ${run.distance} km`);
    });

    // Calculate weekend average
    if (weekendRuns && weekendRuns.length > 0) {
      const weekendGroups = new Map();
      
      for (const run of weekendRuns) {
        const date = new Date(run.date);
        const dayOfWeek = date.getDay();
        const saturday = new Date(date);
        if (dayOfWeek === 0) saturday.setDate(date.getDate() - 1);
        saturday.setHours(0, 0, 0, 0);
        const weekKey = saturday.toISOString().split('T')[0];
        
        if (!weekendGroups.has(weekKey)) weekendGroups.set(weekKey, []);
        weekendGroups.get(weekKey).push(run);
      }

      console.log('\n📊 Weekend Groupings:');
      const weekendAverages = [];
      for (const [weekKey, weekRuns] of weekendGroups.entries()) {
        const weekTotal = weekRuns.reduce((sum, run) => sum + parseFloat(run.distance), 0);
        const weekAvg = weekTotal / weekRuns.length;
        weekendAverages.push({ date: new Date(weekKey), avg: weekAvg });
        console.log(`  Week of ${weekKey}: ${weekRuns.length} runs, avg ${weekAvg.toFixed(2)} km`);
      }

      const recentWeekends = weekendAverages
        .sort((a, b) => b.date.getTime() - a.date.getTime())
        .slice(0, 4);

      const totalAvg = recentWeekends.reduce((sum, w) => sum + w.avg, 0) / recentWeekends.length;
      console.log(`\n✅ Final Weekend Average: ${totalAvg.toFixed(2)} km`);
      console.log(`   Based on ${recentWeekends.length} weekends: ${recentWeekends.map(w => w.avg.toFixed(2)).join(', ')}`);
    }
  }
}

debugWeekendTitle().catch(console.error);
