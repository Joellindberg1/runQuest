// Retroaktiv backfill av härledbara händelser (ADR 008 beslut 7) — rena byggfunktioner.
// Backfill-skriptet (apps/backend/src/scripts/backfillActivityLog.ts) är tunn I/O runt dessa.
// Alla rader får is_backfill = true och SAMMA dedupe_key som live-skrivningen (activityKeys).
// Titlar backfillas INTE: title_leaderboard skrivs över och user_titles.earned_at är "senast förbättrad".
import {
  ACTIVITY_PAYLOAD_VERSION,
  RUN_MILESTONES,
  activityKeys,
  addDaysToDay,
  buildChallengeReceivedDraft,
  buildChallengeSettledDraft,
  buildEventClosedDraft,
  buildEventOpenDraft,
  buildStreakBrokenDraft,
  stockholmMidnightIso,
  type ActivityDraft,
  type ChallengeActivityRow,
  type EventActivityRow,
} from './activity.js';
import { levelFromXP } from './levelCalculation.js';
import type { LevelRequirement } from './levelCalculation.js';
import type { XpLedgerEntry } from './xpLedger.js';

/** Standardfönster för backfill: flödets värde är färskhet. */
export const BACKFILL_DEFAULT_DAYS = 90;

// ─── Utmaningar ──────────────────────────────────────────────────────────────────────────────────

export interface BackfillChallengeRow extends ChallengeActivityRow {
  status: string;
  determine_at: string | null;
  /** Kalenderdag YYYY-MM-DD. */
  end_date: string | null;
  created_at: string;
}

/**
 * completed → challenge_won/_draw (occurred_at = determine_at ?? end_date);
 * pending → challenge_received (occurred_at = created_at). Active och övriga ger inga rader.
 */
export function backfillChallenges(challenges: ReadonlyArray<BackfillChallengeRow>): ActivityDraft[] {
  const out: ActivityDraft[] = [];
  for (const c of challenges) {
    if (c.status === 'completed') {
      const at = c.determine_at ?? (c.end_date ? stockholmMidnightIso(c.end_date) : null);
      if (!at) continue;
      const draft = buildChallengeSettledDraft(c, new Date(at).toISOString(), true);
      if (draft) out.push(draft);
    } else if (c.status === 'pending') {
      out.push(buildChallengeReceivedDraft(c, new Date(c.created_at).toISOString(), true));
    }
  }
  return out;
}

// ─── Events ──────────────────────────────────────────────────────────────────────────────────────

export interface BackfillEventEntry {
  event_id: string;
  user_id: string;
  rank: number | null;
  xp_awarded: number | null;
}

/**
 * active → event_open (starts_at); settled → event_closed (settled_at ?? ends_at) men bara med minst en deltagare.
 * Scheduled ger inget.
 * `participants` = antal event_entries; `members` = NUVARANDE gruppstorlek (approximation → is_backfill).
 */
export function backfillEvents(
  events: ReadonlyArray<EventActivityRow & { status: string }>,
  entries: ReadonlyArray<BackfillEventEntry>,
  membersByGroup: Readonly<Record<string, number>>,
): ActivityDraft[] {
  const entriesByEvent = new Map<string, BackfillEventEntry[]>();
  for (const en of entries) {
    const list = entriesByEvent.get(en.event_id) ?? [];
    list.push(en);
    entriesByEvent.set(en.event_id, list);
  }

  const out: ActivityDraft[] = [];
  for (const e of events) {
    if (e.status === 'active') {
      out.push(buildEventOpenDraft(e, true));
    } else if (e.status === 'settled') {
      const list = entriesByEvent.get(e.id) ?? [];
      if (list.length === 0) continue; // event utan deltagare är ingen nyhet (samma regel som live)
      const top = list
        .filter((x) => x.rank !== null && x.rank <= 3)
        .map((x) => ({ user_id: x.user_id, rank: x.rank as number, xp: x.xp_awarded ?? 0 }));
      out.push(
        buildEventClosedDraft(
          e,
          { participants: list.length, members: membersByGroup[e.group_id] ?? 0, top },
          new Date(e.settled_at ?? e.ends_at).toISOString(),
          true,
        ),
      );
    }
  }
  return out;
}

