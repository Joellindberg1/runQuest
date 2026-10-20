// Tävlingspoäng: en algoritm för live-tabellen (GET /api/events) och avräkningen (settleCompetitionEvents), och en funktion för placering till XP som
// backend (utdelningen) och frontend (prischippet i tabellen) delar. Ren kod: ingen databas, ingen klocka, inga namn som visas för användaren.
import { compareXpStandings } from './rankPasses.js';

/** De kolumner ur `runs` som tävlingen läser. En km-tävling summerar `distance`, varje annat mått `total_elevation_gain`. */
export interface CompetitionRun {
  distance?: number | string | null;
  total_elevation_gain?: number | string | null;
}

/** Deltagare med de rundor som räknas i eventets dagar. `name` används bara som tie-break; rubriken i tabellen sätter anroparen. */
export interface CompetitionParticipant {
  id: string;
  name: string;
  runs: ReadonlyArray<CompetitionRun>;
}

export interface ScoredParticipant<T extends CompetitionParticipant = CompetitionParticipant> {
  participant: T;
  totalValue: number;
  /** 1-baserad och unik: ordningen är total, så ingen delar plats. */
  rank: number;
}

/**
 * Summerar varje deltagares rundor och rankar dem: totalen fallande, vid lika total samma ordning som all-time-tabellen (`compareXpStandings`:
 * namn utan hänsyn till skiftläge, sedan id). Resultatet beror därför inte på i vilken ordning deltagarna kommer in.
 * Anroparen väljer vilka rundor som räknas (eventets dagar i gruppens zon, löpband bort ur höjdmeter); här läggs bara mätvärdena ihop,
 * i inkommande ordning (flyttalssumman ska bli exakt densamma som när live och avräkning räknade var för sig).
 */
export function scoreCompetition<T extends CompetitionParticipant>(metric: string, participants: ReadonlyArray<T>): Array<ScoredParticipant<T>> {
  const isKm = metric === 'km';
  const scored = participants.map((participant) => ({
    participant,
    totalValue: participant.runs.reduce((sum: number, run) => sum + Number(isKm ? run.distance : run.total_elevation_gain ?? 0), 0),
  }));
  scored.sort((a, b) =>
    compareXpStandings(
      { id: a.participant.id, name: a.participant.name, xp: a.totalValue },
      { id: b.participant.id, name: b.participant.name, xp: b.totalValue },
    ));
  return scored.map((entry, index) => ({ ...entry, rank: index + 1 }));
}

/**
 * XP för en placering ur mallens priser i ordning (1:a, 2:a, 3:e). 0 under prispallen, för en placering som inte finns och för en plats
 * mallen saknar pris för. Mallarna lagrar absoluta belopp (seed 40/30/20 XP), ingen pool.
 */
export function prizeForRank(rank: number, prizes: ReadonlyArray<number>): number {
  if (!Number.isInteger(rank) || rank < 1) return 0;
  return prizes[rank - 1] ?? 0;
}
