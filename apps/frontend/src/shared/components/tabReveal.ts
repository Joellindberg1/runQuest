export interface HorizontalSpan {
  left: number;
  right: number;
}

/**
 * Hur långt en flikrad som scrollar i sidled ska flyttas (scrollLeft += resultat) för att den valda fliken ska ligga helt i bild. Negativt = åt vänster, 0 = fliken syns redan.
 * Rymmer inte raden fliken ligger dess vänsterkant mot radens. Webbläsarens egen fokusscroll flyttar inget när fliken är delvis synlig, så en halvt skymd flik blev kvar halv.
 */
export function revealDelta(row: HorizontalSpan, tab: HorizontalSpan): number {
  if (tab.left < row.left || tab.right - tab.left > row.right - row.left) return tab.left - row.left;
  if (tab.right > row.right) return tab.right - row.right;
  return 0;
}
