// Vilka veckoetiketter som ritas under grafen, på Board och på profilen. Rymmer ytan en etikett per vecka (standardperioden på åtta veckor på en bred nog yta) får varje vecka en etikett. Annars, och för
// en längre period (upp till 104, "All time"), tunnas de ut: var n:e vecka räknat bakifrån, så den pågående veckan alltid har sin etikett, och den första veckan tas alltid med. Två etiketter ligger
// aldrig närmare varandra än n veckor, så de inte hamnar över varandra. x är linjärt i veckoindex, så glesheten i veckor är också glesheten i bredd. Punkterna och linjen ritas för alla veckor.
//
// Hur många etiketter en period får beror på hur bred ytan är (`maxLabels`, se `weekLabelBudget`): en smal graf på 320 px rymmer färre än en bred. Utan mätning gäller åtta.

/** Fler etiketter än så ritas aldrig. */
export const MAX_WEEK_LABELS = 8;

/**
 * Avståndet i px mellan två etiketters mitt som en graf räknar med: etikettens bredd (W35 i mono, mätt till 19,8 px) plus fyra px luft. Ett steg mellan etiketterna som ger mindre än så
 * lämnar dem över varandra.
 */
export const WEEK_LABEL_PITCH_PX = 24;

/** Minsta antal etiketter: första och pågående vecka. */
const MIN_WEEK_LABELS = 2;

/**
 * Hur många etiketter en period får på en yta som är `fieldWidth` px bred: en per etikettavstånd tvärs över ytan, plus den sista. Tills ytan är mätt (0) gäller åtta;
 * en yta som inte ryms med fler än två får just två (första och pågående).
 */
export function weekLabelBudget(fieldWidth: number): number {
  if (fieldWidth <= 0) return MAX_WEEK_LABELS;
  return Math.min(MAX_WEEK_LABELS, Math.max(MIN_WEEK_LABELS, Math.floor(fieldWidth / WEEK_LABEL_PITCH_PX) + 1));
}

/** Antal veckor mellan två etiketter: det minsta steg som ger högst `maxLabels` etiketter (`weekCount` veckor har `weekCount - 1` mellanrum). Ett steg på 1 är en etikett per vecka. */
export function weekTickStride(weekCount: number, maxLabels: number = MAX_WEEK_LABELS): number {
  return Math.max(1, Math.ceil((weekCount - 1) / (Math.max(MIN_WEEK_LABELS, maxLabels) - 1)));
}

/** Index i veckolistan, stigande, som får en etikett. Första och sista veckan ingår alltid. */
export function weekTickIndexes(weekCount: number, maxLabels: number = MAX_WEEK_LABELS): number[] {
  if (weekCount <= 0) return [];
  const stride = weekTickStride(weekCount, maxLabels);
  const lastIndex = weekCount - 1;
  const indexes: number[] = [];
  for (let index = lastIndex; index >= 0; index -= stride) indexes.push(index);
  // Stegen går jämnt upp mot noll bara ibland. Annars blir den sista etappen kortare än steget: den ersätts av första veckan, vars avstånd till nästa etikett då är minst ett steg.
  if (indexes.at(-1) !== 0) indexes[indexes.length - 1] = 0;
  return indexes.reverse();
}
