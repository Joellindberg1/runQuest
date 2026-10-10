// 🏅 Badgesystemet (ADR 009 beslut 2) — den ENDA skrivmodulen för user_badges.
//
// evaluateBadges läser användarens rundor, räknar tiers (computeBadgeTiers), diffar mot lagrade rader
// (diffBadgeTiers) och skriver bara skillnaden. Badges är härledd data (kan regenereras ur rundorna), så
// funktionen är ICKE-KASTANDE som recordLevelUps/recordRunMilestones (ADR 008): fel loggas på error-nivå
// och sväljs — en misslyckad badgeutvärdering får aldrig fälla XP-/streak-/titelkedjan (STATE zon 1).
//
// Säkerhetsregel: utvärderingen körs bara på KOMPLETT indata. Faller läsningen av rundor, rader eller
// streak (även en enskild sida) avbryts allt utan skrivning — en delvis läsning skulle annars se ut som
// att rundor försvunnit och nedgradera eller radera badges.
//
// Idempotens: oförändrade serier ger ingen post i diffen, så omkörning skriver ingenting. Inserts är
// INSERT … ON CONFLICT DO NOTHING så att två samtidiga utvärderingar aldrig skriver över varandras
// seen_tier (popup-vattenmärket).
import { getSupabaseClient } from '../config/database.js';
import { logger } from '../utils/logger.js';
import {
  computeBadgeTiers,
  diffBadgeTiers,
  type BadgeDiff,
  type BadgeRun,
  type ExistingBadgeRow,
} from '@runquest/shared';

export const USER_BADGES_TABLE = 'user_badges';

/** Rader per runs-sida; PostgREST kapar annars tyst vid max-rows (1000). */
const RUNS_PAGE_SIZE = 1000;

const RUN_COLUMNS = 'id, date, distance, start_time, moving_time, total_elevation_gain, is_treadmill';

export interface EvaluateBadgesOptions {
  /** Anroparen har redan räknat streaken (calculateUserTotals) — spar en läsning av users.longest_streak. */
  longestStreak?: number;
  /** Backfill/--silent: nya och uppgraderade rader får seen_tier = tier (ingen popup). */
  markSeen?: boolean;
  /** Injiceras i test; standard är systemklockan. */
  now?: Date;
}

/** Läsfel som ska avbryta utvärderingen (fångas av evaluateBadges, aldrig utåt). */
class BadgeReadError extends Error {
  constructor(what: string, cause: unknown) {
    super(`read ${what} failed`);
    this.name = 'BadgeReadError';
    this.cause = cause;
  }
}

const isOutOfRange = (e: { code?: string; status?: number } | null | undefined): boolean =>
  e?.code === 'PGRST103' || e?.status === 416;

/** runs-raden → BadgeRun. start_time lämnas som rå sträng: siffrorna ÄR väggklockan (ADR 009 beslut 2). */
function toBadgeRun(row: any): BadgeRun {
  return {
    id: row.id,
    date: row.date,
    distance_km: Number(row.distance ?? 0),
    start_time: row.start_time ?? null,
    moving_time: row.moving_time == null ? null : Number(row.moving_time),
    total_elevation_gain: row.total_elevation_gain == null ? null : Number(row.total_elevation_gain),
    is_treadmill: row.is_treadmill ?? null,
  };
}

/** Alla rundor sidvis (stabil ordning date, id så att inga rader hoppas över eller dubbleras mellan sidor). */
async function readRuns(userId: string): Promise<BadgeRun[]> {
  const supabase = getSupabaseClient();
  const runs: BadgeRun[] = [];
  for (let offset = 0; ; offset += RUNS_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('runs')
      .select(RUN_COLUMNS)
      .eq('user_id', userId)
      .order('date', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + RUNS_PAGE_SIZE - 1);
    if (error) {
      // Offset bortom sista raden (416) är slutet när sista sidan råkade vara exakt full.
      if (offset > 0 && isOutOfRange(error)) break;
      throw new BadgeReadError('runs', error);
    }
    const page = data ?? [];
    runs.push(...page.map(toBadgeRun));
    if (page.length < RUNS_PAGE_SIZE) break;
  }
  return runs;
}

async function readLongestStreak(userId: string): Promise<number> {
  const { data, error } = await getSupabaseClient().from('users').select('longest_streak').eq('id', userId).single();
  if (error || !data) throw new BadgeReadError('users.longest_streak', error ?? 'user not found');
  const streak = Number(data.longest_streak ?? 0);
  return Number.isFinite(streak) ? streak : 0;
}

