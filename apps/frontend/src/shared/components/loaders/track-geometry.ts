/**
 * Geometri för stadion-ovalen (docs/design/claude-design/RunQuest Loaders.dc.html, track()).
 * Rena funktioner så lane-trappan och banorna kan testas utan DOM.
 */

/** Ovalens rityta: viewBox 0 0 100 62, höjd = bredd * 0.62. */
export const TRACK_VIEWBOX_WIDTH = 100;
export const TRACK_ASPECT = 0.62;

/** Banornas inåtförskjutning (yttre bana först). */
export const LANE_INSETS = [0, 7, 14] as const;
/** Banlinjens opacitet per bana. */
export const LANE_STROKE_OPACITY = [0.32, 0.22, 0.15] as const;
/** Löpar-prickens opacitet per bana. */
export const RUNNER_OPACITY = [1, 0.6, 0.38] as const;
/** Varje bana är långsammare än den innanför: varvtid = speed * faktor. */
export const LANE_SPEED_FACTORS = [1, 1.35, 1.75] as const;

export const DEFAULT_SPEED_SECONDS = 2.4;
export const DEFAULT_TILT_DEGREES = -16;

/** Lane-trappan: <34 px → 1 bana, <64 px → 2, annars 3. En löpare per bana. */
export function trackLaneCount(size: number): 1 | 2 | 3 {
  if (size < 34) return 1;
  if (size < 64) return 2;
  return 3;
}

export function trackHeight(size: number): number {
  return size * TRACK_ASPECT;
}

export function runnerRadius(size: number): number {
  return Math.max(2, size * 0.055);
}

export function laneStrokeWidth(size: number): number {
  return size < 34 ? 1.4 : 2;
}

/**
 * SVG-path för en bana. `scale` = 1 ger viewBox-koordinater (banlinjen),
 * `scale` = size/100 ger pixlar (CSS offset-path som löparen följer).
 */
export function ovalPath(inset: number, scale = 1): string {
  const x1 = (26 + inset * 0.4) * scale;
  const x2 = (74 - inset * 0.4) * scale;
  const r = (24 - inset) * scale;
  const top = (31 - (24 - inset)) * scale;
  const bottom = (31 + (24 - inset)) * scale;
  return `M${x1} ${top} H${x2} A${r} ${r} 0 0 1 ${x2} ${bottom} H${x1} A${r} ${r} 0 0 1 ${x1} ${top} Z`;
}
