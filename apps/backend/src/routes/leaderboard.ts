// 📊 Leaderboard Routes (ADR 007 B1–B2, B11) — härledningar ur runs/event_entries, inga nya tabeller.
import express from 'express';
import { getSupabaseClient } from '../config/database.js';
import { authenticateJWT } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
import { weekRange } from '../utils/dateUtils.js';
import { groupTimeZone } from '../utils/groupTimeZone.js';
import {
  POSITION_WEEKS_DEFAULT,
  POSITION_WEEKS_MAX,
  addDays,
  bestWeekKm,
  buildPositionHistory,
  buildRankDelta,
  buildWeekLeaderboard,
  buildXpLedger,
  isCalendarDay,
  mondayOf,
  percentOfBest,
  zoneDay,
  zoneMidnightIso,
  type LedgerEventEntry,
  type PositionHistoryApiResponse,
  type PositionHistoryUser,
  type RankDeltaApiResponse,
  type WeekLeaderboardApiResponse,
} from '@runquest/shared';
import { errorCode } from '../utils/errorCode.js';
import { fail, ok } from '../utils/respond.js';
import { groupIdOrRespondEmpty, tokenGroupId } from '../utils/groupScope.js';

const router = express.Router();

const PAGE_SIZE = 1000; // PostgREST kapar svar vid 1000 rader — historiken läses sidvis
const RANGE_NOT_SATISFIABLE = 'PGRST103'; // PostgREST (416): sidan börjar bortom sista raden

type PageResult<T> = { data: T[] | null; error: { code?: string } | null };

/**
 * Läser en hel fråga sidvis (PostgREST kapar vid 1000 rader). `readPage(from, to)` bygger frågan för ett radintervall och MÅSTE ha en unik ordning
 * (till exempel `date, id`), annars kan en rad hamna på två sidor eller på ingen. Läser tills en sida är kortare än PAGE_SIZE. Ett antal rader
 * som är en jämn multipel av PAGE_SIZE ger en sista sida som börjar precis efter sista raden; PostgREST svarar då 416 och det är slutet, inte ett fel.
 */
async function readAllPages<T>(readPage: (from: number, to: number) => PromiseLike<PageResult<T>>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await readPage(from, from + PAGE_SIZE - 1);
    if (error) {
      if (from > 0 && error.code === RANGE_NOT_SATISFIABLE) break;
      throw error;
    }
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

// ── Bästa vecka någonsin: cachebar härledning ur hela gruppens runs-historik ─────
const BEST_WEEK_TTL_MS = 5 * 60_000;
const bestWeekCache = new Map<string, { km: number; expiresAt: number }>();

/** För tester: nollställ cachen mellan fall. */
export function clearBestWeekCache(): void {
  bestWeekCache.clear();
}

async function fetchGroupBestWeekKm(groupId: string): Promise<number> {
  const hit = bestWeekCache.get(groupId);
  if (hit && hit.expiresAt > Date.now()) return hit.km;

  const supabase = getSupabaseClient();
  const rows = await readAllPages<{ date: string; distance: number | string }>((from, to) => supabase
    .from('runs')
    .select('date, distance, users!inner(group_id)')
    .eq('users.group_id', groupId)
    .order('date', { ascending: true })
    .order('id', { ascending: true }) // unik tie-breaker → stabil sidning
    .range(from, to));

  const km = bestWeekKm(rows);
  bestWeekCache.set(groupId, { km, expiresAt: Date.now() + BEST_WEEK_TTL_MS });
  return km;
}

// GET /api/leaderboard/week[?week_start=YYYY-MM-DD]
router.get('/week', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const timeZone = groupTimeZone(tokenGroupId(req));
    const today = zoneDay(new Date(), timeZone);
    const currentStart = mondayOf(today);

    let weekStart = currentStart;
    const requested = req.query.week_start;
    if (requested !== undefined) {
      if (typeof requested !== 'string' || !isCalendarDay(requested)) {
        fail(res, 400, 'week_start must be a date in the format YYYY-MM-DD'); return;
      }
      if (mondayOf(requested) !== requested) {
        fail(res, 400, 'week_start must be a Monday'); return;
      }
      if (requested > currentStart) {
        fail(res, 400, 'week_start must not be in the future'); return;
      }
      weekStart = requested;
    }

    const { end, previous_start } = weekRange(weekStart);
    const week = { start: weekStart, end, previous_start, is_current: weekStart === currentStart, today };

    const emptyBody = {
      success: true,
      data: {
        week,
        users: [],
        totals: { km: 0, runs: 0, xp: 0, active_runners: 0, members: 0, best_week_km: 0, pct_of_best_week: null },
        mover: null,
      },
    } satisfies WeekLeaderboardApiResponse;
    const groupId = groupIdOrRespondEmpty(req, res, emptyBody);
    if (!groupId) return;

    const supabase = getSupabaseClient();
    const [membersResult, runsResult] = await Promise.all([
      supabase
        .from('users')
        .select('id, name, profile_picture, current_level, created_at')
        .eq('group_id', groupId),
      // En enda runs-query för båda veckorna — ingen N+1
      supabase
        .from('runs')
        .select('user_id, date, distance, xp_gained, users!inner(group_id)')
        .eq('users.group_id', groupId)
        .gte('date', previous_start)
        .lte('date', end),
    ]);
    if (membersResult.error) throw membersResult.error;
    if (runsResult.error) throw runsResult.error;

    const members = (membersResult.data ?? []).map((u: any) => ({
      id: u.id,
      name: u.name,
      profile_picture: u.profile_picture ?? null,
      level: u.current_level ?? 1,
      created_date: u.created_at ? zoneDay(new Date(u.created_at), timeZone) : null,
    }));

    const computed = buildWeekLeaderboard(members, runsResult.data ?? [], weekStart);

    // Aktuell/vald vecka räknas med i "bästa vecka" så att procenten aldrig överstiger 100.
    // Dekorativ siffra: ett fel i historikläsningen får inte ge 500 för hela vyn → fallback till veckans egna km.
    let historicalBest = 0;
    try {
      historicalBest = await fetchGroupBestWeekKm(groupId);
    } catch (historyError) {
      logger.warn(`⚠️ Could not read runs history for best week, falling back to this week (${errorCode(historyError)})`);
    }
    const bestKm = Math.max(historicalBest, computed.totals.km);

    ok<WeekLeaderboardApiResponse>(res, {
      week,
      users: computed.users,
      totals: { ...computed.totals, best_week_km: bestKm, pct_of_best_week: percentOfBest(computed.totals.km, bestKm) },
      mover: computed.mover,
    });
  } catch (error) {
    logger.error(`❌ Error fetching week leaderboard (${errorCode(error)})`);
    fail(res, 500, 'Failed to fetch week leaderboard');
  }
});

