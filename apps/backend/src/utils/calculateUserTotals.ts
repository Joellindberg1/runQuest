import { createClient } from '@supabase/supabase-js';
import { getLevelFromXP } from './xpCalculation.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function calculateUserTotals(userId: string) {
  try {
    // Get all runs for the user
    const { data: runs, error } = await supabase
      .from('runs')
      .select('xp, distance, date')
      .eq('user_id', userId)
      .order('date', { ascending: true });

    if (error) {
      console.error('Error fetching user runs:', error);
      return;
    }

    if (!runs || runs.length === 0) {
      console.log('No runs found for user');
      return;
    }

    // Calculate totals
    const totalXP = runs.reduce((sum, run) => sum + (run.xp || 0), 0);
    const totalDistance = runs.reduce((sum, run) => sum + (run.distance || 0), 0);
    const totalRuns = runs.length;

    // Calculate level from XP
    const level = getLevelFromXP(totalXP);

    // Calculate current streak
    const currentStreak = calculateCurrentStreak(runs);

    // Update user record with consistent level calculation
    const { error: updateError } = await supabase
      .from('users')
      .update({
        total_xp: totalXP,
        total_distance: totalDistance,
        total_runs: totalRuns,
        current_streak: currentStreak,
        level: level  // Now consistent with frontend!
      })
      .eq('id', userId);

    if (updateError) {
      console.error('Error updating user totals:', updateError);
    } else {
      console.log(`✅ Updated user ${userId} totals: ${totalXP} XP, Level ${level}, ${currentStreak} day streak`);
    }

  } catch (error) {
    console.error('Error in calculateUserTotals:', error);
  }
}

function calculateCurrentStreak(runs: any[]): number {
  if (!runs || runs.length === 0) return 0;

  // Sort runs by date (most recent first)
  const sortedRuns = runs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  
  let streak = 0;
  let currentDate = new Date();
  currentDate.setHours(0, 0, 0, 0); // Start of today
  
  for (const run of sortedRuns) {
    const runDate = new Date(run.date);
    runDate.setHours(0, 0, 0, 0);
    
    const daysDiff = Math.floor((currentDate.getTime() - runDate.getTime()) / (1000 * 60 * 60 * 24));
    
    if (daysDiff === streak) {
      // This run is on the expected day
      streak++;
      currentDate.setDate(currentDate.getDate() - 1); // Move to previous day
    } else if (daysDiff > streak) {
      // Gap in the streak, stop counting
      break;
    }
    // If daysDiff < streak, this run is on the same day as a previous run, continue
  }
  
  return streak;
}