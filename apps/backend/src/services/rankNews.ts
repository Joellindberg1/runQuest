// 📰 rank_passed för måttet xp (ADR 011 beslut 6): "W gick förbi M på All-time-tabellen".
//
// Samma roll som recordLevelUps/evaluateBadges: en OBSERVATÖR som körs efter att XP skrivits (calculateUserTotals och de två
// event-XP-skrivningarna i eventService). Den kastar aldrig, rör aldrig totalerna (ADR 005/008) och skriver bara via activityLog.
//
// Dygnsskiftets ställning härleds ur samma liggare som GET /leaderboard/rank-delta: buildXpLedger + buildRankDelta med
// asOf = idag i Stockholm (previous_xp = total_xp minus XP krediterad med datum ≥ idag). Ingen ny lagring, ingen ögonblickstabell.
//
// KÄND BEGRÄNSNING: liggaren är datumbaserad. En runda daterad IGÅR men synkad efter midnatt räknas som krediterad före
// dygnsskiftet, så W "låg redan före M" och ingen rad skrivs. Det ger en utebliven notis, aldrig en falsk.
//
// Inget lås här: anroparna kan hålla withUserLock för W (ett eget lås ger ReentrantLockError), och övriga medlemmar läses utan lås.
import {
  addDays,
  buildRankDelta,
  buildRankPassedDraft,
  buildXpLedger,
  detectRankPasses,
  stockholmDay,
  type LedgerEventEntry,
  type RankDeltaInput,
} from '@runquest/shared';
import { getSupabaseClient } from '../config/database.js';
import { toStockholmDate } from '../utils/dateUtils.js';
import { errorCode } from '../utils/errorCode.js';
import { logger } from '../utils/logger.js';
import { recordActivities, retractActivity } from './activityLog.js';

/**
 * Samma fönster som rank-delta för event_entries: en competition som avräknats idag har ends_at strax före, aldrig 14 dagar före,
 * och en participation kvalificerad idag har ends_at senare än idag. Håller svaret under PostgREST:s 1000-radersgräns.
 */
const EVENT_ENTRY_WINDOW_DAYS = 14;

export interface RecordRankPassesOptions {
  /**
   * 'full' (default): skriv nya rank_passed-rader vid en ökning och retracta dagens rader vid en minskning.
   * 'retract_only': massvägarna (emitRankNews false). Skriver ALDRIG nya rader, men retractar dagens rader vid en minskning,
   * eftersom en bortkoppling som sänker W:s XP annars lämnar en falsk nyhet kvar (ADR 011 beslut 6.4 och 13.4).
   */
  mode?: 'full' | 'retract_only';
}

/** Kastar aldrig: ett läsfel loggas med kod och ger inga rader (hellre utebliven notis än en falsk på halv data). */
export async function recordRankPassesForXp(
  userId: string,
  groupId: string | null | undefined,
  prevXp: number | null | undefined,
  options: RecordRankPassesOptions = {},
): Promise<void> {
  try {
    if (!groupId || typeof prevXp !== 'number' || !Number.isFinite(prevXp)) return;

    // ETT ögonblick för både dagen och occurred_at: buildRankPassedDraft bygger nyckeln ur occurredAt, så två läsningar av klockan
    // kunde ge olika dagar i nyckeln och i detektionen vid Stockholms midnatt.
    const now = new Date();
    const occurredAt = now.toISOString();
    const today = stockholmDay(now);

    const supabase = getSupabaseClient();
    const membersResult = await supabase.from('users').select('id, name, total_xp, created_at').eq('group_id', groupId);
    if (membersResult.error) {
      logger.error(`❌ [RankNews] could not read members of group ${groupId} (${errorCode(membersResult.error)})`);
      return;
    }
    const memberRows = (membersResult.data ?? []) as Array<{ id: string; name: string; total_xp: number | null; created_at: string | null }>;
    if (memberRows.length < 2) return;

    const members: RankDeltaInput[] = memberRows.map((u) => ({
      id: u.id,
      name: u.name,
      total_xp: Number(u.total_xp ?? 0),
      created_date: u.created_at ? toStockholmDate(u.created_at) : null,
    }));
    const passer = members.find((m) => m.id === userId);
    if (!passer || passer.total_xp === prevXp) return;

    const [runsResult, entriesResult] = await Promise.all([
      supabase
        .from('runs')
        .select('id, user_id, date, xp_gained')
        .in('user_id', members.map((m) => m.id))
        .gte('date', today),
      // Event-XP saknar eget datum per rad: tidpunkten avgörs i buildXpLedger (qualified_at / settled_at ?? ends_at).
      supabase
        .from('event_entries')
        .select('id, user_id, event_id, xp_awarded, qualified_at, events!inner(type, ends_at, settled_at, group_id)')
        .eq('events.group_id', groupId)
        .gte('events.ends_at', `${addDays(today, -EVENT_ENTRY_WINDOW_DAYS)}T00:00:00Z`)
        .gt('xp_awarded', 0),
    ]);
    if (runsResult.error || entriesResult.error) {
      logger.error(`❌ [RankNews] could not read today's XP for group ${groupId} (${errorCode(runsResult.error ?? entriesResult.error)})`);
      return;
    }

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
    const { users: standings, diverged } = buildRankDelta(members, ledger, today);

    // Divergerar liggaren från total_xp går dygnsskiftets ställning inte att lita på (previous_xp är klampad till 0).
    if (diverged.length > 0) logger.warn(`⚠️ [RankNews] XP ledger exceeds total_xp for ${diverged.length} user(s) in group ${groupId} — skipping their pairs`);
    const divergedIds = new Set(diverged);
    if (divergedIds.has(userId)) return;

    const midnight = new Map(standings.map((s) => [s.user_id, s.previous_xp]));
    const result = detectRankPasses({
      measure: 'xp',
      passerId: userId,
      today,
      members: members.map((m) => ({
        id: m.id,
        name: m.name,
        createdDate: m.created_date,
        midnight: midnight.get(m.id) ?? null,
        // W:s värde före skrivningen; alla andra är oförändrade av den.
        before: m.id === userId ? prevXp : m.total_xp,
        after: m.total_xp,
      })),
    });

    if (options.mode !== 'retract_only') {
      const drafts = result.passes
        .filter((p) => !divergedIds.has(p.passedId))
        .map((p) => buildRankPassedDraft(groupId, 'xp', p.passerId, p.passedId, p.passerRank, p.passedRank, occurredAt));
      await recordActivities(drafts);
    }

    // Bara dagens rader för de M som W åter ligger bakom (ADR 011 beslut 6.4); äldre dagars rader är historia. Ett diverged M hoppas
    // INTE över här: retractKeys bygger på före/efter, inte på dygnsskiftet, så retract är säkert även när M:s liggare inte går att lita
    // på, och att hoppa över kunde lämna en inaktuell rad kvar.
    for (const key of result.retractKeys) await retractActivity(key);
  } catch (e) {
    logger.error(`❌ [RankNews] recordRankPassesForXp failed for user ${userId} (${errorCode(e)})`);
  }
}
