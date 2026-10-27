// 📰 rank_passed för måttet xp (ADR 011 beslut 6): "W gick förbi M på All-time-tabellen".
//
// Samma roll som recordLevelUps/evaluateBadges: en OBSERVATÖR som körs efter att XP skrivits (calculateUserTotals och de två
// event-XP-skrivningarna i eventService). Den kastar aldrig, rör aldrig totalerna (ADR 005/008) och skriver bara via activityLog.
//
// Dygnsskiftets ställning härleds ur samma liggare som GET /leaderboard/rank-delta: buildXpLedger + buildRankDelta med
// asOf = idag i gruppens tidszon (previous_xp = total_xp minus XP krediterad med datum ≥ idag). Ingen ny lagring, ingen ögonblickstabell.
//
// KÄND BEGRÄNSNING: liggaren är datumbaserad. En runda daterad IGÅR men synkad efter midnatt räknas som krediterad före
// dygnsskiftet, så W "låg redan före M" och ingen rad skrivs. Det ger en utebliven notis, aldrig en falsk.
//
// Inget lås här: anroparna kan hålla withUserLock för W (ett eget lås ger ReentrantLockError), och övriga medlemmar läses utan lås.
import {
  activityKeys,
  addDays,
  buildRankDelta,
  buildRankPassedDraft,
  buildXpLedger,
  detectRankPasses,
  zoneDay,
  zoneMidnightIso,
  type ChallengeRecord,
  type LedgerEventEntry,
  type RankDeltaInput,
} from '@runquest/shared';
import { getSupabaseClient } from '../config/database.js';
import { groupTimeZone } from '../utils/groupTimeZone.js';
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
    const timeZone = groupTimeZone(groupId);
    const today = zoneDay(now, timeZone);

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
      created_date: u.created_at ? zoneDay(new Date(u.created_at), timeZone) : null,
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
        .gte('events.ends_at', zoneMidnightIso(addDays(today, -EVENT_ENTRY_WINDOW_DAYS), timeZone))
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
    const ledger = buildXpLedger(runsResult.data ?? [], eventEntries, timeZone);
    const { users: standings, diverged } = buildRankDelta(members, ledger, today);

    // Divergerar liggaren från total_xp går dygnsskiftets ställning inte att lita på (previous_xp är klampad till 0).
    if (diverged.length > 0) logger.warn(`⚠️ [RankNews] XP ledger exceeds total_xp for ${diverged.length} user(s) in group ${groupId} — skipping their pairs`);
    const divergedIds = new Set(diverged);
    // W:s egen divergens stänger bara av NYA rader (de beror på dygnsskiftets ställning). Retract beror på före/efter och körs ändå.
    const passerDiverged = divergedIds.has(userId);

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

    if (options.mode !== 'retract_only' && !passerDiverged) {
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

// ─── challenge_points ─────────────────────────────────────────────────────────────────────────────

const EMPTY_RECORD: ChallengeRecord = { wins: 0, draws: 0, losses: 0 };

/** a minus b, eller null om någon term skulle bli negativ (då stämmer inte räknarna med loggen och ställningen går inte att lita på). */
function subtractRecord(a: ChallengeRecord, b: ChallengeRecord): ChallengeRecord | null {
  const result = { wins: a.wins - b.wins, draws: a.draws - b.draws, losses: a.losses - b.losses };
  return result.wins < 0 || result.draws < 0 || result.losses < 0 ? null : result;
}

const addTo = (map: Map<string, ChallengeRecord>, id: string, delta: Partial<ChallengeRecord>) => {
  const current = map.get(id) ?? EMPTY_RECORD;
  map.set(id, { wins: current.wins + (delta.wins ?? 0), draws: current.draws + (delta.draws ?? 0), losses: current.losses + (delta.losses ?? 0) });
};

/**
 * rank_passed för måttet challenge_points (ADR 011 beslut 6 och Ö8), efter att `settleChallenge` delat ut W/D/L: "W gick förbi M på
 * utmaningstabellen". Vinnaren körs genom detektionen, vid oavgjort båda; FÖRLORAREN körs aldrig (en förlorare som faller under någon
 * är inte en passering, och en första förlust från 0 matcher är "oförändrat" i måttet).
 *
 * Anropas först när BÅDA deltagarnas W/D/L är skrivna och avgörandets egen loggrad (challenge_won/challenge_draw) finns. Allt läses
 * då i slutläget, aldrig mitt i skrivningarna. Saknas raden hoppas allt över: dygnsskiftets ställning härleds ur loggen och skulle
 * annars räkna detta avgörande som redan inräknat.
 *
 * Dygnsskiftets ställning per medlem = nuvarande W/D/L minus utfallen i challenge_won/challenge_draw med occurred_at ≥ Stockholms
 * midnatt. Raderna bär BÅDA deltagarna i kolumnerna actor_user_id/target_user_id (aldrig i payloaden): challenge_won har vinnaren som
 * aktör och förloraren som mål, challenge_draw utmanaren som aktör och motståndaren som mål. Förlorarens förluster och oavgjorda
 * härleds alltså ur samma rader. Blir någon term negativ är medlemmen "diverged": hen får midnight null och detektionen hoppar över
 * alla par som rör henne.
 *
 * Kastar aldrig, och ändrar aldrig avgörandets utfall. Inget eget lås.
 * Ingen retract: challenge_points minskar bara om en avräkning ångras, vilket inte finns idag. Införs det måste en retract läggas till
 * på samma sätt som för xp (result.retractKeys → retractActivity).
 */
export async function recordRankPassesForChallenge(challengeId: string): Promise<void> {
  try {
    // ETT ögonblick för dagen, gränsen och occurred_at (se recordRankPassesForXp).
    const now = new Date();
    const occurredAt = now.toISOString();

    const supabase = getSupabaseClient();
    const challengeResult = await supabase
      .from('challenges')
      .select('id, group_id, status, challenger_id, opponent_id')
      .eq('id', challengeId)
      .maybeSingle();
    if (challengeResult.error) {
      logger.error(`❌ [RankNews] could not read challenge ${challengeId} (${errorCode(challengeResult.error)})`);
      return;
    }
    const challenge = challengeResult.data as { group_id: string | null; status: string; challenger_id: string; opponent_id: string } | null;
    if (!challenge?.group_id || challenge.status !== 'completed') return;
    const groupId = challenge.group_id;
    const timeZone = groupTimeZone(groupId);
    const today = zoneDay(now, timeZone);
    const dayStart = zoneMidnightIso(today, timeZone);

    const [membersResult, settledResult] = await Promise.all([
      supabase.from('users').select('id, name, wins, draws, losses, created_at').eq('group_id', groupId),
      supabase
        .from('activity_log')
        .select('type, actor_user_id, target_user_id, dedupe_key')
        .eq('group_id', groupId)
        .in('type', ['challenge_won', 'challenge_draw'])
        .gte('occurred_at', dayStart),
    ]);
    if (membersResult.error || settledResult.error) {
      logger.error(`❌ [RankNews] could not read challenge standings of group ${groupId} (${errorCode(membersResult.error ?? settledResult.error)})`);
      return;
    }

    const settledRows = (settledResult.data ?? []) as Array<{ type: string; actor_user_id: string; target_user_id: string; dedupe_key: string }>;
    const own = settledRows.find((r) => r.dedupe_key === activityKeys.challengeSettled(challengeId));
    if (!own) return; // loggraden skrevs inte (eller ligger före dygnsskiftet): hellre utebliven notis än en falsk
    const participants = new Set([challenge.challenger_id, challenge.opponent_id]);
    if (!participants.has(own.actor_user_id) || !participants.has(own.target_user_id)) return;

    // Vad detta avgörande gav var och en, och vad alla avgöranden sedan dygnsskiftet gav.
    const draw = own.type === 'challenge_draw';
    const ownDelta = new Map<string, ChallengeRecord>();
    if (draw) {
      addTo(ownDelta, own.actor_user_id, { draws: 1 });
      addTo(ownDelta, own.target_user_id, { draws: 1 });
    } else {
      addTo(ownDelta, own.actor_user_id, { wins: 1 });
      addTo(ownDelta, own.target_user_id, { losses: 1 });
    }
    const sinceMidnight = new Map<string, ChallengeRecord>();
    for (const row of settledRows) {
      if (row.type === 'challenge_draw') {
        addTo(sinceMidnight, row.actor_user_id, { draws: 1 });
        addTo(sinceMidnight, row.target_user_id, { draws: 1 });
      } else {
        addTo(sinceMidnight, row.actor_user_id, { wins: 1 });
        addTo(sinceMidnight, row.target_user_id, { losses: 1 });
      }
    }

    const memberRows = (membersResult.data ?? []) as Array<{
      id: string; name: string; wins: number | null; draws: number | null; losses: number | null; created_at: string | null;
    }>;
    if (memberRows.length < 2) return;

    const divergedIds: string[] = [];
    const members = [];
    for (const u of memberRows) {
      const after: ChallengeRecord = { wins: Number(u.wins ?? 0), draws: Number(u.draws ?? 0), losses: Number(u.losses ?? 0) };
      const before = subtractRecord(after, ownDelta.get(u.id) ?? EMPTY_RECORD);
      if (!before) {
        // W/D/L skrevs inte som avgörandet säger: ingen detektion alls hellre än en på halv data.
        logger.warn(`⚠️ [RankNews] W/D/L does not include settled challenge ${challengeId} for user ${u.id} — skipping`);
        return;
      }
      const midnight = subtractRecord(after, sinceMidnight.get(u.id) ?? EMPTY_RECORD);
      if (!midnight) divergedIds.push(u.id);
      members.push({
        id: u.id,
        name: u.name,
        createdDate: u.created_at ? zoneDay(new Date(u.created_at), timeZone) : null,
        midnight,
        before,
        after,
      });
    }
    if (divergedIds.length > 0) {
      logger.warn(`⚠️ [RankNews] challenge W/D/L is lower than today's settled challenges for ${divergedIds.length} user(s) in group ${groupId} — skipping their pairs`);
    }

    // Vinnaren, eller båda vid oavgjort. Detektionen avgör själv om måttet ökade (oavrundade poäng, vinster); förloraren körs aldrig.
    const passerIds = draw ? [own.actor_user_id, own.target_user_id] : [own.actor_user_id];
    const drafts = [];
    for (const passerId of passerIds) {
      const result = detectRankPasses({ measure: 'challenge_points', passerId, today, members });
      for (const p of result.passes) {
        const draft = buildRankPassedDraft(groupId, 'challenge_points', p.passerId, p.passedId, p.passerRank, p.passedRank, occurredAt);
        if (draft.dedupe_key !== p.dedupeKey) throw new Error('rank_passed dedupe_key differs from the detected pass');
        drafts.push(draft);
      }
    }
    await recordActivities(drafts);
  } catch (e) {
    logger.error(`❌ [RankNews] recordRankPassesForChallenge failed for challenge ${challengeId} (${errorCode(e)})`);
  }
}
