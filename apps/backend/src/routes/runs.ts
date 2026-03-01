// 🏃 Run Management Routes
import { logger } from '../utils/logger.js';
import express from 'express';
import { getSupabaseClient } from '../config/database.js';
import { authenticateJWT } from '../middleware/auth.js';
import { calculateUserTotals } from '../utils/calculateUserTotals.js';
import { calculateCompleteRunXP, type AdminSettings, type StreakMultiplier } from '@runquest/shared';

const router = express.Router();

/** Fetch XP settings and streak multipliers in a single DB call. */
async function fetchAdminSettings(): Promise<{ xpSettings: AdminSettings; multipliers: StreakMultiplier[] }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('admin_settings')
    .select('base_xp, xp_per_km, bonus_5km, bonus_10km, bonus_15km, bonus_20km, min_run_distance, streak_multipliers')
    .single();

  if (error || !data) {
    logger.warn('⚠️ Could not fetch admin settings, using defaults');
    return {
      xpSettings: { base_xp: 15, xp_per_km: 2, bonus_5km: 5, bonus_10km: 15, bonus_15km: 25, bonus_20km: 50, min_run_distance: 1.0 },
      multipliers: [
        { days: 270, multiplier: 2.0 }, { days: 240, multiplier: 1.9 }, { days: 220, multiplier: 1.8 },
        { days: 180, multiplier: 1.7 }, { days: 120, multiplier: 1.6 }, { days: 90, multiplier: 1.5 },
        { days: 60, multiplier: 1.4 },  { days: 30, multiplier: 1.3 },  { days: 15, multiplier: 1.2 },
        { days: 5, multiplier: 1.1 }
      ]
    };
  }

  return {
    xpSettings: {
      base_xp: data.base_xp, xp_per_km: data.xp_per_km,
      bonus_5km: data.bonus_5km, bonus_10km: data.bonus_10km,
      bonus_15km: data.bonus_15km, bonus_20km: data.bonus_20km,
      min_run_distance: data.min_run_distance
    },
    multipliers: data.streak_multipliers ?? []
  };
}

/**
 * Exported for use by Strava sync.
 * Reprocess runs from a given date onwards for a user.
 * Only runs at or after fromDate are recalculated — earlier runs are unaffected.
 * The streak context from the run immediately before fromDate is preserved.
 */
export async function reprocessRunsFromDate(userId: string, fromDate: string): Promise<void> {
  logger.info(`🔄 Reprocessing runs from ${fromDate} for user ${userId}...`);
  const supabase = getSupabaseClient();

  // Fetch settings once — no per-run DB calls
  const { xpSettings, multipliers } = await fetchAdminSettings();

  // Get the run immediately before fromDate to seed the streak count correctly
  const { data: prevRuns } = await supabase
    .from('runs')
    .select('date, streak_day')
    .eq('user_id', userId)
    .lt('date', fromDate)
    .order('date', { ascending: false })
    .limit(1);

  const prevRun = prevRuns?.[0] ?? null;
  let currentStreakCount = prevRun?.streak_day ?? 0;
  let lastRunDate: Date | null = prevRun ? new Date(prevRun.date) : null;

  // Fetch only the affected runs
  const { data: runs, error } = await supabase
    .from('runs')
    .select('id, date, distance')
    .eq('user_id', userId)
    .gte('date', fromDate)
    .order('date', { ascending: true });

  if (error || !runs?.length) {
    if (error) logger.error('❌ Error fetching runs to reprocess:', error);
    return;
  }

  logger.info(`📊 Reprocessing ${runs.length} affected runs (of user's total)`);

  // Calculate all updates in memory — zero DB calls per run
  const updates = runs.map(run => {
    const runDate = new Date(run.date);
    const daysDiff = lastRunDate
      ? Math.floor((runDate.getTime() - lastRunDate.getTime()) / (1000 * 60 * 60 * 24))
      : -1;

    if (!lastRunDate || daysDiff > 1) {
      currentStreakCount = 1;
    } else if (daysDiff === 1) {
      currentStreakCount++;
    }
    // daysDiff === 0 (same day): keep streak count as-is

    const xp = calculateCompleteRunXP(run.distance, currentStreakCount, xpSettings, multipliers);
    lastRunDate = runDate;

    return {
      id: run.id,
      streak_day: currentStreakCount,
      multiplier: xp.multiplier,
      base_xp: xp.baseXP,
      km_xp: xp.kmXP,
      distance_bonus: xp.distanceBonus,
      streak_bonus: xp.streakBonus,
      xp_gained: xp.finalXP
    };
  });

  // Parallel updates instead of sequential
  await Promise.all(
    updates.map(u =>
      supabase.from('runs').update({
        streak_day: u.streak_day,
        multiplier: u.multiplier,
        base_xp: u.base_xp,
        km_xp: u.km_xp,
        distance_bonus: u.distance_bonus,
        streak_bonus: u.streak_bonus,
        xp_gained: u.xp_gained
      }).eq('id', u.id)
    )
  );

  logger.info(`✅ Reprocessed ${runs.length} runs successfully`);
}