// GET /api/leaderboard/rank-delta
router.get('/rank-delta', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const timeZone = groupTimeZone(tokenGroupId(req));
    const asOf = mondayOf(zoneDay(new Date(), timeZone));
    const emptyBody = { success: true, data: { as_of: asOf, users: [] } } satisfies RankDeltaApiResponse;
    const groupId = groupIdOrRespondEmpty(req, res, emptyBody);
    if (!groupId) return;

    const supabase = getSupabaseClient();
    const [usersResult, runsResult, entriesResult] = await Promise.all([
      supabase
        .from('users')
        .select('id, name, total_xp, created_at')
        .eq('group_id', groupId),
      supabase
        .from('runs')
        .select('id, user_id, date, xp_gained, users!inner(group_id)')
        .eq('users.group_id', groupId)
        .gte('date', asOf),
      // Event-XP saknar eget datum per rad: tidpunkten avgörs i buildXpLedger (qualified_at / settled_at ?? ends_at).
      // ends_at-gränsen (14 dagar före veckostart) håller svaret under PostgREST:s 1000-radersgräns; en
      // competition som avräknats efter veckostart har ends_at strax före, aldrig 14 dagar före.
      supabase
        .from('event_entries')
        .select('id, user_id, event_id, xp_awarded, qualified_at, events!inner(type, ends_at, settled_at, group_id)')
        .eq('events.group_id', groupId)
        .gte('events.ends_at', zoneMidnightIso(addDays(asOf, -14), timeZone))
        .gt('xp_awarded', 0),
    ]);
    if (usersResult.error) throw usersResult.error;
    if (runsResult.error) throw runsResult.error;
    if (entriesResult.error) throw entriesResult.error;

    const eventEntries: LedgerEventEntry[] = (entriesResult.data ?? []).map((e: any) => ({
      entry_id: e.id,
      user_id: e.user_id,
      event_id: e.event_id,
      event_type: e.events.type,
      xp_awarded: e.xp_awarded,
      qualified_at: e.qualified_at,
      settled_at: e.events.settled_at,
      ends_at: e.events.ends_at,
    }));

    const ledger = buildXpLedger(runsResult.data ?? [], eventEntries, timeZone);
    const members = (usersResult.data ?? []).map((u: any) => ({
      id: u.id,
      name: u.name,
      total_xp: u.total_xp ?? 0,
      created_date: u.created_at ? zoneDay(new Date(u.created_at), timeZone) : null,
    }));

    const { users, diverged } = buildRankDelta(members, ledger, asOf);
    if (diverged.length > 0) {
      logger.warn(`⚠️ rank-delta: XP-liggaren överstiger total_xp för ${diverged.length} användare (${diverged.join(', ')}) — previous_xp klampad till 0`);
    }

    ok<RankDeltaApiResponse>(res, { as_of: asOf, users });
  } catch (error) {
    logger.error(`❌ Error fetching rank delta (${errorCode(error)})`);
    fail(res, 500, 'Failed to fetch rank delta');
  }
});

