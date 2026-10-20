// 🏅 Badgesystemet (ADR 009 beslut 2) — den ENDA skrivmodulen för user_badges.
//
// evaluateBadges läser användarens rundor, räknar tiers (computeBadgeTiers), diffar mot lagrade rader
// (diffBadgeTiers) och skriver bara skillnaden. Badges är härledd data (kan regenereras ur rundorna), så
// funktionen är ICKE-KASTANDE som recordLevelUps/recordRunMilestones (ADR 008): fel loggas på error-nivå
// och sväljs — en misslyckad badgeutvärdering får aldrig fälla XP-/streak-/titelkedjan (STATE zon 1).
//
// Säkerhetsregel: utvärderingen körs bara på KOMPLETT indata. Faller läsningen av rundor, rader eller
// streak (även en enskild sida, eller når sid-loopen sin gräns) avbryts allt utan skrivning — en delvis
// läsning skulle annars se ut som att rundor försvunnit och nedgradera eller radera badges.
//
// Idempotens: oförändrade serier ger ingen post i diffen, så omkörning skriver ingenting. Inserts är
// INSERT … ON CONFLICT DO NOTHING så att två samtidiga utvärderingar aldrig skriver över varandras
// seen_tier (popup-vattenmärket).
//
// Självläkning: users.displayed_badge_series stäms av mot serierna som FINNS i user_badges efter varje
// utvärdering (inte bara mot den här körningens raderingar), så en serie som blev kvar i showcasen efter
// ett tidigare fel städas vid nästa körning.
import { getSupabaseClient } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { readUserGroupId } from './userGroupId.js';
import { recordActivities, retractActivity } from './activityLog.js';
import {
  badgeNewsChanges,
  computeBadgeTiers,
  diffBadgeTiers,
  type BadgeDiff,
  type BadgeRun,
  type ExistingBadgeRow,
} from '@runquest/shared';
import { errorCode } from '../utils/errorCode.js';

export const USER_BADGES_TABLE = 'user_badges';

/** Rader per runs-sida; PostgREST kapar annars tyst vid max-rows (1000). */
const RUNS_PAGE_SIZE = 1000;

/** Säkerhetsgräns för sid-loopen (100 000 rundor): en loop som aldrig tar slut får inte hänga en skrivväg. */
export const MAX_RUNS_PAGES = 100;

const RUN_COLUMNS = 'id, date, distance, start_time, moving_time, total_elevation_gain, is_treadmill, source';

export interface EvaluateBadgesOptions {
  /** Anroparen har redan räknat streaken (calculateUserTotals) — spar en läsning av users.longest_streak. */
  longestStreak?: number;
  /** Backfill/--silent: nya och uppgraderade rader får seen_tier = tier (ingen popup) och inga news skrivs eller retractas. */
  markSeen?: boolean;
  /** Injiceras i test; standard är systemklockan. */
  now?: Date;
}

export interface EvaluateBadgesResult {
  /**
   * Det som FAKTISKT skrevs till user_badges (en post per lyckad skrivning). news (RUN-123) bygger på
   * detta: en lyckad uppgradering ska ge news även om en annan skrivning föll. `showcaseRemovals` är
   * serierna vars rader raderades. Rensningen av displayed_badge_series ingår inte (ingen news).
   */
  written: BadgeDiff;
  /** false om någon skrivning eller showcase-läsning/-rensning föll; det som ändå skrevs står i `written`. */
  complete: boolean;
}

/**
 * Läsfel som ska avbryta utvärderingen (fångas av evaluateBadges, aldrig utåt). Bär databasens kod i `code`, inte felet självt som
 * `cause`: loggern serialiserar `cause`, och ett databasfel kan bära radvärden i sin text.
 */
class BadgeReadError extends Error {
  readonly code: string;
  constructor(what: string, source: unknown) {
    super(`read ${what} failed`);
    this.name = 'BadgeReadError';
    this.code = errorCode(source);
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
    // Okänd eller saknad källa räknas som manuell: Precisionist ska aldrig ge en badge på overifierad distans.
    source: row.source === 'strava' ? 'strava' : 'manual',
  };
}

