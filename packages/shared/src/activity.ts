// Händelseloggen (activity_log, ADR 008) — typkatalog, dedupe-nycklar och rena detektions-/byggfunktioner.
// Delas av backend (skrivpunkter, GET /api/news, backfill-skriptet) och frontend (rendering).
// Loggen OBSERVERAR spelet: ingenting här ändrar XP-/titel-/utmaningsregler.
//
// Typlistan har EN källa — ACTIVITY_TYPES. Migration 034:s CHECK-lista måste vara identisk
// (statiskt test i backend: activityLogMigration.test.ts).

export const ACTIVITY_TYPES = [
  'title_unlocked',
  'title_taken',
  'title_revoked',
  'challenge_received',
  'challenge_won',
  'challenge_draw',
  'level_up',
  'run_milestone',
  'streak_broken',
  'event_open',
  'event_closed',
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export function isActivityType(value: unknown): value is ActivityType {
  return typeof value === 'string' && (ACTIVITY_TYPES as readonly string[]).includes(value);
}

/** Aktuell payload-form för alla typer (activity_log.payload_version). */
export const ACTIVITY_PAYLOAD_VERSION = 1;

/** Totala km som ger en run_milestone-rad när de passeras (ADR 008 beslut 2). */
export const RUN_MILESTONES = [100, 250, 500, 1000, 2500, 5000] as const;

/** Lägsta streak-längd som räknas som "streak som gav multiplikator" när streak_multipliers saknas. */
export const DEFAULT_STREAK_BROKEN_THRESHOLD = 5;

// ─── Payloads (v1). Fakta, inte text; ingen e-post/hash/token/Strava-id får hamna här. ──────────

export interface BoostSnapshot {
  type: string;
  delta: number;
  duration: number | null;
}

export interface TitleUnlockedPayload {
  title_id: string;
  title_name: string;
  metric_key: string;
  value: number;
}

export interface TitleTakenPayload {
  title_id: string;
  title_name: string;
  metric_key: string;
  value: number;
  previous_value: number;
  reason: 'overtaken' | 'revoked';
}

export interface TitleRevokedPayload {
  title_id: string;
  title_name: string;
  metric_key: string;
}

export interface ChallengeReceivedPayload {
  challenge_id: string;
  tier: string;
  metric: string;
  duration_days: number;
}

export interface ChallengeWonPayload {
  challenge_id: string;
  tier: string;
  metric: string;
  duration_days: number;
  winner_value: number;
  loser_value: number;
  winner_boost: BoostSnapshot;
  loser_boost: BoostSnapshot;
}

export interface ChallengeDrawPayload {
  challenge_id: string;
  tier: string;
  metric: string;
  duration_days: number;
  challenger_value: number;
  opponent_value: number;
}

export interface LevelUpPayload {
  level: number;
}

export interface RunMilestonePayload {
  kind: 'total_km';
  threshold: number;
}

export interface StreakBrokenPayload {
  length: number;
  /** Kalenderdag YYYY-MM-DD (Stockholm). */
  last_run_date: string;
}

export interface EventOpenPayload {
  event_id: string;
  event_type: 'participation' | 'competition';
  template_name: string;
  icon: string;
  /** Participation: reward_xp. Competition: förstapriset (reward_xp_1st). */
  reward_xp: number | null;
  ends_at: string;
}

export interface EventClosedPayload {
  event_id: string;
  event_type: 'participation' | 'competition';
  template_name: string;
  participants: number;
  members: number;
  /** Bara competition: topp 3. */
  top?: Array<{ user_id: string; rank: number; xp: number }>;
}

export interface ActivityPayloadMap {
  title_unlocked: TitleUnlockedPayload;
  title_taken: TitleTakenPayload;
  title_revoked: TitleRevokedPayload;
  challenge_received: ChallengeReceivedPayload;
  challenge_won: ChallengeWonPayload;
  challenge_draw: ChallengeDrawPayload;
  level_up: LevelUpPayload;
  run_milestone: RunMilestonePayload;
  streak_broken: StreakBrokenPayload;
  event_open: EventOpenPayload;
  event_closed: EventClosedPayload;
}

export type ActivityPayload<T extends ActivityType = ActivityType> = ActivityPayloadMap[T];

/** En färdig rad att skriva till activity_log (allt utom id/created_at). Diskriminerad på `type`. */
export type ActivityDraft = {
  [T in ActivityType]: {
    type: T;
    group_id: string;
    actor_user_id: string | null;
    target_user_id: string | null;
    payload: ActivityPayloadMap[T];
    payload_version: number;
    dedupe_key: string;
    /** ISO-8601 UTC — när det hände (inte när det loggades). */
    occurred_at: string;
    is_backfill: boolean;
  };
}[ActivityType];

// ─── Dedupe-nycklar (ADR 008 beslut 3) — live-skrivning och backfill delar dem ───────────────────

/** Tal → stabil nyckeldel ("12.5000" och 12.5 ger båda "12.5"). */
function keyNumber(value: number | string): string {
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : String(value);
}

export const activityKeys = {
  challengeReceived: (challengeId: string) => `challenge_received:${challengeId}`,
  /** challenge_won och challenge_draw delar nyckel — en utmaning avgörs exakt en gång. */
  challengeSettled: (challengeId: string) => `challenge_settled:${challengeId}`,
  /** Första gången nivån nås — regression och återtagande ger ingen andra rad. */
  levelUp: (userId: string, level: number) => `level_up:${userId}:${level}`,
  runMilestone: (userId: string, kind: RunMilestonePayload['kind'], threshold: number) =>
    `run_milestone:${userId}:${kind}:${threshold}`,
  streakBroken: (userId: string, lastRunDate: string) => `streak_broken:${userId}:${lastRunDate}`,
  eventOpen: (eventId: string) => `event_open:${eventId}`,
  eventClosed: (eventId: string) => `event_closed:${eventId}`,
  titleUnlocked: (titleId: string, userId: string, value: number | string) =>
    `title_unlocked:${titleId}:${userId}:${keyNumber(value)}`,
  titleTaken: (titleId: string, newHolderId: string, oldHolderId: string, value: number | string) =>
    `title_taken:${titleId}:${newHolderId}:${oldHolderId}:${keyNumber(value)}`,
  /** `day` = Stockholm-kalenderdag (YYYY-MM-DD). */
  titleRevoked: (titleId: string, userId: string, day: string) => `title_revoked:${titleId}:${userId}:${day}`,
} as const;

// ─── Stockholm-tid (ren kalenderaritmetik, ingen systemtid) ──────────────────────────────────────

const STOCKHOLM_TZ = 'Europe/Stockholm';

const stockholmParts = new Intl.DateTimeFormat('en-US', {
  timeZone: STOCKHOLM_TZ,
  hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

/** Stockholms UTC-offset (ms) vid ett givet UTC-ögonblick. */
function stockholmOffsetMs(instantMs: number): number {
  const parts: Record<string, number> = {};
  for (const p of stockholmParts.formatToParts(new Date(instantMs))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

/** Lägger N dagar till en YYYY-MM-DD-sträng (kalenderaritmetik, DST-fri via UTC-middag). */
export function addDaysToDay(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0)).toISOString().slice(0, 10);
}

/** ISO-ögonblicket (UTC) då Stockholm-dagen `day` (YYYY-MM-DD) börjar, kl 00:00 lokal tid. DST-säker. */
export function stockholmMidnightIso(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const utcMidnight = Date.UTC(y, m - 1, d, 0, 0, 0);
  // Två steg: offseten vid gissningen kan skilja från offseten vid det verkliga midnattsögonblicket
  // (DST-dagar växlar mellan midnatt och middag).
  const o1 = stockholmOffsetMs(utcMidnight);
  const first = utcMidnight - o1;
  const o2 = stockholmOffsetMs(first);
  return new Date(o2 === o1 ? first : utcMidnight - o2).toISOString();
}

// ─── Detektion: nivåer, milstolpar, streak ───────────────────────────────────────────────────────

/** Nivåerna i (prev, next] — en per uppnådd nivå. Tom om nivån inte ökat eller värden saknas. */
export function levelsCrossed(prev: number | null | undefined, next: number | null | undefined): number[] {
  if (typeof prev !== 'number' || typeof next !== 'number') return [];
  if (!Number.isFinite(prev) || !Number.isFinite(next) || next <= prev) return [];
  const out: number[] = [];
  for (let level = Math.floor(prev) + 1; level <= next; level++) out.push(level);
  return out;
}

/** Milstolpar med prevKm < tröskel ≤ nextKm. */
export function milestonesCrossed(prevKm: number | null | undefined, nextKm: number | null | undefined): number[] {
  if (typeof prevKm !== 'number' || typeof nextKm !== 'number') return [];
  if (!Number.isFinite(prevKm) || !Number.isFinite(nextKm)) return [];
  return RUN_MILESTONES.filter((t) => prevKm < t && t <= nextKm);
}

/** T = lägsta `days` i streak_multipliers (streaken började ge multiplikator); fallback 5. */
export function streakBrokenThreshold(multipliers: ReadonlyArray<{ days: number }> | null | undefined): number {
  const days = (multipliers ?? []).map((m) => Number(m.days)).filter((n) => Number.isFinite(n) && n > 0);
  return days.length > 0 ? Math.min(...days) : DEFAULT_STREAK_BROKEN_THRESHOLD;
}

/** En streak som gav multiplikator (≥ T) och nu är 0. */
export function isStreakBroken(prevStreak: number | null | undefined, nextStreak: number, threshold: number): boolean {
  return typeof prevStreak === 'number' && prevStreak >= threshold && nextStreak === 0;
}

/** streak_broken inträffar kl 00:00 Stockholm dag `last_run_date + 2` (då är streaken inte längre räddningsbar). */
export function streakBrokenOccurredAt(lastRunDate: string): string {
  return stockholmMidnightIso(addDaysToDay(lastRunDate, 2));
}

// ─── Titeldetektion (snapshot-diff, ADR 008 beslut 6) ────────────────────────────────────────────

export interface TitleHolder {
  title_id: string;
  user_id: string;
  value: number;
}

export type TitleHolderChange =
  | { kind: 'unlocked'; title_id: string; user_id: string; value: number }
  | {
      kind: 'taken';
      title_id: string;
      new_holder_id: string;
      old_holder_id: string;
      value: number;
      previous_value: number;
      reason: 'overtaken' | 'revoked';
    }
  | { kind: 'revoked'; title_id: string; user_id: string };

/**
 * Jämför innehavare (position 1) före/efter en titelbearbetning.
 *  - ingen → någon  = unlocked
 *  - A → B          = taken (reason 'revoked' om A inte längre har en user_titles-rad, annars 'overtaken')
 *  - någon → ingen  = revoked (den förra innehavaren)
 *  - samma innehavare (även med ändrat värde) = ingen händelse
 * `stillHolds(titleId, userId)` = har användaren fortfarande en user_titles-rad för titeln?
 */
export function diffTitleHolders(
  before: ReadonlyArray<TitleHolder>,
  after: ReadonlyArray<TitleHolder>,
  stillHolds: (titleId: string, userId: string) => boolean,
): TitleHolderChange[] {
  const beforeBy = new Map(before.map((h) => [h.title_id, h]));
  const afterBy = new Map(after.map((h) => [h.title_id, h]));
  const titleIds = [...new Set([...beforeBy.keys(), ...afterBy.keys()])].sort();

  const changes: TitleHolderChange[] = [];
  for (const titleId of titleIds) {
    const was = beforeBy.get(titleId);
    const now = afterBy.get(titleId);

    if (!was && now) {
      changes.push({ kind: 'unlocked', title_id: titleId, user_id: now.user_id, value: Number(now.value) });
    } else if (was && !now) {
      changes.push({ kind: 'revoked', title_id: titleId, user_id: was.user_id });
    } else if (was && now && was.user_id !== now.user_id) {
      changes.push({
        kind: 'taken',
        title_id: titleId,
        new_holder_id: now.user_id,
        old_holder_id: was.user_id,
        value: Number(now.value),
        previous_value: Number(was.value),
        reason: stillHolds(titleId, was.user_id) ? 'overtaken' : 'revoked',
      });
    }
  }
  return changes;
}

export interface TitleMeta {
  id: string;
  name: string;
  metric_key: string;
}

/**
 * Titeländringar → rader. `groupByUser` ger användarens users.group_id (nya innehavaren; vid
 * revoked den förras). Saknas grupp eller titelmeta hoppas raden över (ADR 008 beslut 6).
 * `occurredAt` = ISO nu; `day` = Stockholm-dag för title_revoked-nyckeln.
 */
export function buildTitleDrafts(
  changes: ReadonlyArray<TitleHolderChange>,
  titles: ReadonlyMap<string, TitleMeta>,
  groupByUser: ReadonlyMap<string, string | null>,
  occurredAt: string,
  day: string,
): ActivityDraft[] {
  const drafts: ActivityDraft[] = [];
  for (const c of changes) {
    const meta = titles.get(c.title_id);
    if (!meta) continue;
    const base = { payload_version: ACTIVITY_PAYLOAD_VERSION, occurred_at: occurredAt, is_backfill: false };

    if (c.kind === 'unlocked') {
      const group = groupByUser.get(c.user_id);
      if (!group) continue;
      drafts.push({
        ...base, type: 'title_unlocked', group_id: group, actor_user_id: c.user_id, target_user_id: null,
        payload: { title_id: c.title_id, title_name: meta.name, metric_key: meta.metric_key, value: c.value },
        dedupe_key: activityKeys.titleUnlocked(c.title_id, c.user_id, c.value),
      });
    } else if (c.kind === 'taken') {
      const group = groupByUser.get(c.new_holder_id);
      if (!group) continue;
      drafts.push({
        ...base, type: 'title_taken', group_id: group, actor_user_id: c.new_holder_id, target_user_id: c.old_holder_id,
        payload: {
          title_id: c.title_id, title_name: meta.name, metric_key: meta.metric_key,
          value: c.value, previous_value: c.previous_value, reason: c.reason,
        },
        dedupe_key: activityKeys.titleTaken(c.title_id, c.new_holder_id, c.old_holder_id, c.value),
      });
    } else {
      const group = groupByUser.get(c.user_id);
      if (!group) continue;
      drafts.push({
        ...base, type: 'title_revoked', group_id: group, actor_user_id: c.user_id, target_user_id: null,
        payload: { title_id: c.title_id, title_name: meta.name, metric_key: meta.metric_key },
        dedupe_key: activityKeys.titleRevoked(c.title_id, c.user_id, day),
      });
    }
  }
  return drafts;
}

// ─── Byggare: level, milstolpe, streak ───────────────────────────────────────────────────────────

export function buildLevelUpDrafts(
  userId: string, groupId: string, prevLevel: number | null | undefined, newLevel: number | null | undefined,
  occurredAt: string, isBackfill = false,
): ActivityDraft[] {
  return levelsCrossed(prevLevel, newLevel).map((level) => ({
    type: 'level_up' as const, group_id: groupId, actor_user_id: userId, target_user_id: null,
    payload: { level }, payload_version: ACTIVITY_PAYLOAD_VERSION,
    dedupe_key: activityKeys.levelUp(userId, level), occurred_at: occurredAt, is_backfill: isBackfill,
  }));
}

export function buildRunMilestoneDrafts(
  userId: string, groupId: string, prevKm: number | null | undefined, newKm: number | null | undefined,
  occurredAt: string, isBackfill = false,
): ActivityDraft[] {
  return milestonesCrossed(prevKm, newKm).map((threshold) => ({
    type: 'run_milestone' as const, group_id: groupId, actor_user_id: userId, target_user_id: null,
    payload: { kind: 'total_km' as const, threshold }, payload_version: ACTIVITY_PAYLOAD_VERSION,
    dedupe_key: activityKeys.runMilestone(userId, 'total_km', threshold), occurred_at: occurredAt, is_backfill: isBackfill,
  }));
}

export function buildStreakBrokenDraft(
  userId: string, groupId: string, length: number, lastRunDate: string, isBackfill = false,
): ActivityDraft {
  return {
    type: 'streak_broken', group_id: groupId, actor_user_id: userId, target_user_id: null,
    payload: { length, last_run_date: lastRunDate }, payload_version: ACTIVITY_PAYLOAD_VERSION,
    dedupe_key: activityKeys.streakBroken(userId, lastRunDate),
    occurred_at: streakBrokenOccurredAt(lastRunDate), is_backfill: isBackfill,
  };
}

// ─── Byggare: utmaningar ─────────────────────────────────────────────────────────────────────────

/** De fält ur challenges-raden som loggen behöver. Extra kolumner (t.ex. token_id) ignoreras. */
export interface ChallengeActivityRow {
  id: string;
  group_id: string;
  status?: string;
  tier: string;
  metric: string;
  duration_days: number;
  challenger_id: string;
  opponent_id: string;
  outcome?: string | null;
  challenger_final_value?: number | string | null;
  opponent_final_value?: number | string | null;
  winner_type?: string | null;
  winner_delta?: number | string | null;
  winner_duration?: number | null;
  loser_type?: string | null;
  loser_delta?: number | string | null;
  loser_duration?: number | null;
}

const num = (v: number | string | null | undefined): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export function buildChallengeReceivedDraft(c: ChallengeActivityRow, occurredAt: string, isBackfill = false): ActivityDraft {
  return {
    type: 'challenge_received', group_id: c.group_id, actor_user_id: c.challenger_id, target_user_id: c.opponent_id,
    payload: { challenge_id: c.id, tier: c.tier, metric: c.metric, duration_days: c.duration_days },
    payload_version: ACTIVITY_PAYLOAD_VERSION,
    dedupe_key: activityKeys.challengeReceived(c.id), occurred_at: occurredAt, is_backfill: isBackfill,
  };
}

/**
 * Avgjord utmaning → challenge_won (vinnaren → förloraren) eller challenge_draw (utmanaren → motståndaren).
 * Null om utfallet inte är ett av de tre kända. "challenge lost" är samma rad sedd av `target`.
 */
export function buildChallengeSettledDraft(c: ChallengeActivityRow, occurredAt: string, isBackfill = false): ActivityDraft | null {
  const common = {
    payload_version: ACTIVITY_PAYLOAD_VERSION,
    dedupe_key: activityKeys.challengeSettled(c.id), occurred_at: occurredAt, is_backfill: isBackfill,
    group_id: c.group_id,
  };
  const head = { challenge_id: c.id, tier: c.tier, metric: c.metric, duration_days: c.duration_days };
  const cv = num(c.challenger_final_value);
  const ov = num(c.opponent_final_value);

  if (c.outcome === 'draw') {
    return {
      ...common, type: 'challenge_draw', actor_user_id: c.challenger_id, target_user_id: c.opponent_id,
      payload: { ...head, challenger_value: cv, opponent_value: ov },
    };
  }
  if (c.outcome !== 'challenger_wins' && c.outcome !== 'opponent_wins') return null;

  const challengerWon = c.outcome === 'challenger_wins';
  return {
    ...common, type: 'challenge_won',
    actor_user_id: challengerWon ? c.challenger_id : c.opponent_id,
    target_user_id: challengerWon ? c.opponent_id : c.challenger_id,
    payload: {
      ...head,
      winner_value: challengerWon ? cv : ov,
      loser_value: challengerWon ? ov : cv,
      winner_boost: { type: c.winner_type ?? '', delta: num(c.winner_delta), duration: c.winner_duration ?? null },
      loser_boost: { type: c.loser_type ?? '', delta: num(c.loser_delta), duration: c.loser_duration ?? null },
    },
  };
}

// ─── Byggare: events ─────────────────────────────────────────────────────────────────────────────

export interface EventActivityRow {
  id: string;
  group_id: string;
  type: 'participation' | 'competition';
  status?: string;
  starts_at: string;
  ends_at: string;
  settled_at?: string | null;
  template: {
    name: string;
    icon: string | null;
    reward_xp: number | null;
    reward_xp_1st?: number | null;
  };
}

export function buildEventOpenDraft(e: EventActivityRow, isBackfill = false): ActivityDraft {
  const reward = e.type === 'competition' ? (e.template.reward_xp_1st ?? null) : (e.template.reward_xp ?? null);
  return {
    type: 'event_open', group_id: e.group_id, actor_user_id: null, target_user_id: null,
    payload: {
      event_id: e.id, event_type: e.type, template_name: e.template.name,
      icon: e.template.icon ?? 'calendar', reward_xp: reward === null ? null : Number(reward), ends_at: e.ends_at,
    },
    payload_version: ACTIVITY_PAYLOAD_VERSION,
    dedupe_key: activityKeys.eventOpen(e.id), occurred_at: e.starts_at, is_backfill: isBackfill,
  };
}

export interface EventClosedFacts {
  participants: number;
  members: number;
  /** Bara competition; sorteras och kapas till topp 3 här. */
  top?: Array<{ user_id: string; rank: number; xp: number }>;
}

export function buildEventClosedDraft(
  e: EventActivityRow, facts: EventClosedFacts, occurredAt: string, isBackfill = false,
): ActivityDraft {
  const payload: EventClosedPayload = {
    event_id: e.id, event_type: e.type, template_name: e.template.name,
    participants: facts.participants, members: facts.members,
  };
  if (e.type === 'competition' && facts.top) {
    payload.top = [...facts.top].sort((a, b) => a.rank - b.rank).slice(0, 3)
      .map((t) => ({ user_id: t.user_id, rank: t.rank, xp: t.xp }));
  }
  return {
    type: 'event_closed', group_id: e.group_id, actor_user_id: null, target_user_id: null,
    payload, payload_version: ACTIVITY_PAYLOAD_VERSION,
    dedupe_key: activityKeys.eventClosed(e.id), occurred_at: occurredAt, is_backfill: isBackfill,
  };
}