// GET /api/runs/group-history - Get all runs for users in same group
router.get('/group-history', authenticateJWT, async (req, res): Promise<void> => {
  try {
    logger.info('📊 Fetching group run history');

    const supabase = getSupabaseClient();
    const groupId = req.user!.group_id;

    let query = supabase
      .from('runs')
      .select(`
        *,
        users!inner(name, current_level, profile_picture, total_xp)
      `)
      .order('date', { ascending: false })
      .limit(100);

    if (groupId) {
      query = query.eq('users.group_id', groupId);
    }

    const { data: runsData, error: runsError } = await query;

    if (runsError) {
      logger.error('❌ Error fetching group runs:', runsError);
      res.status(500).json({ error: 'Failed to fetch group run history' }); return;
    }

    logger.info(`✅ Fetched ${runsData?.length || 0} runs for group history`);

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
    logger.error('❌ Error in group history endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/runs - Create a new run
router.post('/', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const { date, distance, source = 'manual' } = req.body;
    const userId = req.user!.user_id;

    logger.info('📝 Create run request:', { userId, date, distance, source });

    if (!date || !distance) {
      res.status(400).json({ error: 'Date and distance are required' }); return;
    }

    const distanceNum = parseFloat(distance);
    if (isNaN(distanceNum) || distanceNum < 1.0) {
      res.status(400).json({ error: 'Distance must be at least 1.0 km' }); return;
    }

    // Validate date
    const runDate = new Date(date);
    const minDate = new Date('2025-06-01');
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    if (runDate < minDate) {
      res.status(400).json({ error: 'Cannot log runs before June 1, 2025' }); return;
    }

    if (runDate > today) {
      res.status(400).json({ error: 'Cannot log runs for future dates' }); return;
    }

    logger.info(`✅ Creating run for user ${userId}: ${distanceNum}km on ${date}`);

    const supabase = getSupabaseClient();

    // Insert with placeholder XP — reprocessRunsFromDate recalculates correctly right after
    const { data: newRun, error: insertError } = await supabase
      .from('runs')
      .insert({
        user_id: userId,
        date: date,
        distance: distanceNum,
        source: source,
        base_xp: 0,
        km_xp: 0,
        distance_bonus: 0,
        streak_bonus: 0,
        multiplier: 1.0,
        streak_day: 1,
        xp_gained: 0
      })
      .select('id')
      .single();

    if (insertError) {
      logger.error('❌ Error inserting run:', insertError);
      res.status(500).json({ error: 'Failed to create run' }); return;
    }

    logger.info(`✅ Run created, reprocessing from ${date}...`);

    // Only reprocess from this run's date — earlier runs are unaffected
    await reprocessRunsFromDate(userId, date);

    // Recalculate user totals (scoped to user's group for title processing)
    await calculateUserTotals(userId, req.user!.group_id);

    // Fetch the fully processed run
    const { data: processedRun, error: fetchError } = await supabase
      .from('runs')
      .select('id, user_id, date, distance, xp_gained, multiplier, streak_day, base_xp, km_xp, distance_bonus, streak_bonus, source, external_id')
      .eq('id', newRun.id)
      .single();

    if (fetchError) {
      logger.warn('⚠️ Could not fetch processed run:', fetchError);
    }

    logger.info(`✅ Run created successfully with ${processedRun?.xp_gained || 0} XP`)

    res.json({
      success: true,
      message: 'Run created successfully',
      run: processedRun || newRun
    });

  } catch (error) {
    logger.error('❌ Error creating run:', error);
    res.status(500).json({ error: 'Internal server error' }); return;
  }
});

// PUT /api/runs/:id - Update a run
router.put('/:id', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const { id } = req.params;
    const { distance, date } = req.body;
    const userId = req.user!.user_id;

    logger.info('📝 Update request:', { id, distance, date, userId });

    if (!distance) {
      res.status(400).json({ error: 'Distance is required' }); return;
    }

    const newDistance = parseFloat(distance);
    if (isNaN(newDistance) || newDistance <= 0) {
      res.status(400).json({ error: 'Invalid distance' }); return;
    }

    logger.info(`🔄 Updating run ${id} for user ${userId}`);

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
      logger.error('❌ Error updating run:', updateError);
      res.status(500).json({ error: 'Failed to update run' }); return;
    }

    if (dateChanged) {
      // Date changed — reprocess from the earlier of old and new date
      const fromDate = existingRun.date < date ? existingRun.date : date;
      logger.info(`🔄 Date changed (${existingRun.date} → ${date}), reprocessing from ${fromDate}`);
      await reprocessRunsFromDate(userId, fromDate);
    } else if (distanceChanged) {
      // Only distance changed — reprocess just this run's date (streak order unchanged)
      logger.info(`⚡ Distance changed, reprocessing from ${existingRun.date}`);
      await reprocessRunsFromDate(userId, existingRun.date);
    }

    // Recalculate user totals (scoped to user's group for title processing)
    await calculateUserTotals(userId, req.user!.group_id);

    logger.info('\n' + '='.repeat(80));
    logger.info('✅ BACKEND: UPDATE COMPLETE');
    logger.info('='.repeat(80) + '\n');

    // Fetch the updated run to return
    const { data: updatedRun, error: fetchUpdatedError } = await supabase
      .from('runs')
      .select('id, user_id, date, distance, xp_gained, multiplier, streak_day, base_xp, km_xp, distance_bonus, streak_bonus, source, external_id')
      .eq('id', id)
      .single();

    if (fetchUpdatedError) {
      logger.warn('⚠️ Could not fetch updated run:', fetchUpdatedError);
    }

    logger.info(`✅ Run ${id} updated and all runs reprocessed successfully`);

    res.json({
      success: true,
      message: 'Run updated successfully',
      run: updatedRun
    });

  } catch (error) {
    logger.error('❌ Error updating run:', error);
    res.status(500).json({ error: 'Internal server error' }); return;
  }
});

