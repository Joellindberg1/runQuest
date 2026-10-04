// 📊 Leaderboard Routes (ADR 007 B1–B2) — härledningar ur runs/event_entries, inga nya tabeller.
import express from 'express';
import { getSupabaseClient } from '../config/database.js';
import { authenticateJWT } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
import { addDaysToDate, isIsoCalendarDate, mondayOf, todayStockholm, toStockholmDate, weekRange } from '../utils/dateUtils.js';
import {
  bestWeekKm,
  buildRankDelta,
  buildWeekLeaderboard,
  buildXpLedger,
  percentOfBest,
  type LedgerEventEntry,
  type RankDeltaApiResponse,
  type WeekLeaderboardApiResponse,
} from '@runquest/shared';

const router = express.Router();

const PAGE_SIZE = 1000; // PostgREST kapar svar vid 1000 rader — historiken läses sidvis

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
  const rows: Array<{ date: string; distance: number | string }> = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('runs')
      .select('date, distance, users!inner(group_id)')
      .eq('users.group_id', groupId)
      .order('date', { ascending: true })
      .order('id', { ascending: true }) // unik tie-breaker → stabil sidning
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }

  const km = bestWeekKm(rows);
  bestWeekCache.set(groupId, { km, expiresAt: Date.now() + BEST_WEEK_TTL_MS });
  return km;
}

// GET /api/leaderboard/week[?week_start=YYYY-MM-DD]
router.get('/week', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const today = todayStockholm();
    const currentStart = mondayOf(today);

    let weekStart = currentStart;
    const requested = req.query.week_start;
    if (requested !== undefined) {
      if (typeof requested !== 'string' || !isIsoCalendarDate(requested)) {
        res.status(400).json({ error: 'week_start must be a date in the format YYYY-MM-DD' }); return;
      }
      if (mondayOf(requested) !== requested) {
        res.status(400).json({ error: 'week_start must be a Monday' }); return;
      }
      if (requested > currentStart) {
        res.status(400).json({ error: 'week_start must not be in the future' }); return;
      }
      weekStart = requested;
    }

    const { end, previous_start } = weekRange(weekStart);
    const week = { start: weekStart, end, previous_start, is_current: weekStart === currentStart, today };

    const groupId = req.user!.group_id;
    if (!groupId) {
      const empty: WeekLeaderboardApiResponse = {
        success: true,
        data: {
          week,
          users: [],
          totals: { km: 0, runs: 0, xp: 0, active_runners: 0, members: 0, best_week_km: 0, pct_of_best_week: null },
          mover: null,
        },
      };
      res.json(empty); return;
    }

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
      created_date: u.created_at ? toStockholmDate(u.created_at) : null,
    }));

    const computed = buildWeekLeaderboard(members, runsResult.data ?? [], weekStart);

    // Aktuell/vald vecka räknas med i "bästa vecka" så att procenten aldrig överstiger 100.
    const historicalBest = await fetchGroupBestWeekKm(groupId);
    const bestKm = Math.max(historicalBest, computed.totals.km);

    const body: WeekLeaderboardApiResponse = {
      success: true,
      data: {
        week,
        users: computed.users,
        totals: { ...computed.totals, best_week_km: bestKm, pct_of_best_week: percentOfBest(computed.totals.km, bestKm) },
        mover: computed.mover,
      },
    };
    res.json(body);
  } catch (error) {
    logger.error('❌ Error fetching week leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch week leaderboard' });
  }
});

// GET /api/leaderboard/rank-delta
router.get('/rank-delta', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const asOf = mondayOf(todayStockholm());
    const groupId = req.user!.group_id;
    if (!groupId) {
      const empty: RankDeltaApiResponse = { success: true, data: { as_of: asOf, users: [] } };
      res.json(empty); return;
    }

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
        .gte('events.ends_at', `${addDaysToDate(asOf, -14)}T00:00:00Z`)
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

    const ledger = buildXpLedger(runsResult.data ?? [], eventEntries);
    const members = (usersResult.data ?? []).map((u: any) => ({
      id: u.id,
      name: u.name,
      total_xp: u.total_xp ?? 0,
      created_date: u.created_at ? toStockholmDate(u.created_at) : null,
    }));

    const { users, diverged } = buildRankDelta(members, ledger, asOf);
    if (diverged.length > 0) {
      logger.warn(`⚠️ rank-delta: XP-liggaren överstiger total_xp för ${diverged.length} användare (${diverged.join(', ')}) — previous_xp klampad till 0`);
    }

    const body: RankDeltaApiResponse = { success: true, data: { as_of: asOf, users } };
    res.json(body);
  } catch (error) {
    logger.error('❌ Error fetching rank delta:', error);
    res.status(500).json({ error: 'Failed to fetch rank delta' });
  }
});

export default router;
