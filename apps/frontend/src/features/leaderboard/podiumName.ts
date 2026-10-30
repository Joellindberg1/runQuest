import { firstName } from '@/shared/utils/format';

/**
 * Det som står efter förnamnet ("Persson" ur "Karl Persson", "von Elling" ur "Nicklas von Elling"); ett ord långt namn ger tomt.
 * Härlett ur `firstName`, så delningen har en enda regel. Ligger här och inte i format.ts: den modulen ingår i landningens JS, och landningen ska inte växa.
 */
export function restOfName(name: string): string {
  return name.trim().slice(firstName(name).length).trim();
}

const PLACE_LABELS = ['1st place', '2nd place', '3rd place'];

/** Placeringens tillgängliga namn ("1st place"). Podiet har bara plats 1-3; ett högre tal får ändå en rimlig text. Egen funktion i stället för `ordinal` i events: en import därifrån flyttar den modulen in i landningens delade chunk. */
export function placeLabel(rank: number): string {
  return PLACE_LABELS[rank - 1] ?? `${rank}th place`;
}
