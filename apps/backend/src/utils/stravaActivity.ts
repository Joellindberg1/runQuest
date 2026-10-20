import { STRAVA_TREADMILL_FLAG } from '@runquest/shared';

/**
 * Is this Strava activity a treadmill run? The one place that reads the flag (STRAVA_TREADMILL_FLAG in shared/rules.ts): the import,
 * event qualification and the treadmill backfill all ask here. Only a real `true` counts; a missing field or the string 'true' does not.
 * Lives in backend rather than shared so the single-source tests can swap the flag name.
 */
export function isTreadmillActivity(activity: Record<string, unknown> | null | undefined): boolean {
  return activity?.[STRAVA_TREADMILL_FLAG] === true;
}

/**
 * Rundans dag: atletens lokala datum ur `start_date_local` (Strava skriver väggklockan hos löparen med ett falskt Z). Den räknas
 * INTE om till gruppens tidszon: en runda som startar 00:30 lokal tid är dagens, vilken tidszon gruppen än har. Den enda läsaren av
 * fältet för datum; import, webhook, polling och nattens avstämning går alla hit.
 */
export function stravaRunDay(activity: { start_date_local: string }): string {
  return activity.start_date_local.split('T')[0];
}

/**
 * Som `stravaRunDay` för ett värde som kan vara trasigt (en lista, ett halvt svar): datumet om värdet börjar med YYYY-MM-DD, annars
 * null. Ett värde utan läsbart datum är "kan inte jämföras", aldrig ett påhittat datum.
 */
export function stravaDayIfValid(startDateLocal: unknown): string | null {
  return typeof startDateLocal === 'string' && /^\d{4}-\d{2}-\d{2}/.test(startDateLocal) ? startDateLocal.slice(0, 10) : null;
}

/** Stravas meter som kilometer, som kolumnen och reglerna räknar. Den enda omräkningen av Stravas distans. */
export function stravaKm(distanceMetres: number): number {
  return distanceMetres / 1000;
}
