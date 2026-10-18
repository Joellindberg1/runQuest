// E2E-vakten: Playwright-sviten (apps/e2e) får bara köras mot staging eller localhost, aldrig mot produktionen.
//
// Sviten loggar in, loggar rundor och raderar dem igen. Mot prod vore det verkliga användare och verkliga totaler. Därför finns tre lager:
//  1. Adresserna (E2E_BASE_URL, E2E_API_URL) måste vara EXAKT stagingtjänsterna (en tillåtelselista, inte en spärrlista över prod) eller localhost.
//     Allt annat, även en adress som bara liknar staging eller localhost, fäller starten innan en enda förfrågan gjorts. Konfigurationen anropar
//     `resolveE2eTargets` vid inläsningen, så varken `playwright test` eller `playwright test --list` startar mot fel miljö.
//  2. Före första testet frågar `assertStagingFrontendServes` efter robots.txt: ett stagingbygge svarar `Disallow: /` (apps/frontend/stagingGuard.ts), ett
//     prodbygge släpper in sökrobotar. Det fångar en stagingadress som i själva verket serverar ett prodbygge.
//  3. Under körningen avbryter webbläsarkontexten varje förfrågan till runquest.dev och till varje Railway-adress utom de två
//     stagingtjänsterna (`isBlockedRequestUrl`). Pekar ett stagingbygge av misstag på prodens API når alltså ingen skrivning fram.
//
// Inga beroenden utöver lasttestets vakt (en ren modul utan beroenden): filen läses av node:test och av Playwright-konfigurationen. Alla funktioner är rena (nätverket injiceras).

import { STAGING_BACKEND_URL } from './loadtest/guard.mjs';

export const E2E_STAGING_FRONTEND_HOST = 'runquest-frontend-staging-staging.up.railway.app';
// Backendens adress delas med lasttestets vakt (en källa); frontendens står bara här.
export const E2E_STAGING_BACKEND_HOST = new URL(STAGING_BACKEND_URL).hostname;

const STAGING_HOST = { frontend: E2E_STAGING_FRONTEND_HOST, backend: E2E_STAGING_BACKEND_HOST };
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);
const PROD_DOMAIN = 'runquest.dev';
const RAILWAY_DOMAIN = 'up.railway.app';
const FETCH_TIMEOUT_MS = 10_000;

export class E2eTargetError extends Error {
  constructor(message) {
    super(message);
    this.name = 'E2eTargetError';
  }
}

/** Värdet utan inloggningsuppgifter, sökväg eller query: det enda som får hamna i ett felmeddelande. */
function describeHost(raw) {
  try {
    return new URL(raw).host || '(no host)';
  } catch {
    return '(not an address)';
  }
}

function refuse(role, raw, why) {
  throw new E2eTargetError(`E2E refuses to run: the ${role} address (${describeHost(raw)}) ${why}. The suite only runs against staging or localhost, never production.`);
}

/**
 * Kontrollerar en adress och returnerar dess origin (utan avslutande snedstreck). `role` är 'frontend' eller 'backend'.
 * Tillåtet: stagingtjänstens exakta värdnamn över https utan port, inloggning, sökväg, query eller fragment, eller localhost/127.0.0.1 över http.
 */
export function assertStagingTarget(raw, role) {
  if (typeof raw !== 'string' || raw.trim() === '') refuse(role, '', 'is missing');
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return refuse(role, raw, 'is not a valid address');
  }
  if (url.username !== '' || url.password !== '') refuse(role, raw, 'contains credentials');
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') refuse(role, raw, 'must be an origin only, without path, query or fragment');

  if (LOCAL_HOSTS.has(url.hostname)) {
    if (url.protocol !== 'http:') refuse(role, raw, 'must use http for localhost');
    return url.origin;
  }
  if (url.protocol !== 'https:') refuse(role, raw, 'must use https');
  if (url.port !== '') refuse(role, raw, 'must not name a port');
  if (url.hostname !== STAGING_HOST[role]) refuse(role, raw, `is not the ${role} staging service`);
  return url.origin;
}

/** Läser E2E_BASE_URL och E2E_API_URL, kontrollerar båda och säger om bägge är lokala. Kastar E2eTargetError vid första felet. */
export function resolveE2eTargets(env) {
  const need = (name) => {
    const value = env[name];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new E2eTargetError(`E2E refuses to run: ${name} is not set. Set it to the staging address (see docs/e2e.md).`);
    }
    return value;
  };
  const named = (name, role) => {
    try {
      return assertStagingTarget(need(name), role);
    } catch (error) {
      if (error instanceof E2eTargetError && !error.message.includes(name)) {
        throw new E2eTargetError(`${error.message} (variable ${name})`);
      }
      throw error;
    }
  };
  const baseUrl = named('E2E_BASE_URL', 'frontend');
  const apiUrl = named('E2E_API_URL', 'backend');
  const isLocal = [baseUrl, apiUrl].every((origin) => LOCAL_HOSTS.has(new URL(origin).hostname));
  return { baseUrl, apiUrl, isLocal };
}

/**
 * Sant för en adress som sviten aldrig får nå: runquest.dev med subdomäner och varje Railway-adress (*.up.railway.app) utom de två stagingtjänsterna.
 * Det är en tillåtelselista för Railway: prodtjänsternas värdnamn (runquest-production-…, spectacular-rebirth-production-… m.fl.) går inte att gissa,
 * och en ny prodvärd är blockerad redan innan någon hunnit lista den. Oläsbar adress ger false (den kan ändå inte skickas).
 */
export function isBlockedRequestUrl(raw) {
  let host;
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === PROD_DOMAIN || host.endsWith(`.${PROD_DOMAIN}`)) return true;
  const isRailway = host === RAILWAY_DOMAIN || host.endsWith(`.${RAILWAY_DOMAIN}`);
  return isRailway && host !== E2E_STAGING_FRONTEND_HOST && host !== E2E_STAGING_BACKEND_HOST;
}

/**
 * Bevisar att en icke-lokal frontend är ett stagingbygge: robots.txt ska blockera alla robotar (`User-agent: *` följt av `Disallow: /`).
 * Lokala adresser hoppas över (utvecklingsservern har inget stagingbygge). `fetchImpl` injiceras så att inget test når nätverket.
 */
export async function assertStagingFrontendServes(baseUrl, fetchImpl = fetch) {
  if (LOCAL_HOSTS.has(new URL(baseUrl).hostname)) return;
  let body;
  try {
    const response = await fetchImpl(`${baseUrl}/robots.txt`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`status ${response.status}`);
    body = await response.text();
  } catch {
    throw new E2eTargetError(`E2E refuses to run: could not read robots.txt from ${describeHost(baseUrl)}, so it cannot be shown to be a staging build.`);
  }
  const blocksEveryone = /^User-agent:\s*\*\s*$/im.test(body) && /^Disallow:\s*\/\s*$/m.test(body);
  if (!blocksEveryone) {
    throw new E2eTargetError(`E2E refuses to run: ${describeHost(baseUrl)} serves a robots.txt that lets crawlers in, which is what a production build does. A staging build blocks everything.`);
  }
}
