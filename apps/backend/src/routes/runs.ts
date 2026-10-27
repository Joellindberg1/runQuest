// 🏃 Run Management Routes
import { logger } from '../utils/logger.js';
import { errorCode, errorWithCode } from '../utils/errorCode.js';
import express from 'express';
import { getSupabaseClient } from '../config/database.js';
import { authenticateJWT } from '../middleware/auth.js';
import { calculateUserTotals } from '../utils/calculateUserTotals.js';
import {
  advanceStreakDay, calculateCompleteRunXP, boostDeltasForRuns, boostWindow, MANUAL_RUN_MIN_DISTANCE_KM, MIN_RUN_DATE, MIN_RUN_DATE_LABEL, isCalendarDay, zoneDay,
  type AdminSettings, type StreakMultiplier, type BoostSpec, type BoostRow, type PreviousRunDay,
} from '@runquest/shared';
import { groupTimeZone } from '../utils/groupTimeZone.js';
import { checkEventQualification } from '../services/eventService.js';
import { getXpConfig } from '../services/xpConfig.js';
import { buildPageMeta, fetchOffsetPage, parseOffsetPage } from '../utils/pagination.js';
import { IDEMPOTENCY_KEY_HEADER, parseIdempotencyKey } from '../utils/idempotencyKey.js';
import type { CreateRunRequest, CreateRunResponse, DeleteRunResponse, GroupRunHistoryResponse, UpdateRunRequest, UpdateRunResponse } from '@runquest/shared';
import { fail, failWritten, okWithLegacy } from '../utils/respond.js';
import { groupIdOrRespondEmpty, tokenGroupId } from '../utils/groupScope.js';

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
  const { data: userBoosts, error: boostsError } = await supabase
    .from('user_boosts')
    .select('type, delta, remaining, created_at, expires_at, start_date, end_date')
    .eq('user_id', userId)
    .in('type', ['multiplier_days', 'multiplier_runs']);
  // Alla läsningar kastar vid fel (RUN-215): en omräkning på ofullständig indata skriver fel XP/streak till rundorna.
  if (boostsError) throw errorWithCode(`Failed to fetch boosts for reprocess (user ${userId})`, boostsError);

  // Boostens fönster är det som sparades på raden när boosten skapades (settleChallenge, gruppens dygn; migration 059 backfyllde de gamla med deras
  // UTC-dagar). Fönstret räknas inte om här, så en gammal boost ger samma XP som förut och en ny exakt sina n dagar. En rad utan sparat fönster läses
  // med det gamla UTC-fönstret (shared/boostWindow).
  const boostSpecs: BoostSpec[] = await Promise.all(
    (userBoosts ?? []).map(async (b: BoostRow & { delta: number; remaining: number | null }) => {
      const { startDay: startDate, endDay } = boostWindow(b);
      if (b.type === 'multiplier_days') {
        return {
          type: 'multiplier_days' as const,
          delta: Number(b.delta),
          startDate,
          endDate: endDay,
        };
      }
      // multiplier_runs: räkna laddningar som redan förbrukats av rundor FÖRE
      // omräkningsfönstret (de rundorna räknas inte om och behåller sin XP).
      const { count, error: usedError } = await supabase
        .from('runs')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('date', startDate)
        .lt('date', fromDate);
      if (usedError) throw errorWithCode(`Failed to count used boost charges for reprocess (user ${userId})`, usedError);
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
  const { data: prevRuns, error: prevError } = await supabase
    .from('runs')
    .select('date, streak_day')
    .eq('user_id', userId)
    .lt('date', fromDate)
    .order('date', { ascending: false })
    .limit(1);
  if (prevError) throw errorWithCode(`Failed to fetch previous run for reprocess (user ${userId})`, prevError);

  const prevRun = prevRuns?.[0] ?? null;
  let previous: PreviousRunDay | null = prevRun ? { day: prevRun.date, streakDay: prevRun.streak_day ?? 0 } : null;

  // Fetch only the affected runs
  const { data: runs, error } = await supabase
    .from('runs')
    .select('id, date, distance')
    .eq('user_id', userId)
    .gte('date', fromDate)
    .order('date', { ascending: true });

  // Kastade fel bär koden men aldrig databastexten (ett Postgres-fel kan bära radens värden, ADR 010 8.6). Loggen sker en gång, hos
  // anroparen som fångar (tryReprocessRunsFromDate, Strava-synken, webhook-workern), så att ett fel inte blir två Sentry-händelser.
  if (error) throw errorWithCode(`Failed to fetch runs to reprocess (user ${userId})`, error);
  if (!runs?.length) return;

  logger.info(`📊 Reprocessing ${runs.length} affected runs (of user's total)`);

  // Boost-delta per runda, förberäknat i datumordning (samma ordning som loopen)
  const boostDeltas = boostDeltasForRuns(runs.map((r: { date: string }) => r.date), boostSpecs);

  // Calculate all updates in memory — zero DB calls per run
  const updates = runs.map((run: { id: string; date: string; distance: number }, runIndex: number) => {
    // Samma dag som föregående runda behåller dagen, dagen efter ökar den, ett glapp nollställer (shared/streak.ts).
    const streakDay = advanceStreakDay(previous, run.date);
    previous = { day: run.date, streakDay };

    const xp = calculateCompleteRunXP(run.distance, streakDay, xpSettings, multipliers, boostDeltas[runIndex]);

    return {
      id: run.id,
      streak_day: streakDay,
      multiplier: xp.multiplier,
      base_xp: xp.baseXP,
      km_xp: xp.kmXP,
      distance_bonus: xp.distanceBonus,
      streak_bonus: xp.streakBonus,
      xp_gained: xp.finalXP
    };
  });

  // Parallel updates instead of sequential. supabase-js kastar inte på {error}: varje svar kontrolleras, så att en
  // misslyckad rad aldrig rapporteras som "Reprocessed". Alla rader försöker skrivas; felet kastas efteråt.
  const updateResults = await Promise.all(
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
  const failedUpdates = updateResults.filter((r: { error: { message: string; code?: string } | null }) => r.error);
  // Som ovan: antal, användar-id och felkoden för det första felet, aldrig databastexten; fångstället loggar.
  if (failedUpdates.length > 0) {
    throw errorWithCode(`${failedUpdates.length} of ${updates.length} run updates failed during reprocess (user ${userId})`, failedUpdates[0].error);
  }

  logger.info(`✅ Reprocessed ${runs.length} runs successfully`);
}

/**
 * Kör omräkningen men kastar inte: returnerar false vid fel. Rutterna anropar calculateUserTotals ändå (best-effort,
 * den kastar aldrig) och svarar sedan 500 — ett reprocess-fel får inte lämna totalerna sämre än före RUN-215, då
 * totalerna alltid räknades om. Rundor som hann få placeholder-XP rättas av nästa skrivning/omräkning från samma datum.
 */
async function tryReprocessRunsFromDate(userId: string, fromDate: string): Promise<boolean> {
  try {
    await reprocessRunsFromDate(userId, fromDate);
    return true;
  } catch (e) {
    logger.error(`❌ Reprocess from ${fromDate} failed for user ${userId} (${errorCode(e)})`);
    return false;
  }
}

// GET /api/runs/group-history[?limit=&offset=] - Get runs for users in same group (ADR 007 B9)
// Utan parametrar: samma default (100) som tidigare; svaret får additivt meta.
const GROUP_RUNS_PAGE = { defaultLimit: 100, maxLimit: 200 };

router.get('/group-history', authenticateJWT, async (req, res): Promise<void> => {
  try {
    logger.info('📊 Fetching group run history');

    const page = parseOffsetPage(req.query, GROUP_RUNS_PAGE);
    if (!page.ok) {
      fail(res, 400, page.error); return;
    }
    const { limit, offset } = page;

    // Saknad group_id ger tom data, aldrig alla grupper (ADR 007 A6)
    const emptyBody = { success: true, runs: [], data: { runs: [] }, meta: buildPageMeta(0, limit, offset) } satisfies GroupRunHistoryResponse;
    const groupId = groupIdOrRespondEmpty(req, res, emptyBody);
    if (!groupId) return;

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
      logger.error(`❌ Error fetching group runs (${errorCode(runsError)})`);
      fail(res, 500, 'Failed to fetch group run history'); return;
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
      moving_time: run.moving_time ?? null,
    })) || [];

    okWithLegacy<GroupRunHistoryResponse>(res, { runs }, { runs }, buildPageMeta(total, limit, offset));
  } catch (error) {
    logger.error(`❌ Error in group history endpoint (${errorCode(error)})`);
    fail(res, 500, 'Internal server error');
  }
});

