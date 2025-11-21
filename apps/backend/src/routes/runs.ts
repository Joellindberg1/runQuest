// 🏃 Run Management Routes
import express from 'express';
import { getSupabaseClient } from '../config/database.js';
import { authenticateJWT } from '../middleware/auth.js';
import { calculateUserTotals } from '../utils/calculateUserTotals.js';
import { calculateRunXP } from '../utils/xpCalculation.js';

const router = express.Router();

// Helper function to get streak multiplier based on admin settings
async function getStreakMultiplier(streakDay: number): Promise<number> {
  const supabase = getSupabaseClient();
  
  const { data: multipliers, error } = await supabase
    .from('admin_settings')
    .select('streak_multipliers')
    .single();
    
  if (error || !multipliers?.streak_multipliers) {
    console.warn('Could not fetch streak multipliers, using defaults');
    // Fallback defaults
    if (streakDay >= 270) return 2.0;
    if (streakDay >= 240) return 1.9;
    if (streakDay >= 220) return 1.8;
    if (streakDay >= 180) return 1.7;
    if (streakDay >= 120) return 1.6;
    if (streakDay >= 90) return 1.5;
    if (streakDay >= 60) return 1.4;
    if (streakDay >= 30) return 1.3;
    if (streakDay >= 15) return 1.2;
    if (streakDay >= 5) return 1.1;
    return 1.0;
  }
  
  // Find the highest multiplier threshold that the streak meets
  const sortedMultipliers = multipliers.streak_multipliers.sort((a: any, b: any) => b.days - a.days);
  const applicableMultiplier = sortedMultipliers.find((m: any) => streakDay >= m.days);
  
  return applicableMultiplier ? applicableMultiplier.multiplier : 1.0;
}

// Helper function to reprocess all runs for a user
async function reprocessAllUserRuns(userId: string): Promise<void> {
  console.log(`🔄 Reprocessing all runs for user ${userId}...`);
  
  const supabase = getSupabaseClient();
  
  // Get all runs sorted by date
  const { data: runs, error } = await supabase
    .from('runs')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: true });
    
  if (error || !runs) {
    console.error('❌ Error fetching runs:', error);
    return;
  }
  
  console.log(`📊 Found ${runs.length} runs to reprocess`);
  
  // Calculate streaks and XP for each run
  let currentStreakCount = 0;
  let lastRunDate: Date | null = null;
  
  for (const run of runs) {
    const runDate = new Date(run.date);
    
    // Calculate streak
    if (!lastRunDate) {
      currentStreakCount = 1;
    } else {
      const daysDiff = Math.floor((runDate.getTime() - lastRunDate.getTime()) / (1000 * 60 * 60 * 24));
      if (daysDiff === 1) {
        currentStreakCount++;
      } else if (daysDiff === 0) {
        // Same day, keep streak count
      } else {
        currentStreakCount = 1; // Reset streak
      }
    }
    
    // Get multiplier for this streak
    const multiplier = await getStreakMultiplier(currentStreakCount);
    
    // Calculate XP components
    const xpCalc = await calculateRunXP(run.distance);
    const baseXP = xpCalc.baseXP;
    const kmXP = xpCalc.kmXP;
    const distanceBonus = xpCalc.distanceBonus;
    
    // Apply multiplier to base + km XP, then add distance bonus
    const streakBonus = Math.floor((baseXP + kmXP) * (multiplier - 1.0));
    const totalXPGained = Math.floor((baseXP + kmXP) * multiplier) + distanceBonus;
    
    console.log(`  📍 Run ${run.date}: ${run.distance}km, Streak ${currentStreakCount}, Mult ${multiplier}x, XP ${totalXPGained}`);
    
    // Update the run with recalculated values
    const { error: updateError } = await supabase
      .from('runs')
      .update({
        streak_day: currentStreakCount,
        multiplier: multiplier,
        base_xp: baseXP,
        km_xp: kmXP,
        distance_bonus: distanceBonus,
        streak_bonus: streakBonus,
        xp_gained: totalXPGained
      })
      .eq('id', run.id);
      
    if (updateError) {
      console.error(`❌ Error updating run ${run.id}:`, updateError);
    }
    
    lastRunDate = runDate;
  }
  
  console.log(`✅ Reprocessed ${runs.length} runs successfully`);
}