/** `weeks` ur querysträngen: heltal 1–POSITION_WEEKS_MAX, standard POSITION_WEEKS_DEFAULT. Annat (icke-heltal, upprepad parameter, lista, objekt) ger null. */
function parsePositionWeeks(raw: unknown): number | null {
  if (raw === undefined) return POSITION_WEEKS_DEFAULT;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
  const weeks = Number(raw);
  return weeks >= 1 && weeks <= POSITION_WEEKS_MAX ? weeks : null;
}

// GET /api/leaderboard/positions[?weeks=N] (ADR 007 B11): placering i total-XP-ordningen vid slutet av varje vecka, härledd bakåt ur total_xp
router.get('/positions', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const weeks = parsePositionWeeks(req.query.weeks);
    if (weeks === null) {
      fail(res, 400, `weeks must be an integer between 1 and ${POSITION_WEEKS_MAX}`); return;
    }

    const timeZone = groupTimeZone(tokenGroupId(req));
    const now = new Date();
    const today = zoneDay(now, timeZone);
    const emptyBody = { success: true, data: { as_of: today, weeks: [], runners: [] } } satisfies PositionHistoryApiResponse;
    const groupId = groupIdOrRespondEmpty(req, res, emptyBody);
    if (!groupId) return;

    // Äldsta avslutade veckans slutgräns (b_0). Med weeks=1 finns ingen avslutad vecka: liggaren behövs inte och rundor och event läses inte.
    const firstBoundary = addDays(mondayOf(today), -7 * (weeks - 2));
    const supabase = getSupabaseClient();
    const [usersResult, runRows, entryRows] = await Promise.all([
      supabase
        .from('users')
        .select('id, name, profile_picture, total_xp, created_at')
        .eq('group_id', groupId),
      weeks === 1 ? [] : readAllPages<any>((from, to) => supabase
        .from('runs')
        .select('id, user_id, date, xp_gained, users!inner(group_id)')
        .eq('users.group_id', groupId)
        .gte('date', firstBoundary)
        .order('date', { ascending: true })
        .order('id', { ascending: true }) // unik tie-breaker → stabil sidning
        .range(from, to)),
      // Samma event-fönster som rank-delta: 14 dagars svans före b_0 håller läsningen liten; en avräkning som står stilla längre faller utanför (ADR 007 B11).
      weeks === 1 ? [] : readAllPages<any>((from, to) => supabase
        .from('event_entries')
        .select('id, user_id, event_id, xp_awarded, qualified_at, events!inner(type, ends_at, settled_at, group_id)')
        .eq('events.group_id', groupId)
        .gte('events.ends_at', zoneMidnightIso(addDays(firstBoundary, -14), timeZone))
        .gt('xp_awarded', 0)
        .order('id', { ascending: true })
        .range(from, to)),
    ]);
    if (usersResult.error) throw usersResult.error;

    const eventEntries: LedgerEventEntry[] = entryRows.map((e: any) => ({
      entry_id: e.id,
      user_id: e.user_id,
      event_id: e.event_id,
      event_type: e.events.type,
      xp_awarded: e.xp_awarded,
      qualified_at: e.qualified_at,
      settled_at: e.events.settled_at,
      ends_at: e.events.ends_at,
    }));
    const ledger = buildXpLedger(runRows, eventEntries, timeZone);
    const members: PositionHistoryUser[] = (usersResult.data ?? []).map((u: any) => ({
      id: u.id,
      name: u.name,
      profile_picture: u.profile_picture ?? null,
      total_xp: u.total_xp ?? 0,
      created_at: u.created_at ?? null,
    }));

    const { response, diverged } = buildPositionHistory(members, ledger, now, weeks, timeZone);
    if (diverged.length > 0) {
      logger.warn(`⚠️ positions: XP-liggaren överstiger total_xp för ${diverged.length} användare (${diverged.join(', ')}) — previous_xp klampad till 0`);
    }

    ok<PositionHistoryApiResponse>(res, response);
  } catch (error) {
    logger.error(`❌ Error fetching position history (${errorCode(error)})`);
    fail(res, 500, 'Failed to fetch position history');
  }
});

export default router;