const isDateOnly = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

/** Rundans kalenderdag i gruppens tidszon: en ren YYYY-MM-DD är dagen i sig, en ISO-tidpunkt omräknas. */
function toRunDay(date: string, timeZone: string): string {
  return isDateOnly(date) ? date : zoneDay(new Date(date), timeZone);
}

/**
 * Gemensam indatavalidering för POST och PUT (bugg #8: PUT saknade POST:ens
 * regler). Returnerar felmeddelande eller null + parsad distans.
 *
 * Datum jämförs som KALENDERDAGAR i gruppens tidszon (open-assumptions backend-fråga 0): "idag" är
 * zoneDay(new Date(), timeZone), inte serverns UTC-dag — annars nekades dagens datum som framtid mellan 00:00 och
 * ~02:00 svensk tid. En ren YYYY-MM-DD-sträng är dagen i sig; en tidpunkt (ISO med klockslag) omräknas
 * till sin dag i gruppens zon.
 */
function validateRunInput(date: string | undefined, distance: unknown, timeZone: string): { error: string | null; distanceNum: number } {
  const distanceNum = parseFloat(String(distance));
  if (isNaN(distanceNum) || distanceNum < MANUAL_RUN_MIN_DISTANCE_KM) {
    return { error: `Distance must be at least ${MANUAL_RUN_MIN_DISTANCE_KM.toFixed(1)} km`, distanceNum };
  }
  if (date !== undefined) {
    const runDate = new Date(date);
    if (isNaN(runDate.getTime())) return { error: 'Invalid date', distanceNum };
    // new Date('2026-02-30') rullar över till 2 mars — en ren dag måste vara en riktig kalenderdag.
    if (isDateOnly(date) && !isCalendarDay(date)) return { error: 'Invalid date', distanceNum };
    const runDay = toRunDay(date, timeZone);
    if (runDay < MIN_RUN_DATE) return { error: `Cannot log runs before ${MIN_RUN_DATE_LABEL}`, distanceNum };
    if (runDay > zoneDay(new Date(), timeZone)) return { error: 'Cannot log runs for future dates', distanceNum };
  }
  return { error: null, distanceNum };
}

