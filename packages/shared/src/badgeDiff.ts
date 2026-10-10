// Skillnaden mellan lagrade user_badges och nyberäknade tiers (ADR 009 beslut 2).
// Ren funktion: ingen I/O, indata muteras aldrig, tiden injiceras. evaluateBadges (RUN-118) skriver
// posterna rakt av och lägger själv till user_id; här finns bara det som varierar per serie.

import { MAX_TIER, type BadgeTierResult } from './badges.js';

/** En befintlig rad i user_badges (utan user_id och updated_at, som diffen inte behöver läsa). */
export interface ExistingBadgeRow {
  series: string;
  /** 1..MAX_TIER */
  tier: number;
  /** 0..tier (CHECK seen_tier <= tier i tabellen). */
  seen_tier: number;
  /** ISO-sträng. */
  earned_at: string;
  source_run_id: string | null;
}

/** Ny rad: serien har ingen rad men tier >= 1. */
export interface BadgeInsert {
  series: string;
  tier: number;
  seen_tier: number;
  earned_at: string;
  source_run_id: string | null;
  /** = now; tabellen saknar trigger, så varje skrivning sätter den själv. */
  updated_at: string;
}

/** Högre tier än raden: earned_at och source_run_id följer den nya tiern; seen_tier lämnas. */
export interface BadgeUpgrade {
  series: string;
  tier: number;
  /** Tiern raden hade, för news-raden `badge_earned` (previous_tier). */
  previous_tier: number;
  seen_tier: number;
  earned_at: string;
  source_run_id: string | null;
  updated_at: string;
}

/**
 * Lägre tier (men >= 1). Bär medvetet inget earned_at: update-satsen ska lämna det orört.
 * tier och seen_tier skrivs i SAMMA update (CHECK seen_tier <= tier).
 */
export interface BadgeDowngrade {
  series: string;
  tier: number;
  previous_tier: number;
  /** least(seen_tier, tier) */
  seen_tier: number;
  source_run_id: string | null;
  updated_at: string;
}

/** Tier 0: raden raderas. previous_tier låter news-raderna för de förlorade tierna retractas. */
export interface BadgeDelete {
  series: string;
  previous_tier: number;
}

export interface BadgeDiff {
  inserts: BadgeInsert[];
  upgrades: BadgeUpgrade[];
  downgrades: BadgeDowngrade[];
  deletes: BadgeDelete[];
  /**
   * Serier att filtrera BORT ur users.displayed_badge_series (= serierna i `deletes`). Inte en färdig
   * array att skriva: anroparen läser användarens nuvarande array och filtrerar bort dessa.
   */
  showcaseRemovals: string[];
}

export interface DiffBadgeTiersOptions {
  /** Injiceras för test; standard är systemklockan. */
  now?: Date;
  /**
   * Backfill/--silent: nya och uppgraderade rader får seen_tier = tier så att ingen popup visas.
   * Nedgradering påverkas inte (där gäller alltid least).
   */
  markSeen?: boolean;
}

/**
 * Tier utanför 0..MAX_TIER klampas så att CHECK-villkoren aldrig bryts: under 1 (även -Infinity) = 0,
 * över MAX_TIER (även +Infinity) = MAX_TIER. NaN är ett beräkningsfel, inte "ingen tier": null =
 * rör serien inte alls, så ett fel kan aldrig radera en badge.
 */
function normalizeTier(tier: number): number | null {
  if (Number.isNaN(tier)) return null;
  if (tier < 1) return 0;
  return Math.min(Math.floor(tier), MAX_TIER);
}

/**
 * Jämför lagrade rader mot beräknade tiers och ger bara det som behöver skrivas.
 * Bara serier som finns i `computed` rörs; en serie i DB som beräkningen inte känner (t.ex. en
 * framtida eller utgången serie) lämnas ifred. Oförändrad tier ger ingen post, även om
 * source_run_id skiljer — annars skulle varje omkörning skriva om raden.
 */
export function diffBadgeTiers(
  existing: readonly ExistingBadgeRow[],
  computed: Readonly<Record<string, BadgeTierResult>>,
  opts: DiffBadgeTiersOptions = {}
): BadgeDiff {
  const nowIso = (opts.now ?? new Date()).toISOString();
  const markSeen = opts.markSeen === true;
  const bySeries = new Map(existing.map((row) => [row.series, row]));

  const diff: BadgeDiff = { inserts: [], upgrades: [], downgrades: [], deletes: [], showcaseRemovals: [] };

  for (const [series, result] of Object.entries(computed)) {
    const tier = normalizeTier(result.tier);
    if (tier === null) continue;
    const sourceRunId = result.source_run_id ?? null;
    const current = bySeries.get(series);

    if (!current) {
      if (tier === 0) continue;
      diff.inserts.push({
        series,
        tier,
        seen_tier: markSeen ? tier : 0,
        earned_at: nowIso,
        source_run_id: sourceRunId,
        updated_at: nowIso,
      });
      continue;
    }

    if (tier === current.tier) continue;

    if (tier === 0) {
      diff.deletes.push({ series, previous_tier: current.tier });
      diff.showcaseRemovals.push(series);
    } else if (tier > current.tier) {
      diff.upgrades.push({
        series,
        tier,
        previous_tier: current.tier,
        seen_tier: markSeen ? tier : current.seen_tier,
        earned_at: nowIso,
        source_run_id: sourceRunId,
        updated_at: nowIso,
      });
    } else {
      diff.downgrades.push({
        series,
        tier,
        previous_tier: current.tier,
        seen_tier: Math.min(current.seen_tier, tier),
        source_run_id: sourceRunId,
        updated_at: nowIso,
      });
    }
  }

  return diff;
}