// ─── Levels (XP-liggaren) ────────────────────────────────────────────────────────────────────────

export interface ReplayedLevel {
  user_id: string;
  level: number;
  /** Stockholm-dag då kumulativ XP först nådde nivåns tröskel. */
  date: string;
}

/**
 * Spelar upp XP-liggaren (buildXpLedger) per användare i tidsordning och ger dagen då kumulativ
 * XP först nådde varje nivåtröskel (shared-matematiken, ADR 004). Nivå 1 är start och ger ingen rad.
 */
export function replayLevels(ledger: ReadonlyArray<XpLedgerEntry>, requirements: LevelRequirement[]): ReplayedLevel[] {
  const byUser = new Map<string, XpLedgerEntry[]>();
  for (const e of ledger) {
    const list = byUser.get(e.user_id) ?? [];
    list.push(e);
    byUser.set(e.user_id, list);
  }

  const out: ReplayedLevel[] = [];
  for (const [userId, entries] of byUser) {
    // Stabil sortering på dag; poster samma dag behåller liggarens ordning.
    const sorted = entries.map((e, i) => ({ e, i })).sort((a, b) => a.e.date.localeCompare(b.e.date) || a.i - b.i);
    let cumulative = 0;
    let level = 1;
    for (const { e } of sorted) {
      cumulative += e.xp;
      const reached = levelFromXP(cumulative, requirements);
      for (let l = level + 1; l <= reached; l++) out.push({ user_id: userId, level: l, date: e.date });
      if (reached > level) level = reached;
    }
  }
  return out;
}

export function backfillLevelUps(
  ledger: ReadonlyArray<XpLedgerEntry>,
  requirements: LevelRequirement[],
  groupByUser: ReadonlyMap<string, string | null>,
): ActivityDraft[] {
  const out: ActivityDraft[] = [];
  for (const r of replayLevels(ledger, requirements)) {
    const group = groupByUser.get(r.user_id);
    if (!group) continue;
    out.push({
      type: 'level_up', group_id: group, actor_user_id: r.user_id, target_user_id: null,
      payload: { level: r.level }, payload_version: ACTIVITY_PAYLOAD_VERSION,
      dedupe_key: activityKeys.levelUp(r.user_id, r.level),
      occurred_at: stockholmMidnightIso(r.date), is_backfill: true,
    });
  }
  return out;
}

// ─── Milstolpar och streak ur runs ───────────────────────────────────────────────────────────────

export interface BackfillRun {
  id: string;
  user_id: string;
  /** Kalenderdag YYYY-MM-DD. */
  date: string;
  distance: number | string | null;
}

/** Totala km kumulerat per användare i datumordning; dagen då varje tröskel först passerades. */
export function backfillRunMilestones(
  runs: ReadonlyArray<BackfillRun>,
  groupByUser: ReadonlyMap<string, string | null>,
): ActivityDraft[] {
  const byUser = new Map<string, BackfillRun[]>();
  for (const r of runs) {
    const list = byUser.get(r.user_id) ?? [];
    list.push(r);
    byUser.set(r.user_id, list);
  }

  const out: ActivityDraft[] = [];
  for (const [userId, list] of byUser) {
    const group = groupByUser.get(userId);
    if (!group) continue;
    const sorted = list.map((r, i) => ({ r, i })).sort((a, b) => a.r.date.localeCompare(b.r.date) || a.i - b.i);
    let km = 0;
    const done = new Set<number>();
    for (const { r } of sorted) {
      km += Number(r.distance ?? 0) || 0;
      // Live jämförs det AVRUNDADE totalet (users.total_km är numeric(8,2)) — samma här, annars kan en
      // milstolpe som live räknas som passerad saknas i backfillen (99.996 → 100.00).
      const rounded = Math.round(km * 100) / 100;
      for (const threshold of RUN_MILESTONES) {
        if (rounded >= threshold && !done.has(threshold)) {
          done.add(threshold);
          out.push({
            type: 'run_milestone', group_id: group, actor_user_id: userId, target_user_id: null,
            payload: { kind: 'total_km', threshold }, payload_version: ACTIVITY_PAYLOAD_VERSION,
            dedupe_key: activityKeys.runMilestone(userId, 'total_km', threshold),
            occurred_at: stockholmMidnightIso(r.date), is_backfill: true,
          });
        }
      }
    }
  }
  return out;
}

