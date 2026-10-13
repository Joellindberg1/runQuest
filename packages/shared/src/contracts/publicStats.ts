// API-kontrakt för landningens publika summering: GET /api/public/stats (ingen JWT). Endast typer och en konstant.
import type { ApiSuccess } from './common.js';

/** De tre heltalen landningen visar: antal löpare, avgjorda utmaningar och totala km. Aldrig rader eller persondata. */
export interface PublicStatsData {
  runners: number;
  challenges: number;
  km: number;
}

/** Svar för GET /api/public/stats. */
export type PublicStatsApiResponse = ApiSuccess<PublicStatsData>;

/** Hur länge ett svar är färskt (ms). Speglar backendens PUBLIC_STATS_TTL_MS (services/publicStats.ts); landningen hämtar en gång per sidvisning. */
export const PUBLIC_STATS_MAX_AGE_MS = 300_000;
