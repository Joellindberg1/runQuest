// Frodo's journey: ren waypoint-/viewport-matematik. Delas av Profile (components/JourneyCard) och Runner card
// (features/runner/components/JourneyCard) — EN layoutalgoritm. Ingen DOM här.

export const JOURNEY_END_KM = 3266;

export type ZoomLevel = 0 | 1 | 2;

export interface Waypoint {
  name: string;
  km: number;
  tier: 1 | 2;
}

export const ALL_WAYPOINTS: Waypoint[] = ([
  // Större mål (tier 1)
  { name: 'The Shire',          km: 0,    tier: 1 },
  { name: 'Bree',               km: 168,  tier: 1 },
  { name: 'Rivendell',          km: 457,  tier: 1 },
  { name: 'Moria',              km: 1181, tier: 1 },
  { name: 'Rauros',             km: 1892, tier: 1 },
  { name: 'The Black Gate',     km: 2680, tier: 1 },
  { name: 'Mount Doom',         km: 3266, tier: 1 },

  // The Shire → Bree
  { name: 'Woody End',          km: 34,   tier: 2 },
  { name: 'Bucklebury Ferry',   km: 67,   tier: 2 },
  { name: "Tom Bombadil's",     km: 101,  tier: 2 },
  { name: 'Barrow-downs',       km: 134,  tier: 2 },

  // Bree → Rivendell
  { name: 'Midgewater Marshes', km: 226,  tier: 2 },
  { name: 'Weathertop',         km: 284,  tier: 2 },
  { name: 'The Last Bridge',    km: 342,  tier: 2 },
  { name: 'Trollshaws',         km: 399,  tier: 2 },

  // Rivendell → Moria
  { name: 'Hollin',             km: 602,  tier: 2 },
  { name: 'Caradhras',          km: 747,  tier: 2 },
  { name: 'Doors of Durin',     km: 892,  tier: 2 },
  { name: "Balin's Tomb",       km: 1037, tier: 2 },

  // Moria → Rauros
  { name: 'Dimrill Dale',       km: 1323, tier: 2 },
  { name: 'Lothlórien',         km: 1465, tier: 2 },
  { name: 'The Tongue',         km: 1607, tier: 2 },
  { name: 'Argonath',           km: 1749, tier: 2 },

  // Rauros → The Black Gate
  { name: 'Emyn Muil',          km: 2050, tier: 2 },
  { name: 'Dead Marshes',       km: 2208, tier: 2 },
  { name: 'Dagorlad',           km: 2366, tier: 2 },
  { name: 'Morannon',           km: 2524, tier: 2 },

  // The Black Gate → Mount Doom
  { name: 'Ithilien',           km: 2797, tier: 2 },
  { name: 'Cirith Ungol',       km: 2914, tier: 2 },
  { name: 'Gorgoroth',          km: 3031, tier: 2 },
  { name: 'Sammath Naur',       km: 3148, tier: 2 },
] satisfies Waypoint[]).sort((a, b) => a.km - b.km);

/** Fönstrets halva bredd i km per zoomnivå (0 = hela vägen). */
const ZOOM_HALF_SPAN_KM: Record<1 | 2, number> = { 1: 600, 2: 200 };

/** Minsta pixelavstånd mellan två etiketter i samma rad innan en tier-2-etikett släcks. */
export const MIN_LABEL_PX = 56;

/** Zoomknappen stegar Overview → Zoomed → Close-up → Overview. */
export const nextZoom = (current: ZoomLevel): ZoomLevel => ((current + 1) % 3) as ZoomLevel;

export const ZOOM_LABELS: Record<ZoomLevel, string> = { 0: 'Overview', 1: 'Zoomed', 2: 'Close-up' };

export interface Viewport {
  start: number;
  end: number;
}

export function getViewport(zoom: ZoomLevel, posKm: number): Viewport {
  if (zoom === 0) return { start: 0, end: JOURNEY_END_KM };
  const half = ZOOM_HALF_SPAN_KM[zoom];
  const center = Math.max(half, Math.min(JOURNEY_END_KM - half, posKm));
  return { start: center - half, end: center + half };
}

export function pctInView(km: number, start: number, end: number): number {
  return ((km - start) / (end - start)) * 100;
}

/** Sista passerade punkten (alltid minst The Shire). */
export function lastCheckpoint(totalKm: number): Waypoint {
  let result = ALL_WAYPOINTS[0];
  for (const waypoint of ALL_WAYPOINTS) {
    if (totalKm >= waypoint.km) result = waypoint;
    else break;
  }
  return result;
}

export function nextCheckpointInfo(totalKm: number): { name: string; km: number; remaining: number } | null {
  if (totalKm >= JOURNEY_END_KM) return null;
  const next = ALL_WAYPOINTS.find((waypoint) => waypoint.km > totalKm);
  if (!next) return null;
  return { name: next.name, km: next.km, remaining: Math.ceil(next.km - totalKm) };
}

/** Andel av vägen till Mount Doom i procent (0–100, klampad). */
export function journeyPercent(totalKm: number): number {
  return Math.max(0, Math.min(100, (totalKm / JOURNEY_END_KM) * 100));
}

export interface PlacedWaypoint extends Waypoint {
  /** Läge i fönstret, 0–100 %. */
  pct: number;
  /** Etiketterna alternerar mellan två rader så att grannar inte krockar. */
  row: 0 | 1;
  showLabel: boolean;
}

/**
 * Waypoints som syns i fönstret (utan start- och slutpunkt, som har egna etiketter under stapeln).
 * Overview visar bara tier 1; zoom visar alla. Tier 1 behåller alltid sin etikett, tier 2 släcks om den
 * ligger närmare än MIN_LABEL_PX från närmast visade etikett i samma rad.
 */
export function layoutWaypoints(zoom: ZoomLevel, viewport: Viewport, barWidthPx: number): PlacedWaypoint[] {
  const maxTier = zoom === 0 ? 1 : 2;
  const visible = ALL_WAYPOINTS.filter(
    (waypoint) =>
      waypoint.km > 0 &&
      waypoint.km < JOURNEY_END_KM &&
      waypoint.tier <= maxTier &&
      waypoint.km > viewport.start &&
      waypoint.km < viewport.end,
  );

  const lastShownPx: [number, number] = [-Infinity, -Infinity];
  return visible.map((waypoint, index) => {
    const row = (index % 2) as 0 | 1;
    const pct = pctInView(waypoint.km, viewport.start, viewport.end);
    const px = (pct / 100) * barWidthPx;
    const fits = px - lastShownPx[row] >= MIN_LABEL_PX;
    const showLabel = waypoint.tier === 1 || fits;
    if (showLabel) lastShownPx[row] = px;
    return { ...waypoint, pct, row, showLabel };
  });
}