export interface StreakSegment {
  /** Första och sista dagen i en obruten följd av löpdagar. */
  start: string;
  end: string;
  length: number;
}

/** Sammanhängande dagsföljder (unika dagar, sorterade). */
export function streakSegments(days: ReadonlyArray<string>): StreakSegment[] {
  const sorted = [...new Set(days)].sort();
  const segments: StreakSegment[] = [];
  let start: string | null = null;
  let prev: string | null = null;
  let length = 0;
  for (const day of sorted) {
    if (prev !== null && addDaysToDay(prev, 1) === day) {
      length++;
    } else {
      if (start !== null && prev !== null) segments.push({ start, end: prev, length });
      start = day;
      length = 1;
    }
    prev = day;
  }
  if (start !== null && prev !== null) segments.push({ start, end: prev, length });
  return segments;
}

/**
 * Följder med längd ≥ T som är döda: följdes av ett glapp, eller slutade före igår
 * (dagen efter sista dagen + en till har passerat, dvs. end + 2 ≤ today).
 */
export function backfillStreakBroken(
  runs: ReadonlyArray<{ user_id: string; date: string }>,
  groupByUser: ReadonlyMap<string, string | null>,
  threshold: number,
  today: string,
): ActivityDraft[] {
  const daysByUser = new Map<string, string[]>();
  for (const r of runs) {
    const list = daysByUser.get(r.user_id) ?? [];
    list.push(r.date);
    daysByUser.set(r.user_id, list);
  }

  const out: ActivityDraft[] = [];
  for (const [userId, days] of daysByUser) {
    const group = groupByUser.get(userId);
    if (!group) continue;
    for (const seg of streakSegments(days)) {
      if (seg.length < threshold) continue;
      if (addDaysToDay(seg.end, 2) > today) continue; // streaken lever fortfarande (idag/igår) eller kan räddas
      out.push(buildStreakBrokenDraft(userId, group, seg.length, seg.end, true));
    }
  }
  return out;
}

// ─── Gemensamt ───────────────────────────────────────────────────────────────────────────────────

/** Behåller rader vars occurred_at ≥ början av Stockholm-dagen `sinceDay`. */
export function filterSince(drafts: ReadonlyArray<ActivityDraft>, sinceDay: string): ActivityDraft[] {
  const cutoff = Date.parse(stockholmMidnightIso(sinceDay));
  return drafts.filter((d) => Date.parse(d.occurred_at) >= cutoff);
}

/**
 * Kronologisk ordning (occurred_at, sedan dedupe_key för determinism) — backfillen skriver i den
 * ordningen så att id-ordningen i en tom tabell = tidsordning (ADR 008 beslut 12).
 */
export function sortChronologically(drafts: ReadonlyArray<ActivityDraft>): ActivityDraft[] {
  return [...drafts].sort(
    (a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at) || a.dedupe_key.localeCompare(b.dedupe_key),
  );
}

/** Dag (YYYY-MM-DD) som är `days` dagar före `today` — default `--since`. */
export function defaultSinceDay(today: string, days: number = BACKFILL_DEFAULT_DAYS): string {
  return addDaysToDay(today, -days);
}