async function readExistingBadges(userId: string): Promise<ExistingBadgeRow[]> {
  const { data, error } = await getSupabaseClient()
    .from(USER_BADGES_TABLE)
    .select('series, tier, seen_tier, earned_at, source_run_id')
    .eq('user_id', userId);
  if (error) throw new BadgeReadError(USER_BADGES_TABLE, error);
  return (data ?? []).map((row: any) => ({
    series: row.series,
    tier: Number(row.tier),
    seen_tier: Number(row.seen_tier),
    earned_at: row.earned_at,
    source_run_id: row.source_run_id ?? null,
  }));
}

/** Skriver diffen. Varje skrivning är oberoende: en som faller stoppar inte de andra. Ger false om någon föll. */
async function writeDiff(userId: string, diff: BadgeDiff): Promise<boolean> {
  const supabase = getSupabaseClient();
  let ok = true;
  const run = async (label: string, write: () => PromiseLike<{ error: unknown }>): Promise<boolean> => {
    try {
      const { error } = await write();
      if (!error) return true;
      logger.error(`❌ [Badges] Failed to ${label}:`, { error, userId });
    } catch (e) {
      logger.error(`❌ [Badges] Unexpected error when trying to ${label}:`, e);
    }
    ok = false;
    return false;
  };

  if (diff.inserts.length > 0) {
    await run('insert badges', () =>
      supabase
        .from(USER_BADGES_TABLE)
        .upsert(
          diff.inserts.map((i) => ({ user_id: userId, ...i })),
          { onConflict: 'user_id,series', ignoreDuplicates: true },
        ),
    );
  }

  for (const u of diff.upgrades) {
    await run(`upgrade badge ${u.series}`, () =>
      supabase
        .from(USER_BADGES_TABLE)
        .update({
          tier: u.tier,
          seen_tier: u.seen_tier,
          earned_at: u.earned_at,
          source_run_id: u.source_run_id,
          updated_at: u.updated_at,
        })
        .eq('user_id', userId)
        .eq('series', u.series),
    );
  }

  // Nedgradering: tier och seen_tier i SAMMA update (CHECK seen_tier <= tier); earned_at lämnas orört.
  for (const d of diff.downgrades) {
    await run(`downgrade badge ${d.series}`, () =>
      supabase
        .from(USER_BADGES_TABLE)
        .update({ tier: d.tier, seen_tier: d.seen_tier, source_run_id: d.source_run_id, updated_at: d.updated_at })
        .eq('user_id', userId)
        .eq('series', d.series),
    );
  }

  if (diff.deletes.length > 0) {
    const deleted = await run('delete badges', () =>
      supabase
        .from(USER_BADGES_TABLE)
        .delete()
        .eq('user_id', userId)
        .in('series', diff.deletes.map((d) => d.series)),
    );
    // Showcasen rensas bara om raderna verkligen är borta.
    if (deleted) await run('clean displayed_badge_series', () => removeFromShowcase(userId, diff.showcaseRemovals));
  }

  return ok;
}

/** Läser users.displayed_badge_series, filtrerar bort serierna och skriver med EN update — bara om något ändras. */
async function removeFromShowcase(userId: string, removals: readonly string[]): Promise<{ error: unknown }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('users').select('displayed_badge_series').eq('id', userId).single();
  if (error || !data) return { error: error ?? 'user not found' };
  const current: string[] = Array.isArray(data.displayed_badge_series) ? data.displayed_badge_series : [];
  const next = current.filter((series) => !removals.includes(series));
  if (next.length === current.length) return { error: null };
  return supabase.from('users').update({ displayed_badge_series: next }).eq('id', userId);
}

/**
 * Räknar om användarens badges ur alla rundor och synkar user_badges + users.displayed_badge_series.
 * KASTAR ALDRIG. Returnerar den skrivna diffen (för news i RUN-123: upgrades/inserts/deletes med
 * previous_tier), eller null om utvärderingen avbröts eller någon skrivning föll — anroparen ska då
 * inte skriva news för något som inte sparats.
 */
export async function evaluateBadges(userId: string, opts: EvaluateBadgesOptions = {}): Promise<BadgeDiff | null> {
  try {
    const [runs, existing, longestStreak] = await Promise.all([
      readRuns(userId),
      readExistingBadges(userId),
      opts.longestStreak === undefined ? readLongestStreak(userId) : Promise.resolve(opts.longestStreak),
    ]);

    const computed = computeBadgeTiers(runs, { longest_streak: longestStreak });
    const diff = diffBadgeTiers(existing, computed, { now: opts.now, markSeen: opts.markSeen });

    const written = await writeDiff(userId, diff);
    return written ? diff : null;
  } catch (e) {
    logger.error('❌ [Badges] evaluateBadges failed:', e);
    return null;
  }
}
