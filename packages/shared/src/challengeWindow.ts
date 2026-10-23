import { addDays, stockholmWallClockToInstant } from './calendar.js';

export interface ChallengeWindow {
  /** Duellens sista kalenderdag (YYYY-MM-DD), inklusive: dagens runda räknas, dagen efter gör det inte. */
  endDate: string;
  /** När duellen avgörs: 03:00 Stockholm dagen efter slutdagen. */
  determineAt: Date;
}

/**
 * Slutet på en duell som startar på kalenderdagen `startDate` och varar `durationDays` dagar. DEN enda definitionen av längden
 * (ägarbeslut 2026-10-19): en duell på N dagar räknar exakt N kalenderdagar, från startdagens 00:00 till och med dag N, alltså
 * slutdatum = startdag + N − 1. En 5-dagarsduell som startar på en måndag slutar fredag 24:00. Gäller bara nya dueller; pågående
 * behåller sitt lagrade `end_date`. `startDate` kommer ur `groupNextMidnight` (accept) eller samma funktion (legendary-autostart).
 *
 * RangeError om längden inte är ett heltal på minst 1 — en tyst fel dag skulle avgöra duellen på fel rundor.
 */
export function challengeWindow(startDate: string, durationDays: number): ChallengeWindow {
  if (!Number.isInteger(durationDays) || durationDays < 1) {
    throw new RangeError(`Ogiltig duellängd: ${durationDays}`);
  }
  return {
    endDate: addDays(startDate, durationDays - 1),
    determineAt: stockholmWallClockToInstant(addDays(startDate, durationDays), 3),
  };
}
