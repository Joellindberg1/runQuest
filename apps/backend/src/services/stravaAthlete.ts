// Strava athlete-id ↔ RunQuest-användare (ADR 010 beslut 4). En webhook-händelse bär bara Stravas owner_id.
import { getSupabaseClient } from '../config/database.js';
import { errorWithCode } from '../utils/errorCode.js';

/** Ett Strava athlete-id är ett positivt heltal. Allt annat är inget id (och null-raderna i tabellen får aldrig matcha). */
export function isValidAthleteId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/**
 * Användaren (user_id) som äger Strava-kontot `athleteId`, eller null om ingen gör det.
 * Ett databasfel KASTAS i stället för att ge null: ett fel får aldrig läsas som "okänd ägare", eftersom en händelse då
 * skulle släppas (och en radering missas) i stället för att försökas igen.
 */
export async function findUserByAthleteId(athleteId: number): Promise<string | null> {
  if (!isValidAthleteId(athleteId)) return null;

  const { data, error } = await getSupabaseClient()
    .from('strava_tokens')
    .select('user_id')
    .eq('strava_athlete_id', athleteId)
    .maybeSingle();

  if (error) throw errorWithCode('Failed to read the owner of a Strava athlete id', error);
  return data?.user_id ?? null;
}
