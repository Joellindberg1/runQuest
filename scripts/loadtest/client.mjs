// HTTP-klienten för lasttestet. Tre skydd som gäller varje anrop, inte bara scenarierna:
//  1. Bas-URL:en prövas av vakten (guard.mjs) när klienten byggs, och varje anrops slutliga URL måste ligga på samma origin.
//  2. Bara de fem rutterna nedan får anropas (tillåtelselista på metod + exakt sökväg). Strava, admin och allt annat nekas innan
//     ett anrop görs, så ett scenario kan aldrig råka väcka Strava-koden.
//  3. Omdirigeringar följs inte (`redirect: 'manual'`): ett 3xx-svar räknas som misslyckat i stället för att föra anropet vidare till en annan värd.
// Klienten loggar aldrig token eller kropp; proverna den sparar bär bara scenario, status, utfall och tid.
import { performance } from 'node:perf_hooks';
import { assertWithinBase, resolveBaseUrl } from './guard.mjs';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

export const ALLOWED_ROUTES = [
  { method: 'POST', pattern: /^\/api\/auth\/login$/ },
  { method: 'GET', pattern: /^\/api\/leaderboard\/week$/ },
  { method: 'GET', pattern: /^\/api\/news$/ },
  { method: 'POST', pattern: /^\/api\/runs$/ },
  { method: 'DELETE', pattern: new RegExp(`^/api/runs/${UUID}$`, 'i') },
];

export class RouteNotAllowed extends Error {
  constructor(method, pathname) {
    super(`Lasttestet får inte anropa ${method} ${pathname}`);
    this.name = 'RouteNotAllowed';
  }
}

/** Sökvägen delas i pathname och query på rå text, så att `..`, `%2e` och `//` inte hinner normaliseras bort före prövningen. */
function assertAllowed(method, path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) throw new RouteNotAllowed(method, String(path).split('?')[0]);
  const pathname = path.split('?')[0];
  const allowed = ALLOWED_ROUTES.some((route) => route.method === method && route.pattern.test(pathname));
  if (!allowed) throw new RouteNotAllowed(method, pathname);
}

function outcomeOf(status) {
  if (status === null) return 'failed';
  if (status >= 200 && status < 300) return 'ok';
  if (status === 429) return 'rate_limited';
  return 'failed';
}

export function createClient({ baseUrl, fetchImpl = fetch, timeoutMs = 15_000, now = () => performance.now() }) {
  const base = resolveBaseUrl(baseUrl);
  const samples = [];

  async function request({ scenario, method, path, token, body, headers = {} }) {
    assertAllowed(method, path);
    const url = new URL(path, base).toString();
    assertWithinBase(base, url);

    const init = {
      method,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Accept: 'application/json',
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` }),
        ...headers,
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    };

    const started = now();
    let status = null;
    let json = null;
    try {
      const response = await fetchImpl(url, init);
      status = response.status;
      json = await response.json().catch(() => null);
    } catch {
      status = null;
    }
    const ms = now() - started;
    const outcome = outcomeOf(status);
    samples.push({ scenario, status, outcome, ms });
    return { status, outcome, ms, json };
  }

  return { request, samples };
}
