// Pack News för badges (ADR 009 beslut 5): vad en SKRIVEN badge-diff ska ge i activity_log.
// Ren funktion: ingen I/O, indata muteras aldrig. Anroparen (evaluateBadges) skickar det som faktiskt
// skrevs till user_badges — aldrig den planerade diffen — och utför sedan drafts/retractKeys best-effort.

import { activityKeys, buildBadgeEarnedDraft, type ActivityDraft } from './activity.js';
import type { BadgeDiff } from './badgeDiff.js';

export interface BadgeNewsContext {
  userId: string;
  /** users.group_id; null = ingen grupp, då skrivs inga rader. */
  groupId: string | null;
  /** ISO-tid för raderna (samma klocka som user_badges-skrivningen). */
  occurredAt: string;
}

export interface BadgeNewsChanges {
  /** badge_earned att skriva (en per serie: landningstiern). */
  drafts: ActivityDraft[];
  /** dedupe_key för rader att ta bort (förlorade tiers). Beror inte på grupp. */
  retractKeys: string[];
}

/** Tierna from..to (heltal); tom lista om intervallet är ogiltigt. */
function tierRange(from: number, to: number): number[] {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1) return [];
  const tiers: number[] = [];
  for (let tier = from; tier <= to; tier++) tiers.push(tier);
  return tiers;
}

/**
 * - insert → badge_earned med previous_tier null; upgrade → badge_earned för nya tiern med previous_tier = gamla.
 *   EN rad per serie även om flera tiers hoppades över (nyckeln är landningstiern).
 * - downgrade → retract tier+1..previous_tier; delete → retract 1..previous_tier.
 * Utan grupp ger inserts/upgrades inga rader; retract är nyckelstyrt och påverkas inte.
 */
export function badgeNewsChanges(written: BadgeDiff, ctx: BadgeNewsContext): BadgeNewsChanges {
  const drafts: ActivityDraft[] = [];
  const retractKeys: string[] = [];

  if (ctx.groupId) {
    for (const i of written.inserts) {
      drafts.push(buildBadgeEarnedDraft(ctx.userId, ctx.groupId, i.series, i.tier, null, ctx.occurredAt));
    }
    for (const u of written.upgrades) {
      drafts.push(buildBadgeEarnedDraft(ctx.userId, ctx.groupId, u.series, u.tier, u.previous_tier, ctx.occurredAt));
    }
  }

  for (const d of written.downgrades) {
    for (const tier of tierRange(d.tier + 1, d.previous_tier)) {
      retractKeys.push(activityKeys.badgeEarned(ctx.userId, d.series, tier));
    }
  }
  for (const d of written.deletes) {
    for (const tier of tierRange(1, d.previous_tier)) {
      retractKeys.push(activityKeys.badgeEarned(ctx.userId, d.series, tier));
    }
  }

  return { drafts, retractKeys };
}
