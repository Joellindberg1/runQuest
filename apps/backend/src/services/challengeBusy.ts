/**
 * Regeln för "upptagen": en löpare med en väntande eller aktiv utmaning, som utmanare eller som mottagare, kan varken
 * skicka eller ta emot en ny. POST /send avvisar på den och group-stats visar den, så send-arket aldrig erbjuder någon
 * som servern ändå avvisar.
 */

export const BUSY_CHALLENGE_STATUSES = ['pending', 'active'];

export interface ChallengeParties {
  challenger_id: string;
  opponent_id: string;
}

/** Är löparen part i någon av utmaningarna? Anroparen väljer vilka statusar raderna hämtats med (BUSY_CHALLENGE_STATUSES). */
export function isRunnerBusy(runnerId: string, challenges: readonly ChallengeParties[] | null | undefined): boolean {
  return (challenges ?? []).some((c) => c.challenger_id === runnerId || c.opponent_id === runnerId);
}
