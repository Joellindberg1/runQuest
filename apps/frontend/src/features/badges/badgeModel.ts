import { BADGE_SERIES, MAX_SHOWCASE, MAX_TIER, TIER_NAMES, badgeMetricLabel, requirementText, tierFlavor } from '@runquest/shared';
import type { BadgeSeriesDef, BadgeUserItem, BadgeUserResponse } from '@runquest/shared';
import type { GroupBadges } from './api';
import { isEarnedTier, pipsText } from './components/badgeTier';

// Ren logik för badge-vyerna (ADR 009, spec §4 och §6, Design Council-villkoren 1, 2, 14 och 21). Ingen I/O och inga egna texter om
// serierna: namn, ikon, kravtext, flavor och måttetikett kommer ur @runquest/shared — här sätts bara ihop vad varje vy visar.

/** Vem som tittar på vems samling: avgör held-by-reglerna (X = N döljs på andras kort, "Only you" bara på mitt eget). */
export interface BadgeViewer {
  viewerId: string | null;
  ownerId: string;
}

/** Allt ett samlingskort/en Runner card-rad visar. Valfria fält finns bara när de ska renderas — aldrig platshållare. */
export interface BadgeRow {
  series: string;
  name: string;
  /** Nyckel till RQIcon. */
  icon: string;
  /** 1..MAX_TIER, null = låst. */
  tier: number | null;
  /** Common..Legendary, null = låst. */
  tierName: string | null;
  earned: boolean;
  /** Högsta nivån nådd: vyn visar "TOP TIER REACHED" i stället för Next-raden. */
  maxed: boolean;
  /** Måttets etikett ("Longest single run"); låsta kortets första rad. */
  metricLabel: string;
  /** Bara intjänade kort. Egen rad, aldrig i Next/Unlock. */
  flavor?: string;
  /** Intjänat: kravet för nuvarande tier, utan nivåprefix. Låst: kravet för Common (samma text som i `unlock`, utan prefix). */
  requirement: string;
  /** "Next: {Tier} — {krav}". Saknas på låsta och maxade serier. */
  next?: string;
  /** "Unlock: Common — {krav}". Bara låsta serier. */
  unlock?: string;
  /** "Held by X of N in your pack" / "Only you hold this in your pack". Bara intjänade kort, och bara när uppgiften finns. */
  heldBy?: string;
  /** Textmotsvarigheten till pips ("Tier 3 of 6"); "Locked" för låsta. */
  pipsLabel: string;
  /** 1-baserad plats i de valda badges (showcase), null = inte vald. */
  displayPosition: number | null;
}

export interface BadgePopupEntry {
  series: string;
  name: string;
  icon: string;
  tier: number;
  tierName: string;
  /** 'earned' = första gången serien nås (seen_tier 0), 'evolved' = högre tier än den jag senast sett. */
  kind: 'earned' | 'evolved';
  /** Tiern jag senast sett (evolved), annars null. */
  fromTier: number | null;
  fromTierName: string | null;
  flavor: string;
  requirement: string;
  heldBy?: string;
}

const SERIES_BY_KEY = new Map<string, BadgeSeriesDef>(BADGE_SERIES.map((series) => [series.key, series]));
const SERIES_ORDER = new Map<string, number>(BADGE_SERIES.map((series, index) => [series.key, index]));


/** Ägda, kända serier med giltig tier ur ett svar. Svaret kan komma från en nyare/äldre server än klienten — okänt ignoreras. */
function validItems(items: readonly BadgeUserItem[]): BadgeUserItem[] {
  return items.filter((entry) => SERIES_BY_KEY.has(entry.series) && isEarnedTier(entry.tier));
}

/** Serienycklar jag äger (i svarets ordning). */
export function ownedSeriesOf(userBadges: BadgeUserResponse | undefined): string[] {
  return validItems(userBadges?.items ?? []).map((entry) => entry.series);
}

function heldByText(series: string, tier: number, group: GroupBadges | undefined, viewer: BadgeViewer): string | undefined {
  const held = group?.holders[series]?.[String(tier)];
  const members = group?.member_count;
  if (!Number.isInteger(held) || !Number.isInteger(members)) return undefined;
  // Osammanhängande värden (stale rutnät, tom grupp) utelämnas hellre än visas.
  if ((held as number) < 1 || (members as number) < 1 || (held as number) > (members as number)) return undefined;
  const isOwn = viewer.viewerId !== null && viewer.viewerId === viewer.ownerId;
  // Council 1: på andras kort säger "alla har den" ingenting.
  if (!isOwn && held === members) return undefined;
  if (isOwn && held === 1) return 'Only you hold this in your pack';
  return `Held by ${held} of ${members} in your pack`;
}

function buildRow(def: BadgeSeriesDef, owned: BadgeUserItem | undefined, shown: readonly string[], group: GroupBadges | undefined, viewer: BadgeViewer): BadgeRow {
  const metricLabel = badgeMetricLabel(def);
  const displayPosition = shown.includes(def.key) ? shown.indexOf(def.key) + 1 : null;
  if (!owned) {
    const requirement = requirementText(def, 1);
    return {
      series: def.key, name: def.name, icon: def.icon, tier: null, tierName: null, earned: false, maxed: false, metricLabel,
      requirement, unlock: `Unlock: ${TIER_NAMES[0]} — ${requirement}`, pipsLabel: pipsText(null), displayPosition,
    };
  }
  const { tier } = owned;
  const heldBy = heldByText(def.key, tier, group, viewer);
  return {
    series: def.key, name: def.name, icon: def.icon, tier, tierName: TIER_NAMES[tier - 1], earned: true, maxed: tier === MAX_TIER, metricLabel,
    flavor: tierFlavor(def, tier),
    requirement: requirementText(def, tier),
    ...(tier < MAX_TIER && { next: `Next: ${TIER_NAMES[tier]} — ${requirementText(def, tier + 1)}` }),
    ...(heldBy && { heldBy }),
    pipsLabel: pipsText(tier),
    displayPosition,
  };
}

