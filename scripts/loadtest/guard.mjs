// Vakten på lasttestets bas-URL. Lasttestet får bara träffa stagingbackenden eller en lokal server; allt annat vägras innan ett
// enda anrop görs. Vakten är en tillåtelselista (inte en förbudslista): en ny prod-värd är nekad redan innan någon hunnit lista den.
// Värden tolkas med URL-parsern, aldrig med textsökning, så `localhost.evil.example`, `evil.example@127.0.0.1` och
// `staging-värden.evil.example` inte släpps igenom.

export const STAGING_BACKEND_URL = 'https://runquest-backend-staging-staging.up.railway.app';

const STAGING_HOST = new URL(STAGING_BACKEND_URL).hostname;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export class BaseUrlRefused extends Error {
  constructor(reason) {
    super(`Vägrar köra lasttestet: ${reason}. Tillåtet är bara ${STAGING_BACKEND_URL} samt localhost/127.0.0.1.`);
    this.name = 'BaseUrlRefused';
  }
}

/**
 * Normaliserar och prövar bas-URL:en. Returnerar origin (`https://värd[:port]`, utan avslutande snedstreck) eller kastar BaseUrlRefused.
 * Felmeddelandena citerar aldrig indata (den kan bära inloggningsuppgifter i URL:en).
 */
export function resolveBaseUrl(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') throw new BaseUrlRefused('ingen bas-URL angiven');
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new BaseUrlRefused('bas-URL:en går inte att tolka');
  }
  if (url.username !== '' || url.password !== '') throw new BaseUrlRefused('bas-URL:en får inte innehålla användarnamn eller lösenord');
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') throw new BaseUrlRefused('bas-URL:en får inte ha sökväg, query eller fragment');

  if (url.hostname === STAGING_HOST) {
    if (url.protocol !== 'https:' || url.port !== '') throw new BaseUrlRefused('stagingvärden nås bara över https på standardporten');
    return url.origin;
  }
  if (LOCAL_HOSTS.has(url.hostname)) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new BaseUrlRefused('lokala servrar nås bara över http eller https');
    return url.origin;
  }
  throw new BaseUrlRefused(`värden ${url.hostname} är inte stagingbackenden eller en lokal server`);
}

/** Kastar om `absoluteUrl` inte ligger på samma origin som den prövade bas-URL:en (skydd mot att en sökväg eller en omdirigering byter värd). */
export function assertWithinBase(baseOrigin, absoluteUrl) {
  if (new URL(absoluteUrl).origin !== baseOrigin) throw new BaseUrlRefused('ett anrop skulle lämna den prövade värden');
}