/** Alla rundor sidvis (stabil ordning date, id så att inga rader hoppas över eller dubbleras mellan sidor). */
export async function readRuns(userId: string): Promise<BadgeRun[]> {
  const supabase = getSupabaseClient();
  const runs: BadgeRun[] = [];
  for (let pageIndex = 0; pageIndex < MAX_RUNS_PAGES; pageIndex++) {
    const offset = pageIndex * RUNS_PAGE_SIZE;
    const { data, error } = await supabase
      .from('runs')
      .select(RUN_COLUMNS)
      .eq('user_id', userId)
      .order('date', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + RUNS_PAGE_SIZE - 1);
    if (error) {
      // Offset bortom sista raden (416) är slutet när sista sidan råkade vara exakt full.
      if (offset > 0 && isOutOfRange(error)) return runs;
      throw new BadgeReadError('runs', error);
    }
    const page = data ?? [];
    runs.push(...page.map(toBadgeRun));
    if (page.length < RUNS_PAGE_SIZE) return runs;
  }
  throw new BadgeReadError('runs', { code: 'page_limit_reached' });
}

async function readLongestStreak(userId: string): Promise<number> {
  const { data, error } = await getSupabaseClient().from('users').select('longest_streak').eq('id', userId).single();
  if (error || !data) throw new BadgeReadError('users.longest_streak', error ?? { code: 'user_not_found' });
  const streak = Number(data.longest_streak ?? 0);
  return Number.isFinite(streak) ? streak : 0;
}

export async function readExistingBadges(userId: string): Promise<ExistingBadgeRow[]> {
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

/**
 * Skriver diffen. Varje skrivning är oberoende: en som faller stoppar inte de andra. Ger det som
 * faktiskt skrevs (en lyckad upgrade/downgrade per post, inserts och deletes som grupp) och om allt lyckades.
 */
async function writeDiff(userId: string, diff: BadgeDiff): Promise<EvaluateBadgesResult> {
  const supabase = getSupabaseClient();
  const written: BadgeDiff = { inserts: [], upgrades: [], downgrades: [], deletes: [], showcaseRemovals: [] };
  let complete = true;

  const attempt = async (label: string, write: () => PromiseLike<{ error: unknown }>): Promise<boolean> => {
    try {
      const { error } = await write();
      if (!error) return true;
      logger.error(`❌ [Badges] Failed to ${label} for user ${userId} (${errorCode(error)})`);
    } catch (e) {
      logger.error(`❌ [Badges] Unexpected error when trying to ${label} (${errorCode(e)})`);
    }
    complete = false;
    return false;
  };

  if (diff.inserts.length > 0) {
    const ok = await attempt('insert badges', () =>
      supabase
        .from(USER_BADGES_TABLE)
        .upsert(
          diff.inserts.map((i) => ({ user_id: userId, ...i })),
          { onConflict: 'user_id,series', ignoreDuplicates: true },
        ),
    );
    if (ok) written.inserts.push(...diff.inserts);
  }

  for (const u of diff.upgrades) {
    const ok = await attempt(`upgrade badge ${u.series}`, () =>
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
    if (ok) written.upgrades.push(u);
  }

  // Nedgradering: tier och seen_tier i SAMMA update (CHECK seen_tier <= tier); earned_at lämnas orört.
  for (const d of diff.downgrades) {
    const ok = await attempt(`downgrade badge ${d.series}`, () =>
      supabase
        .from(USER_BADGES_TABLE)
        .update({ tier: d.tier, seen_tier: d.seen_tier, source_run_id: d.source_run_id, updated_at: d.updated_at })
        .eq('user_id', userId)
        .eq('series', d.series),
    );
    if (ok) written.downgrades.push(d);
  }

  if (diff.deletes.length > 0) {
    const ok = await attempt('delete badges', () =>
      supabase
        .from(USER_BADGES_TABLE)
        .delete()
        .eq('user_id', userId)
        .in('series', diff.deletes.map((d) => d.series)),
    );
    if (ok) {
      written.deletes.push(...diff.deletes);
      written.showcaseRemovals.push(...diff.showcaseRemovals);
    }
  }

  return { written, complete };
}

/**
 * Serierna som finns i user_badges efter skrivningen: tidigare rader + lyckade inserts − lyckade deletes.
 * Upgrade/downgrade ändrar aldrig att en rad finns (tier >= 1).
 */
function seriesAfterWrite(existing: readonly ExistingBadgeRow[], written: BadgeDiff): Set<string> {
  const present = new Set(existing.map((row) => row.series));
  for (const insert of written.inserts) present.add(insert.series);
  for (const del of written.deletes) present.delete(del.series);
  return present;
}

/**
 * Läser users.displayed_badge_series och skriver tillbaka den filtrerad mot serierna som finns, med EN
 * update — bara om något ändras. Läsningen sker EFTER badge-skrivningarna för att minimera tiden mellan
 * läsning och skrivning mot en samtidig ändring av showcasen. Ger false om läsningen eller skrivningen föll.
 */
async function reconcileShowcase(userId: string, present: ReadonlySet<string>): Promise<boolean> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.from('users').select('displayed_badge_series').eq('id', userId).single();
    if (error || !data) {
      logger.error(`❌ [Badges] Failed to read displayed_badge_series for user ${userId} (${error ? errorCode(error) : 'user not found'})`);
      return false;
    }
    const current: string[] = Array.isArray(data.displayed_badge_series) ? data.displayed_badge_series : [];
    const next = current.filter((series) => present.has(series));
    if (next.length === current.length) return true;
    const { error: updateError } = await supabase
      .from('users')
      .update({ displayed_badge_series: next })
      .eq('id', userId);
    if (updateError) {
      logger.error(`❌ [Badges] Failed to clean displayed_badge_series for user ${userId} (${errorCode(updateError)})`);
      return false;
    }
    return true;
  } catch (e) {
    logger.error(`❌ [Badges] Unexpected error when cleaning displayed_badge_series (${errorCode(e)})`);
    return false;
  }
}