// GET /api/runs/group-history - Get all runs with user info for group history
router.get('/group-history', authenticateJWT, async (_req, res): Promise<void> => {
  try {
    console.log('📊 Fetching group run history');

    const supabase = getSupabaseClient();

    const { data: runsData, error: runsError } = await supabase
      .from('runs')
      .select(`
        *,
        users!inner(name, current_level, profile_picture, total_xp)
      `)
      .order('date', { ascending: false })
      .limit(100);

    if (runsError) {
      console.error('❌ Error fetching group runs:', runsError);
      res.status(500).json({ error: 'Failed to fetch group run history' }); return;
    }

    console.log(`✅ Fetched ${runsData?.length || 0} runs for group history`);

    const runs = runsData?.map((run: any) => ({
      id: run.id,
      user_id: run.user_id,
      date: run.date,
      distance: parseFloat(run.distance.toString()),
      xp_gained: run.xp_gained,
      multiplier: parseFloat(run.multiplier.toString()),
      streak_day: run.streak_day,
      base_xp: run.base_xp,
      km_xp: run.km_xp,
      distance_bonus: run.distance_bonus,
      streak_bonus: run.streak_bonus,
      source: run.source || undefined,
      user_name: run.users.name,
      user_level: run.users.current_level,
      user_total_xp: run.users.total_xp,
      user_profile_picture: run.users.profile_picture || undefined
    })) || [];

    res.json({ runs });
  } catch (error) {
    console.error('❌ Error in group history endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/runs/:id - Update a run
router.put('/:id', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const { id } = req.params;
    const { distance, date } = req.body;
    const userId = req.user!.user_id;

    console.log('📝 Update request:', { id, distance, date, userId });

    if (!distance) {
      res.status(400).json({ error: 'Distance is required' }); return;
    }

    const newDistance = parseFloat(distance);
    if (isNaN(newDistance) || newDistance <= 0) {
      res.status(400).json({ error: 'Invalid distance' }); return;
    }

    console.log(`🔄 Updating run ${id} for user ${userId}`);

    const supabase = getSupabaseClient();

    // Verify run belongs to user and get old date
    const { data: existingRun, error: fetchError } = await supabase
      .from('runs')
      .select('user_id, date, distance, streak_day')
      .eq('id', id)
      .single();

    if (fetchError || !existingRun) {
      res.status(404).json({ error: 'Run not found' }); return;
    }

    if (existingRun.user_id !== userId) {
      res.status(403).json({ error: 'Not authorized to update this run' }); return;
    }

    // Check if date changed (requires full reprocess)
    const dateChanged = date && date !== existingRun.date;
    const distanceChanged = Math.abs(newDistance - existingRun.distance) > 0.01;

    // Update only the distance and optionally the date
    const updateData: any = { distance: newDistance };
    if (date) {
      updateData.date = date;
    }

    const { error: updateError } = await supabase
      .from('runs')
      .update(updateData)
      .eq('id', id);

    if (updateError) {
      console.error('❌ Error updating run:', updateError);
      res.status(500).json({ error: 'Failed to update run' }); return;
    }

    if (dateChanged) {
      // Date changed - need to reprocess all runs (streak order may change)
      console.log('\n' + '='.repeat(80));
      console.log('🔄 BACKEND: DATE CHANGED - REPROCESSING ALL RUNS');
      console.log(`👤 User: ${userId}`);
      console.log(`🏃 Updated run: ${id}`);
      console.log(`📅 Date: ${existingRun.date} → ${date}`);
      console.log('='.repeat(80) + '\n');

      await reprocessAllUserRuns(userId);
    } else if (distanceChanged) {
      // Only distance changed - recalculate XP for this run only
      console.log('\n' + '='.repeat(80));
      console.log('⚡ BACKEND: FAST UPDATE - Only recalculating this run');
      console.log(`👤 User: ${userId}`);
      console.log(`🏃 Updated run: ${id}`);
      console.log(`📏 Distance: ${existingRun.distance}km → ${newDistance}km`);
      console.log('='.repeat(80) + '\n');

      // Recalculate XP for this run only, keeping existing streak_day and multiplier
      const multiplier = await getStreakMultiplier(existingRun.streak_day);
      const xpCalc = await calculateRunXP(newDistance);
      const baseXP = xpCalc.baseXP;
      const kmXP = xpCalc.kmXP;
      const distanceBonus = xpCalc.distanceBonus;
      const streakBonus = Math.floor((baseXP + kmXP) * (multiplier - 1.0));
      const totalXPGained = Math.floor((baseXP + kmXP) * multiplier) + distanceBonus;

      console.log(`  📍 Recalculated: ${newDistance}km, Streak ${existingRun.streak_day}, Mult ${multiplier}x, XP ${totalXPGained}`);

      const { error: updateXPError } = await supabase
        .from('runs')
        .update({
          base_xp: baseXP,
          km_xp: kmXP,
          distance_bonus: distanceBonus,
          streak_bonus: streakBonus,
          xp_gained: totalXPGained,
          multiplier: multiplier
        })
        .eq('id', id);

      if (updateXPError) {
        console.error('❌ Error updating XP:', updateXPError);
      }

      console.log('\n' + '='.repeat(80));
      console.log('✅ BACKEND: FAST UPDATE COMPLETE');
      console.log('='.repeat(80) + '\n');
    }

    // Recalculate user totals (always needed)
    await calculateUserTotals(userId);

    console.log('\n' + '='.repeat(80));
    console.log('✅ BACKEND: UPDATE COMPLETE');
    console.log('='.repeat(80) + '\n');

    // Fetch the updated run to return
    const { data: updatedRun, error: fetchUpdatedError } = await supabase
      .from('runs')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchUpdatedError) {
      console.warn('⚠️ Could not fetch updated run:', fetchUpdatedError);
    }

    console.log(`✅ Run ${id} updated and all runs reprocessed successfully`);

    res.json({
      success: true,
      message: 'Run updated successfully',
      run: updatedRun
    });

  } catch (error) {
    console.error('❌ Error updating run:', error);
    res.status(500).json({ error: 'Internal server error' }); return;
  }
});

// DELETE /api/runs/:id - Delete a run
router.delete('/:id', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = req.user!.user_id;

    console.log(`🗑️ Deleting run ${id} for user ${userId}`);

    const supabase = getSupabaseClient();

    // Verify run belongs to user
    const { data: existingRun, error: fetchError } = await supabase
      .from('runs')
      .select('user_id')
      .eq('id', id)
      .single();

    if (fetchError || !existingRun) {
      res.status(404).json({ error: 'Run not found' }); return;
    }

    if (existingRun.user_id !== userId) {
      res.status(403).json({ error: 'Not authorized to delete this run' }); return;
    }

    // Delete the run
    const { error: deleteError } = await supabase
      .from('runs')
      .delete()
      .eq('id', id);

    if (deleteError) {
      console.error('❌ Error deleting run:', deleteError);
      res.status(500).json({ error: 'Failed to delete run' }); return;
    }

    console.log(`✅ Run deleted, now reprocessing all runs for user ${userId}...`);

    // Reprocess ALL runs for this user to recalculate XP, streaks, and multipliers
    await reprocessAllUserRuns(userId);

    // Recalculate user totals after deletion
    await calculateUserTotals(userId);

    console.log(`✅ Run ${id} deleted and all runs reprocessed successfully`);

    res.json({
      success: true,
      message: 'Run deleted successfully'
    });

  } catch (error) {
    console.error('❌ Error deleting run:', error);
    res.status(500).json({ error: 'Internal server error' }); return;
  }
});

export default router;
