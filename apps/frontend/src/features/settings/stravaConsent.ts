import { STRAVA_CONSENT_VERSION } from '@runquest/shared';

/**
 * Strava-kopplingen är en OAuth-omdirigering: rutan kryssas FÖRE den och `connectStrava(code)` körs EFTER den. Versionen användaren godkände
 * bärs mellan de två stegen i sessionStorage (appen använder inget OAuth-`state`, och `state` skulle behöva följa med genom
 * public/strava-popup.html). Skickas aldrig konstanten rakt av: saknas värdet skickas ingen version och servern svarar 400 "Consent required".
 */
export const STRAVA_CONSENT_STORAGE_KEY = 'rq.strava.consent';

/** Sparar den version som visades när användaren bockade i rutan. Blockerad lagring ger ingen version vid callbacken, aldrig ett undantag. */
export function rememberStravaConsent(): void {
  try {
    sessionStorage.setItem(STRAVA_CONSENT_STORAGE_KEY, STRAVA_CONSENT_VERSION);
  } catch {
    // Blockerad lagring: callbacken skickar ingen version och användaren får "Consent required".
  }
}

/** Läser den sparade versionen och tar bort den, så ett samtycke gäller en koppling. `undefined` när inget finns eller lagringen är blockerad. */
export function takeStravaConsent(): string | undefined {
  try {
    const version = sessionStorage.getItem(STRAVA_CONSENT_STORAGE_KEY);
    sessionStorage.removeItem(STRAVA_CONSENT_STORAGE_KEY);
    return version || undefined;
  } catch {
    return undefined;
  }
}
