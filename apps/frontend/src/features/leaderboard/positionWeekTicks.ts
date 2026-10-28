// Vilka veckoetiketter som ritas under grafen. En period på upp till åtta veckor (standardperioden) får en etikett per vecka; en längre period (upp till 26)
// tunnas ut med lika steg bakifrån, så den pågående veckan alltid har sin etikett och inga två etiketter hamnar över varandra. Punkterna ritas för alla veckor.

/** Fler etiketter än så ryms inte i bredd utan att överlappa på en 320 px bred skärm. */
export const MAX_WEEK_LABELS = 8;

/** Index i veckolistan, stigande, som får en etikett. */
export function weekTickIndexes(weekCount: number): number[] {
  if (weekCount <= 0) return [];
  const stride = Math.ceil(weekCount / MAX_WEEK_LABELS);
  const indexes: number[] = [];
  for (let index = weekCount - 1; index >= 0; index -= stride) indexes.push(index);
  return indexes.reverse();
}