/** Kolumnerna i POST-svarets `run` — samma lista för den nyskapade och för den återspelade (idempotent) rundan. */
const CREATED_RUN_COLUMNS = 'id, user_id, date, distance, xp_gained, multiplier, streak_day, base_xp, km_xp, distance_bonus, streak_bonus, source, external_id, is_treadmill';

/** Det partiella unika indexet (user_id, client_request_id) från migration 043. */
export const CLIENT_REQUEST_ID_INDEX = 'runs_user_client_request_id_key';

/**
 * Sant om insert-felet är en krock på just idempotensindexet (Postgres 23505). En 23505 på något annat index —
 * t.ex. (user_id, external_id) för Strava — är INTE ett återspelat anrop och ska fortsatt vara ett fel.
 */
function isClientRequestIdConflict(error: { code?: string; message?: string; details?: string | null } | null): boolean {
  return error?.code === '23505' && `${error.message ?? ''} ${error.details ?? ''}`.includes(CLIENT_REQUEST_ID_INDEX);
}

// POST /api/runs - Create a new run
// Idempotency-Key (uuid v4, valfri): samma nyckel igen skapar ingen ny runda — svaret är det första lyckade svaret
// (samma form och status) och ingen ny omräkning körs. Utan header är beteendet oförändrat.
router.post('/', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const { date, distance, is_treadmill }: Partial<CreateRunRequest> = req.body;
    const userId = req.user!.user_id;

    logger.info('📝 Create run request:', { userId, date, distance, is_treadmill });

    const keyParse = parseIdempotencyKey(req.headers[IDEMPOTENCY_KEY_HEADER.toLowerCase()]);
    if (!keyParse.ok) {
      fail(res, 400, keyParse.error); return;
    }
    const idempotencyKey = keyParse.key;

    if (!date || !distance) {
      fail(res, 400, 'Date and distance are required'); return;
    }

    // Rundor loggas även utan grupp i token (token kan vara inaktuell efter join): gruppen ger bara zonen och eventkvalificeringen,
    // som läser den färskt när den saknas. Den filtrerar ingen läsning.
    const groupId = tokenGroupId(req);
    const timeZone = groupTimeZone(groupId);
    const { error: invalidInput, distanceNum } = validateRunInput(date, distance, timeZone);
    if (invalidInput) {
      fail(res, 400, invalidInput); return;
    }

    // Utelämnat → NULL (dagens beteende för manuella rundor); event-/väderlogik skiljer på false och NULL.
    if (is_treadmill !== undefined && typeof is_treadmill !== 'boolean') {
      fail(res, 400, 'is_treadmill must be a boolean'); return;
    }

    logger.info(`✅ Creating run for user ${userId}: ${distanceNum}km on ${date}`);

    const supabase = getSupabaseClient();

    // Svarar med en redan skapad runda (upprepning med samma nyckel). Gör ingen skrivning och ingen omräkning:
    // rundan är redan räknad — eller, om omräkningen föll (written: true), självläker den som idag (nästa omräkning
    // från rundans datum, t.ex. en annan runda eller admin reprocess) — ingen ny mekanism.
    const findRunByKey = (key: string) => supabase
      .from('runs')
      .select(CREATED_RUN_COLUMNS)
      .eq('user_id', userId)
      .eq('client_request_id', key)
      .maybeSingle();
    const replayExisting = (existing: CreateRunResponse['run'], how: string): void => {
      logger.info(`♻️ Idempotent replay (${how}) — returning existing run, no new write`, { userId });
      okWithLegacy<CreateRunResponse>(res, { run: existing }, { message: 'Run created successfully', run: existing });
    };

    if (idempotencyKey) {
      const { data: existing, error: lookupError } = await findRunByKey(idempotencyKey);
      if (lookupError) {
        logger.error(`❌ Error looking up run by idempotency key for user ${userId} (${errorCode(lookupError)})`);
        fail(res, 500, 'Failed to create run'); return;
      }
      if (existing) { replayExisting(existing, 'sequential'); return; }
    }

    // Insert with placeholder XP — reprocessRunsFromDate recalculates correctly right after
    const { data: newRun, error: insertError } = await supabase
      .from('runs')
      .insert({
        user_id: userId,
        ...(idempotencyKey && { client_request_id: idempotencyKey }),
        date: date,
        distance: distanceNum,
        // Servern äger source: klientens body.source ignoreras. Bara Strava-importen (routes/strava.ts) skriver 'strava'
        // — annars kringgår en manuell runda Strava-gatade badges (Precisionist) och Strava-dedupen (RUN-136).
        source: 'manual',
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
      if (idempotencyKey && isClientRequestIdConflict(insertError)) {
        // Race: ett samtidigt anrop med samma nyckel hann före. Läs dess rad och svara med den.
        const { data: winner, error: winnerError } = await findRunByKey(idempotencyKey);
        if (winner) { replayExisting(winner, 'concurrent'); return; }
        logger.error(`❌ Idempotency conflict but the existing run could not be read for user ${userId} (${winnerError ? errorCode(winnerError) : 'no row'})`);
      } else {
        logger.error(`❌ Error inserting run for user ${userId} (${errorCode(insertError)})`);
      }
      fail(res, 500, 'Failed to create run'); return;
    }

    logger.info(`✅ Run created, reprocessing from ${date}...`);

    // Only reprocess from this run's date — earlier runs are unaffected
    const reprocessed = await tryReprocessRunsFromDate(userId, date);

    // Recalculate user totals (scoped to user's group for title processing) — även om omräkningen felade (best-effort)
    await calculateUserTotals(userId);

    // Check if this run qualifies for any active events (fire-and-forget, non-blocking)
    checkEventQualification({
      userId,
      runId: newRun.id,
      runDate: toRunDay(date, timeZone), // checkEventQualification bygger tidsfilter av YYYY-MM-DD — en ISO-tidpunkt ger tyst PostgREST-fel
      distanceKm: distanceNum,
      groupId,
    }).catch(e => logger.error(`❌ checkEventQualification error for user ${userId} (${errorCode(e)})`));

    if (!reprocessed) {
      failWritten(res, 'Run was created but XP recalculation failed'); return;
    }

    // Fetch the fully processed run
    const { data: processedRun, error: fetchError } = await supabase
      .from('runs')
      .select(CREATED_RUN_COLUMNS)
      .eq('id', newRun.id)
      .single();

    if (fetchError) {
      logger.warn(`⚠️ Could not fetch processed run for user ${userId} (${errorCode(fetchError)})`);
    }

    logger.info(`✅ Run created successfully with ${processedRun?.xp_gained || 0} XP`)

    const created = processedRun || newRun;
    okWithLegacy<CreateRunResponse>(res, { run: created }, { message: 'Run created successfully', run: created });

  } catch (error) {
    logger.error(`❌ Error creating run for user ${req.user?.user_id} (${errorCode(error)})`);
    fail(res, 500, 'Internal server error'); return;
  }
});

