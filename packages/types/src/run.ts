// Klientens namn för rundor, användare och utmaningar. Formerna är serverns svar och bor i @runquest/shared (contracts/); här finns bara aliasen.
import type { ChallengeRow, RunRow, UserWithRuns } from '@runquest/shared';

/** En rad ur `runs` som servern skickar (RunRow i @runquest/shared). */
export type Run = RunRow;

/** En gruppmedlem med sina rundor, som GET /auth/users-with-runs skickar den (UserWithRuns i @runquest/shared). */
export type User = UserWithRuns;

export interface RunData {
  date: string;
  distance: number;
}

/** En rad ur `challenges` som servern skickar (ChallengeRow i @runquest/shared). */
export type Challenge = ChallengeRow;