// DELETE /api/runs/:id - Delete a run
router.delete('/:id', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = req.user!.user_id;

    logger.info(`🗑️ Deleting run ${id} for user ${userId}`);

    const supabase = getSupabaseClient();

    // Verify run belongs to user and fetch date for targeted reprocess
    const { data: existingRun, error: fetchError } = await supabase
      .from('runs')
      .select('user_id, date')
      .eq('id', id)
      .single();

    if (fetchError || !existingRun) {
      res.status(404).json({ error: 'Run not found' }); return;
    }

    if (existingRun.user_id !== userId) {
      res.status(403).json({ error: 'Not authorized to delete this run' }); return;
    }

    const deletedDate = existingRun.date;

    // Delete the run
    const { error: deleteError } = await supabase
      .from('runs')
      .delete()
      .eq('id', id);

    if (deleteError) {
      logger.error('❌ Error deleting run:', deleteError);
      res.status(500).json({ error: 'Failed to delete run' }); return;
    }

    logger.info(`✅ Run deleted, reprocessing from ${deletedDate}...`);

    // Reprocess only runs from the deleted run's date onwards
    await reprocessRunsFromDate(userId, deletedDate);

    // Recalculate user totals (scoped to user's group for title processing)
    await calculateUserTotals(userId, req.user!.group_id);

    logger.info(`✅ Run ${id} deleted and all runs reprocessed successfully`);

    res.json({
      success: true,
      message: 'Run deleted successfully'
    });

  } catch (error) {
    logger.error('❌ Error deleting run:', error);
    res.status(500).json({ error: 'Internal server error' }); return;
  }
});

export default router;