// PUT /api/runs/:id - Update a run
router.put('/:id', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const { id } = req.params;
    const { distance, date }: Partial<UpdateRunRequest> = req.body;
    const userId = req.user!.user_id;

    logger.info('📝 Update request:', { id, distance, date, userId });

    if (!distance) {
      fail(res, 400, 'Distance is required'); return;
    }

    const groupId = tokenGroupId(req); // se POST: zonen och eventkvalificeringen, aldrig ett filter
    const timeZone = groupTimeZone(groupId);
    const { error: invalidInput, distanceNum: newDistance } = validateRunInput(date, distance, timeZone);
    if (invalidInput) {
      fail(res, 400, invalidInput); return;
    }

    logger.info(`🔄 Updating run ${id} for user ${userId}`);

    const supabase = getSupabaseClient();

    // Verify run belongs to user and get old date
    const { data: existingRun, error: fetchError } = await supabase
      .from('runs')
      .select('user_id, date, distance, streak_day, source')
      .eq('id', id)
      .single();

    if (fetchError || !existingRun) {
      fail(res, 404, 'Run not found'); return;
    }

    if (existingRun.user_id !== userId) {
      fail(res, 403, 'Not authorized to update this run'); return;
    }

    // Strava är sanningskällan för distans och datum (ägarbeslut 2026-10-11, RUN-139). PUT redigerar bara just de två
    // fälten, så en Strava-runda har inget redigerbart kvar. 409 (tillståndskonflikt, samma mönster som DELETE nedan för
    // event-kvalificerande rundor) — inte 403, som här betyder "inte din runda". Kontrollen ligger EFTER ägarskapet
    // (404/403 oförändrade) och FÖRE all skrivning och omräkning.
    if (existingRun.source === 'strava') {
      fail(res, 409, 'Strava runs are read-only', 'strava_read_only'); return;
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
      logger.error(`❌ Error updating run for user ${userId} (${errorCode(updateError)})`);
      fail(res, 500, 'Failed to update run'); return;
    }

    let reprocessed = true;
    if (dateChanged) {
      // Date changed — reprocess from the earlier of old and new date
      const fromDate = existingRun.date < date ? existingRun.date : date;
      logger.info(`🔄 Date changed (${existingRun.date} → ${date}), reprocessing from ${fromDate}`);
      reprocessed = await tryReprocessRunsFromDate(userId, fromDate);
    } else if (distanceChanged) {
      // Only distance changed — reprocess just this run's date (streak order unchanged)
      logger.info(`⚡ Distance changed, reprocessing from ${existingRun.date}`);
      reprocessed = await tryReprocessRunsFromDate(userId, existingRun.date);
    }

    // Recalculate user totals (scoped to user's group for title processing) — även om omräkningen felade (best-effort)
    await calculateUserTotals(userId);

    // En redigering kan nå eventgränsen (t.ex. distansen höjs över min_km, eller datumet flyttas in i ett
    // eventfönster) — samma fire-and-forget-mönster som POST (open-assumptions backend-fråga 7).
    // checkEventQualification är idempotent (UNIQUE(event_id, user_id)): redan kvalificerade events ger
    // 23505 och ingen ny XP. Den kan bara KVALIFICERA — en redigering som sänker distansen under gränsen
    // avkvalificerar inte (eventService saknar avkvalificering).
    if (dateChanged || distanceChanged) {
      checkEventQualification({
        userId,
        runId: id,
        runDate: toRunDay(date || existingRun.date, timeZone),
        distanceKm: newDistance,
        groupId,
        // Bara events vars dagar rundans (nya) datum faller inom — annars kvalificerar en redigering av
        // en gammal runda ett event som pågår just nu.
        enforceRunDateWindow: true,
      }).catch(e => logger.error(`❌ checkEventQualification error (PUT) for user ${userId} (${errorCode(e)})`));
    }

    if (!reprocessed) {
      failWritten(res, 'Run was updated but XP recalculation failed'); return;
    }

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
      logger.warn(`⚠️ Could not fetch updated run for user ${userId} (${errorCode(fetchUpdatedError)})`);
    }

    logger.info(`✅ Run ${id} updated and all runs reprocessed successfully`);

    okWithLegacy<UpdateRunResponse>(res, { run: updatedRun }, { message: 'Run updated successfully', run: updatedRun });

  } catch (error) {
    logger.error(`❌ Error updating run for user ${req.user?.user_id} (${errorCode(error)})`);
    fail(res, 500, 'Internal server error'); return;
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
      .select('user_id, date, source')
      .eq('id', id)
      .single();

    if (fetchError || !existingRun) {
      fail(res, 404, 'Run not found'); return;
    }

    if (existingRun.user_id !== userId) {
      fail(res, 403, 'Not authorized to delete this run'); return;
    }

    // Strava-rundor är skrivskyddade (RUN-139): spärren som förut bara satt i UI:t sitter nu även i API:t — annars raderas
    // rundan vid ett direkt anrop och synken importerar tillbaka den (ingen gravsten). Kontrollen ligger efter ägarskapet
    // (404/403 oförändrade), före all skrivning/omräkning och FÖRE event-409:an nedan: den är permanent och billig (ingen
    // query), och event-meddelandet ("edit it instead") vore fel för en Strava-runda, som inte går att redigera.
    if (existingRun.source === 'strava') {
      fail(res, 409, 'Strava runs are read-only', 'strava_read_only'); return;
    }

    const deletedDate = existingRun.date;

    // En manuell runda som kvalificerat ett event får inte raderas: 409 med klartext. Detta är en regel i koden och
    // ENDA skyddet: sedan migration 047 är event_entries.run_id → runs(id) ON DELETE SET NULL (ADR 010 D2, så att Strava-
    // raderingar via webhooks inte kraschar), så FK:n stoppar ingenting längre. Skillnaden: webhook-vägen raderar en
    // Strava-runda och behåller entry + XP med run_id NULL; den här vägen får aldrig radera efter utdelad XP
    // (XP-farmning: radera efter utdelad XP), så den spärras här, före raderingen.
    const { data: qualifiedEntries, error: entriesError } = await supabase
      .from('event_entries')
      .select('id')
      .eq('run_id', id)
      .limit(1);
    if (entriesError) {
      logger.error(`❌ Error checking event entries for a run of user ${userId} (${errorCode(entriesError)})`);
      fail(res, 500, 'Failed to delete run'); return;
    }
    if (qualifiedEntries && qualifiedEntries.length > 0) {
      fail(res, 409, "This run qualified an event and can't be deleted — edit it instead", 'run_qualified_event'); return;
    }

    // Delete the run
    const { error: deleteError } = await supabase
      .from('runs')
      .delete()
      .eq('id', id);

    if (deleteError) {
      logger.error(`❌ Error deleting run for user ${userId} (${errorCode(deleteError)})`);
      fail(res, 500, 'Failed to delete run'); return;
    }

    logger.info(`✅ Run deleted, reprocessing from ${deletedDate}...`);

    // Reprocess only runs from the deleted run's date onwards
    const reprocessed = await tryReprocessRunsFromDate(userId, deletedDate);

    // Recalculate user totals (scoped to user's group for title processing) — även om omräkningen felade (best-effort)
    await calculateUserTotals(userId);

    if (!reprocessed) {
      failWritten(res, 'Run was deleted but XP recalculation failed'); return;
    }

    // Event-kvalificering vid radering (open-assumptions backend-fråga 7): checkEventQualification kan bara
    // SKAPA kvalificeringar ur en runda, och en radering skapar aldrig en ny — därför anropas den inte här.
    // Avkvalificering (ta bort entry + dra tillbaka utdelad participation-XP) stöds inte av eventService och
    // vore en regeländring (ägarbeslut 1). En kvalificerande runda kan inte raderas alls (409 ovan).

    logger.info(`✅ Run ${id} deleted and all runs reprocessed successfully`);

    okWithLegacy<DeleteRunResponse>(res, null, { message: 'Run deleted successfully' });

  } catch (error) {
    logger.error(`❌ Error deleting run for user ${req.user?.user_id} (${errorCode(error)})`);
    fail(res, 500, 'Internal server error'); return;
  }
});

export default router;
