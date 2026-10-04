// 🏃 Run Management Routes
import { logger } from '../utils/logger.js';
import express from 'express';
import { getSupabaseClient } from '../config/database.js';
import { authenticateJWT } from '../middleware/auth.js';
import { calculateUserTotals } from '../utils/calculateUserTotals.js';
import { calculateCompleteRunXP, boostDeltasForRuns, type AdminSettings, type StreakMultiplier, type BoostSpec } from '@runquest/shared';
import { checkEventQualification } from '../services/eventService.js';
import { getXpConfig } from '../services/xpConfig.js';
import { buildPageMeta, fetchOffsetPage, parseOffsetPage } from '../utils/pagination.js';
import type { GroupRunHistoryResponse } from '@runquest/shared';

const router = express.Router();

/**
 * XP-inställningar och multiplikatorer kommer från services/xpConfig (EN källa, ADR 007 B4) —
 * samma värden som GET /api/config/xp visar i UI:t. Cachen invalideras av admin-PUT:arna.
 */
async function fetchAdminSettings(): Promise<{ xpSettings: AdminSettings; multipliers: StreakMultiplier[] }> {
  const config = await getXpConfig();
  return { xpSettings: config.settings, multipliers: config.streak_multipliers };
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

  // Fetch all user boosts (historical — applied per-run below).
  // multiplier_runs är statelös: förbrukningen härleds ur löphistoriken
  // (boostCalculation i @runquest/shared), så omräkning är alltid idempotent.
  const { data: userBoosts } = await supabase
    .from('user_boosts')
    .select('type, delta, remaining, created_at, expires_at')
    .eq('user_id', userId)
    .in('type', ['multiplier_days', 'multiplier_runs']);

  const boostSpecs: BoostSpec[] = await Promise.all(
    (userBoosts ?? []).map(async (b: { type: string; delta: number; remaining: number | null; created_at: string; expires_at: string | null }) => {
      const startDate = b.created_at.slice(0, 10);
      if (b.type === 'multiplier_days') {
        return {
          type: 'multiplier_days' as const,
          delta: Number(b.delta),
          startDate,
          endDate: b.expires_at ? b.expires_at.slice(0, 10) : null,
        };
      }
      // multiplier_runs: räkna laddningar som redan förbrukats av rundor FÖRE
      // omräkningsfönstret (de rundorna räknas inte om och behåller sin XP).
      const { count } = await supabase
        .from('runs')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('date', startDate)
        .lt('date', fromDate);
      return {
        type: 'multiplier_runs' as const,
        delta: Number(b.delta),
        startDate,
        charges: b.remaining ?? 0,
        usedBefore: count ?? 0,
      };
    })
  );

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

  // Boost-delta per runda, förberäknat i datumordning (samma ordning som loopen)
  const boostDeltas = boostDeltasForRuns(runs.map((r: { date: string }) => r.date), boostSpecs);

  // Calculate all updates in memory — zero DB calls per run
  const updates = runs.map((run: { id: string; date: string; distance: number }, runIndex: number) => {
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

    const xp = calculateCompleteRunXP(run.distance, currentStreakCount, xpSettings, multipliers, boostDeltas[runIndex]);
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
    updates.map((u: { id: string; streak_day: number; multiplier: number; base_xp: number; km_xp: number; distance_bonus: number; streak_bonus: number; xp_gained: number }) =>
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

// GET /api/runs/group-history[?limit=&offset=] - Get runs for users in same group (ADR 007 B9)
// Utan parametrar: samma default (100) som tidigare; svaret får additivt meta.
const GROUP_RUNS_PAGE = { defaultLimit: 100, maxLimit: 200 };

router.get('/group-history', authenticateJWT, async (req, res): Promise<void> => {
  try {
    logger.info('📊 Fetching group run history');

    const page = parseOffsetPage(req.query, GROUP_RUNS_PAGE);
    if (!page.ok) {
      res.status(400).json({ error: page.error }); return;
    }
    const { limit, offset } = page;

    // Saknad group_id ger tom data, aldrig alla grupper (ADR 007 A6)
    const groupId = req.user!.group_id;
    if (!groupId) {
      const empty: GroupRunHistoryResponse = { runs: [], meta: buildPageMeta(0, limit, offset) };
      res.json(empty); return;
    }

    const supabase = getSupabaseClient();

    let runsData: any[];
    let total: number;
    try {
      // Unik tie-breaker (created_at, id) — annars dubblerar/tappar offset-sidor rader med lika datum.
      ({ rows: runsData, total } = await fetchOffsetPage(
        (head) => {
          return supabase
            .from('runs')
            .select(`
              *,
              users!inner(name, current_level, profile_picture, total_xp),
              run_weather(weather_code, temperature_c)
            `, { count: 'exact', head })
            .order('date', { ascending: false })
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .eq('users.group_id', groupId);
        },
        limit,
        offset,
      ));
    } catch (runsError) {
      logger.error('❌ Error fetching group runs:', runsError);
      res.status(500).json({ error: 'Failed to fetch group run history' }); return;
    }

    logger.info(`✅ Fetched ${runsData.length} runs for group history`);

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
      is_treadmill: run.is_treadmill ?? null,
      weather_code: run.run_weather?.weather_code ?? null,
      temperature_c: run.run_weather?.temperature_c != null ? parseFloat(run.run_weather.temperature_c.toString()) : null,
      user_name: run.users.name,
      user_level: run.users.current_level,
      user_total_xp: run.users.total_xp,
      user_profile_picture: run.users.profile_picture || undefined,
      start_time: run.start_time ?? null,
      created_at: run.created_at ?? null,
    })) || [];

    const body: GroupRunHistoryResponse = { runs, meta: buildPageMeta(total, limit, offset) };
    res.json(body);
  } catch (error) {
    logger.error('❌ Error in group history endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Gemensam indatavalidering för POST och PUT (bugg #8: PUT saknade POST:ens
 * regler). Returnerar felmeddelande eller null + parsad distans.
 */
function validateRunInput(date: string | undefined, distance: unknown): { error: string | null; distanceNum: number } {
  const distanceNum = parseFloat(String(distance));
  if (isNaN(distanceNum) || distanceNum < 1.0) {
    return { error: 'Distance must be at least 1.0 km', distanceNum };
  }
  if (date !== undefined) {
    const runDate = new Date(date);
    const minDate = new Date('2025-06-01');
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    if (isNaN(runDate.getTime())) return { error: 'Invalid date', distanceNum };
    if (runDate < minDate) return { error: 'Cannot log runs before June 1, 2025', distanceNum };
    if (runDate > today) return { error: 'Cannot log runs for future dates', distanceNum };
  }
  return { error: null, distanceNum };
}

// POST /api/runs - Create a new run
router.post('/', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const { date, distance, source = 'manual', is_treadmill } = req.body;
    const userId = req.user!.user_id;

    logger.info('📝 Create run request:', { userId, date, distance, source, is_treadmill });

    if (!date || !distance) {
      res.status(400).json({ error: 'Date and distance are required' }); return;
    }

    const { error: validationError, distanceNum } = validateRunInput(date, distance);
    if (validationError) {
      res.status(400).json({ error: validationError }); return;
    }

    // Utelämnat → NULL (dagens beteende för manuella rundor); event-/väderlogik skiljer på false och NULL.
    if (is_treadmill !== undefined && typeof is_treadmill !== 'boolean') {
      res.status(400).json({ error: 'is_treadmill must be a boolean' }); return;
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
        xp_gained: 0,
        ...(is_treadmill !== undefined && { is_treadmill }),
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

    // Check if this run qualifies for any active events (fire-and-forget, non-blocking)
    checkEventQualification({
      userId,
      runId: newRun.id,
      runDate: date,
      distanceKm: distanceNum,
      groupId: req.user!.group_id,
    }).catch(e => logger.error('❌ checkEventQualification error:', e));

    // Fetch the fully processed run
    const { data: processedRun, error: fetchError } = await supabase
      .from('runs')
      .select('id, user_id, date, distance, xp_gained, multiplier, streak_day, base_xp, km_xp, distance_bonus, streak_bonus, source, external_id, is_treadmill')
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

    const { error: validationError, distanceNum: newDistance } = validateRunInput(date, distance);
    if (validationError) {
      res.status(400).json({ error: validationError }); return;
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