/**
 * Samlingen: en rad per serie i BADGE_SERIES-ordning (låsta också). Utan svar (laddar/fel) är raderna låsta — vyn väljer själv
 * skelett/felkort före. `group` kan saknas: då utelämnas held-by.
 */
export function buildCollection(userBadges: BadgeUserResponse | undefined, group: GroupBadges | undefined, viewer: BadgeViewer): BadgeRow[] {
  const byKey = new Map(validItems(userBadges?.items ?? []).map((entry) => [entry.series, entry]));
  const shown = cleanShowcase(userBadges?.showcase ?? [], [...byKey.keys()]);
  return BADGE_SERIES.map((def) => buildRow(def, byKey.get(def.key), shown, group, viewer));
}

// ─── Showcase (max tre, bara ägda; samma mönster som titelvalet) ─────────────────────────────────

/** Valet städat: bara ägda serier, utan dubbletter, i vald ordning, högst MAX_SHOWCASE. */
export function cleanShowcase(selected: readonly string[], ownedSeries: readonly string[]): string[] {
  const owned = new Set(ownedSeries);
  return selected.filter((key, index) => owned.has(key) && selected.indexOf(key) === index).slice(0, MAX_SHOWCASE);
}

/** Lägger till (sist, om det finns plats och serien är ägd) eller tar bort en serie i valet. */
export function toggleShowcase(selected: readonly string[], ownedSeries: readonly string[], series: string): string[] {
  const clean = cleanShowcase(selected, ownedSeries);
  if (clean.includes(series)) return clean.filter((key) => key !== series);
  if (!ownedSeries.includes(series) || clean.length >= MAX_SHOWCASE) return clean;
  return [...clean, series];
}

export function sameShowcase(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index]);
}

// ─── Optimistiska cache-uppdateringar (hookarna skriver dem före serverns svar och återställer vid fel) ───

/** Som POST /badges/seen: `seen_tier = tier` för valda serier (utan lista = alla), aldrig lägre, och bara där seen_tier finns. */
export function applySeen(data: BadgeUserResponse, series?: readonly string[]): BadgeUserResponse {
  const targeted = series === undefined ? null : new Set(series);
  return {
    ...data,
    items: data.items.map((entry) =>
      entry.seen_tier === undefined || (targeted && !targeted.has(entry.series)) ? entry : { ...entry, seen_tier: Math.max(entry.seen_tier, entry.tier) },
    ),
  };
}

export function applyShowcase(data: BadgeUserResponse, showcase: readonly string[]): BadgeUserResponse {
  return { ...data, showcase: [...showcase] };
}

// ─── Uppgraderingspopupen ────────────────────────────────────────────────────────────────────────

/**
 * Kön: en post per serie vars tier är högre än den jag senast sett (`seen_tier`), i serieordning. Rader utan `seen_tier`
 * (andras data) ger ingen post. `group` ger held-by i popupen (alltid ur min synvinkel).
 */
export function buildPopupQueue(items: readonly BadgeUserItem[], group?: GroupBadges): BadgePopupEntry[] {
  const highest = new Map<string, BadgeUserItem>();
  for (const entry of validItems(items)) {
    if (entry.seen_tier === undefined || entry.tier <= entry.seen_tier) continue;
    const known = highest.get(entry.series);
    if (!known || entry.tier > known.tier) highest.set(entry.series, entry);
  }
  const me: BadgeViewer = { viewerId: 'self', ownerId: 'self' };
  return [...highest.values()]
    .sort((a, b) => (SERIES_ORDER.get(a.series) ?? 0) - (SERIES_ORDER.get(b.series) ?? 0))
    .map((entry) => {
      const def = SERIES_BY_KEY.get(entry.series) as BadgeSeriesDef;
      const fromTier = entry.seen_tier !== undefined && entry.seen_tier >= 1 ? entry.seen_tier : null;
      const heldBy = heldByText(entry.series, entry.tier, group, me);
      return {
        series: def.key, name: def.name, icon: def.icon, tier: entry.tier, tierName: TIER_NAMES[entry.tier - 1],
        kind: fromTier === null ? 'earned' : 'evolved',
        fromTier, fromTierName: fromTier === null ? null : (TIER_NAMES[fromTier - 1] ?? null),
        flavor: tierFlavor(def, entry.tier), requirement: requirementText(def, entry.tier),
        ...(heldBy && { heldBy }),
      };
    });
}

/** Avfärdar en popup: bara den serien markeras sedd. */
export function dismissSeries(entry: Pick<BadgePopupEntry, 'series'>): string[] {
  return [entry.series];
}

/** "Skip all": varje serie i kön markeras sedd. */
export function skipAllSeries(queue: readonly Pick<BadgePopupEntry, 'series'>[]): string[] {
  return queue.map((entry) => entry.series);
}
