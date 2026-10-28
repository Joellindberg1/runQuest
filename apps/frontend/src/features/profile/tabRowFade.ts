import type { HorizontalSpan } from '@/shared/components/tabReveal';

// Flikraden på profilen scrollar i sidled när fem flikar inte ryms (profile.css). Kantfaden visar åt vilket håll det finns mer, och den valda
// fliken hålls utanför fadens zon så att dess text aldrig tonas ut. Webbläsaren ger måtten; här bor räkneregeln.

/** Subpixelmarginal: `scrollLeft` är ett decimaltal på skärmar med skalning. */
const EDGE_TOLERANCE_PX = 1;

export interface ScrollMetrics {
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
}

export interface ScrollEdges {
  /** Mer innehåll åt vänster (raden är inte scrollad till början). */
  start: boolean;
  /** Mer innehåll åt höger (raden är inte scrollad till slutet). */
  end: boolean;
}

export function scrollEdges({ scrollLeft, clientWidth, scrollWidth }: ScrollMetrics): ScrollEdges {
  return {
    start: scrollLeft > EDGE_TOLERANCE_PX,
    end: scrollLeft + clientWidth < scrollWidth - EDGE_TOLERANCE_PX,
  };
}

/**
 * Hur mycket raden ska flyttas till (scrollLeft += resultat) för att en flik som redan ligger i bild också ligger utanför fadens zon, `clearance` px
 * in från kanten. Bara en fade som ritas räknas: första och sista fliken får ligga mot kanten. Negativt = åt vänster, 0 = inget att flytta.
 */
export function fadeClearance(row: HorizontalSpan, tab: HorizontalSpan, clearance: number, edges: ScrollEdges): number {
  if (!(clearance > 0)) return 0;
  const startGap = tab.left - row.left;
  if (edges.start && startGap < clearance) return startGap - clearance;
  const endGap = row.right - tab.right;
  if (edges.end && endGap < clearance) return clearance - endGap;
  return 0;
}