/**
 * Skriver en färdig diff och städar showcasen mot det som finns efteråt. Den delade skrivvägen: evaluateBadges
 * och backfill:badges (RUN-124) går båda hit, så backfillen skriver exakt som den löpande utvärderingen.
 * Kastar inte på skrivfel (de syns i `complete` och i loggen).
 */
export async function applyBadgeDiff(
  userId: string,
  existing: readonly ExistingBadgeRow[],
  diff: BadgeDiff
): Promise<EvaluateBadgesResult> {
  const result = await writeDiff(userId, diff);
  const showcaseOk = await reconcileShowcase(userId, seriesAfterWrite(existing, result.written));
  return { written: result.written, complete: result.complete && showcaseOk };
}

/**
 * Pack News för det som FAKTISKT skrevs (ADR 009 beslut 5): badge_earned för nya/uppgraderade tiers, retract av
 * raderna för förlorade tiers. Best-effort och icke-kastande — user_badges är redan skriven och står kvar vid fel.
 * Ligger här och inte i applyBadgeDiff så att backfill:badges (som går direkt till applyBadgeDiff) aldrig skriver news.
 * Retract först, sedan skrivning; dedupe_key gör att samtidiga utvärderingar inte kan ge dubbletter.
 */
async function writeBadgeNews(userId: string, written: BadgeDiff, now: Date): Promise<void> {
  try {
    const needsGroup = written.inserts.length > 0 || written.upgrades.length > 0;
    // News-raderna bär användarens grupp (ADR 009 beslut 5). Ett läsfel, och en användare som saknas, kastas hit och loggas nedan: ingen news utan en läst grupp.
    const groupId = needsGroup ? await readUserGroupId(userId, { onError: (error) => { throw error; } }) : null;
    const { drafts, retractKeys } = badgeNewsChanges(written, { userId, groupId, occurredAt: now.toISOString() });
    await Promise.all(retractKeys.map((key) => retractActivity(key)));
    await recordActivities(drafts);
  } catch (e) {
    logger.error(`❌ [Badges] Failed to write badge news for user ${userId} (${errorCode(e)})`);
  }
}

/**
 * Räknar om användarens badges ur alla rundor och synkar user_badges + users.displayed_badge_series.
 * KASTAR ALDRIG.
 *
 * Returnerar `null` bara när utvärderingen avbröts FÖRE skrivning (läsfel, sid-gräns eller oväntat fel):
 * inget har ändrats. Annars `{ written, complete }` där `written` är det som faktiskt skrevs — även när
 * `complete` är false (någon skrivning föll). News (writeBadgeNews, RUN-123) skrivs för `written`, aldrig för
 * hela diffen, så lyckade uppgraderingar inte tappar sin news när en annan skrivning faller. Misslyckade
 * poster räknas om vid nästa körning eftersom raderna då fortfarande skiljer sig från beräkningen.
 */
export async function evaluateBadges(
  userId: string,
  opts: EvaluateBadgesOptions = {}
): Promise<EvaluateBadgesResult | null> {
  try {
    const [runs, existing, longestStreak] = await Promise.all([
      readRuns(userId),
      readExistingBadges(userId),
      opts.longestStreak === undefined ? readLongestStreak(userId) : Promise.resolve(opts.longestStreak),
    ]);

    const computed = computeBadgeTiers(runs, { longest_streak: longestStreak });
    const diff = diffBadgeTiers(existing, computed, { now: opts.now, markSeen: opts.markSeen });

    const result = await applyBadgeDiff(userId, existing, diff);
    if (!opts.markSeen) await writeBadgeNews(userId, result.written, opts.now ?? new Date());
    return result;
  } catch (e) {
    logger.error(`❌ [Badges] evaluateBadges failed (${errorCode(e)})`);
    return null;
  }
}
