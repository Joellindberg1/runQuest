/**
 * Vad som aldrig lämnar processen till Sentry, och vilka händelser som inte skickas alls.
 * Rena funktioner utan beroende på SDK:t, så de går att testa med en fixtur (scrub.test.ts).
 *
 * Principen är två lager: vi bifogar inget känsligt (inga bodies, inga headers, inga namn), och det som ändå kommer med
 * (ett felmeddelande från databasen, en URL) rensas här på både nyckelnamn och värdemönster.
 */

import { ACTIVE_KEY_ENV, RETIRED_KEYS_ENV } from '../utils/secretBox.js';

export const FILTERED = '[Filtered]';

/** Förväntade klientfel: ett svar på fel förfrågan, inte ett fel i vår kod. */
export const CLIENT_STATUSES_NOT_REPORTED: readonly number[] = [401, 403, 404, 429];

export function isExpectedClientStatus(status: unknown): boolean {
  const n = typeof status === 'string' && status.trim() !== '' ? Number(status) : status;
  return typeof n === 'number' && CLIENT_STATUSES_NOT_REPORTED.includes(n);
}

// jsonwebtoken kastar dessa vid ogiltig eller utgången token; authenticateJWT svarar 401 på dem.
const JWT_ERROR_NAMES = new Set(['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError']);

/**
 * Är ett loggat fel ett JWT-fel, alltså ett 401 vi själva svarat på en klients ogiltiga token?
 * Bara det räknas som klientfel bland loggade fel. En status på ett loggat fel i övrigt (ett svar från Supabase eller Strava,
 * t.ex. 401 av fel nyckel eller 404 av en saknad migration) är vårt fel och ska till Sentry.
 *
 * Extra försvar, inte den primära spärren: authenticateJWT loggar sedan RUN-324 en ogiltig token som `logger.warn` med bara felnamnet
 * i texten (aldrig felobjektet), och en `warn` når aldrig Sentry. Därför matchar den här funktionen inget verkligt `logger.error`-anrop
 * i dag. Den ligger kvar ifall ett JWT-fel av misstag åter skickas som objekt till `logger.error`: då fortsätter det att filtreras bort.
 */
export function isClientAuthError(args: readonly unknown[]): boolean {
  return args.some((arg) => typeof (arg as { name?: unknown } | null)?.name === 'string' && JWT_ERROR_NAMES.has((arg as { name: string }).name));
}

/** HTTP-statusen ett fel som nått Express bär (error.status eller statusCode). Saknas den är det ett serverfel, 500. */
export function statusOfExpressError(error: unknown): number {
  const candidate = error as { status?: unknown; statusCode?: unknown } | null;
  for (const value of [candidate?.status, candidate?.statusCode]) {
    const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof n === 'number' && Number.isInteger(n)) return n;
  }
  return 500;
}

// Nyckelnamn vars värde aldrig skickas, oavsett vad det är.
const SENSITIVE_KEY = /authorization|cookie|pass(?:word|wd)|token|secret|e-?mail|api[-_]?key|jwt|bearer|^body$|request[-_]?body|ip[-_]?address/i;

// Headers som får följa med; allt annat (Authorization, Cookie, X-Forwarded-For, ...) tas bort.
const SAFE_HEADERS = new Set(['content-type', 'content-length', 'user-agent', 'accept', 'host', 'origin']);

// Breadcrumbs som bär konsolrader (namn, hemligheter) eller URL:er (Strava-id, filter med användaruppgifter).
const DROPPED_BREADCRUMB_CATEGORIES = new Set(['console', 'http', 'fetch', 'xhr']);

export function isDroppedBreadcrumb(breadcrumb: { category?: unknown; type?: unknown }): boolean {
  return (typeof breadcrumb.category === 'string' && DROPPED_BREADCRUMB_CATEGORIES.has(breadcrumb.category))
    || (typeof breadcrumb.type === 'string' && breadcrumb.type === 'http');
}

// Delar av en händelse som är SDK:ns egen metadata och aldrig bär användardata.
const UNTOUCHED_TOP_LEVEL = new Set(['sdk', 'modules', 'release', 'environment', 'event_id', 'platform', 'timestamp', 'level']);

const JWT_LIKE = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
// Lookbehind och inte \b av samma skäl som STRAVA_ID nedan: `strava_access_token=...` och `db_password=...` ska också maskas.
const KEY_VALUE = /(?<![A-Za-z0-9])((?:access|refresh|id)[_-]?token|client[_-]?secret|api[_-]?key|password|passwd|secret|token|authorization)(=|["']\s*:\s*)["']?([^\s"'&,;}]+)/gi;
// Strava-id (ADR 010 beslut 8.6): en andra försvarslinje om en rad som skrivits som `object_id=123` ändå skulle hamna i en händelse.
// Lookbehind och inte \b: `_` är ett ordtecken, så det fanns ingen ordgräns före `athlete_id` i `strava_athlete_id=123`.
const STRAVA_ID = /(?<![A-Za-z0-9])((?:object|owner|athlete)_id)(\s*[=:]\s*)\d+/gi;
const HEX_40 = /\b[0-9a-f]{40}\b/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

const MIN_SECRET_LENGTH = 8;

/**
 * Ett lagrat krypterat värde (ADR 013: `enc:v1:<kid>:<iv>:<ciphertext>:<tag>`), också avkortat eller utan alla fält. Ingen loggrad eller
 * händelse får bära ett sådant värde: det är chiffertext av en token och hör hemma i databasen, inte i Sentry eller i loggen.
 */
const ENCRYPTED_VALUE = /\benc:v1(?::[A-Za-z0-9_-]*)*/g;

/**
 * Hur en nyckelpost (`<kid>:<base64>`) ser ut inuti nyckelvariablerna: bara base64-delen är nyckelmaterial, men den kan stå ensam i en
 * text (utan kid), så den rensas för sig, förutom hela posten.
 */
function keyEntryParts(value: string): string[] {
  const parts: string[] = [];
  for (const raw of value.split(',')) {
    const entry = raw.trim();
    const separator = entry.indexOf(':');
    if (entry.length >= MIN_SECRET_LENGTH) parts.push(entry);
    if (separator >= 0 && entry.length - separator - 1 >= MIN_SECRET_LENGTH) parts.push(entry.slice(separator + 1));
  }
  return parts;
}

/**
 * Värdena på miljövariabler som ser ut som hemligheter (nyckel, token, lösenord, secret), utom DSN:en. De rensas ur alla strängar.
 * För krypteringsnycklarna (aktiv och pensionerade, ADR 013) rensas också varje post och dess base64-del för sig.
 */
export function secretsFromEnv(env: NodeJS.ProcessEnv): string[] {
  const secrets = new Set<string>(
    Object.entries(env)
      .filter(([name, value]) => /SECRET|KEY|TOKEN|PASSWORD/i.test(name) && !/DSN/i.test(name) && typeof value === 'string' && value.length >= MIN_SECRET_LENGTH)
      .map(([, value]) => value as string),
  );
  for (const name of [ACTIVE_KEY_ENV, RETIRED_KEYS_ENV]) {
    const value = env[name];
    if (typeof value === 'string') for (const part of keyEntryParts(value)) secrets.add(part);
  }
  return [...secrets];
}

function scrubString(value: string, secrets: readonly string[]): string {
  let out = value;
  for (const secret of secrets) out = out.split(secret).join(FILTERED);
  return out
    .replace(ENCRYPTED_VALUE, FILTERED)
    .replace(BEARER, `Bearer ${FILTERED}`)
    .replace(JWT_LIKE, FILTERED)
    .replace(KEY_VALUE, (_m, key: string, sep: string) => `${key}${sep}${FILTERED}`)
    .replace(STRAVA_ID, (_m, key: string, sep: string) => `${key}${sep}${FILTERED}`)
    .replace(HEX_40, FILTERED)
    .replace(EMAIL, FILTERED);
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const NUMERIC_SEGMENT = /(?<=\/)\d+(?=\/|$)/g;

/** Ett id i en sökväg eller ett routenamn (UUID eller ren siffra mellan snedstreck) blir `:id`. Mallar från koden (`/:id`) berörs inte. */
export function normalizeIds(path: string): string {
  return path.replace(UUID, ':id').replace(NUMERIC_SEGMENT, ':id');
}

const MAX_DEPTH = 12;

function walk(value: unknown, secrets: readonly string[], ancestors: object[], key?: string): unknown {
  if (key !== undefined && SENSITIVE_KEY.test(key)) return value === null || value === undefined ? value : FILTERED;
  if (typeof value === 'string') return scrubString(value, secrets);
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (ancestors.includes(value)) return '[Circular]';
  if (ancestors.length >= MAX_DEPTH) return '[MaxDepth]';
  const path = [...ancestors, value];
  if (Array.isArray(value)) return value.map((item) => walk(item, secrets, path));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = walk(v, secrets, path, k);
  return out;
}

type Json = Record<string, any>;

function responseStatusOf(event: Json): unknown {
  return event.contexts?.response?.status_code ?? event.tags?.['http.status_code'];
}

/**
 * `beforeSend`: returnerar en rensad kopia av händelsen, eller null när den inte ska skickas (förväntat klientfel).
 * Ändrar aldrig objektet den får.
 */
export function scrubSentryEvent<T extends object>(event: T, secrets: readonly string[] = []): T | null {
  const source = event as Json;
  if (isExpectedClientStatus(responseStatusOf(source))) return null;

  const out: Json = {};
  for (const [k, v] of Object.entries(source)) out[k] = UNTOUCHED_TOP_LEVEL.has(k) ? v : walk(v, secrets, [source], k);

  if (out.request && typeof out.request === 'object') {
    const request = out.request as Json;
    delete request.data;
    delete request.cookies;
    delete request.query_string;
    if (request.headers && typeof request.headers === 'object') {
      request.headers = Object.fromEntries(Object.entries(request.headers as Json).filter(([name]) => SAFE_HEADERS.has(name.toLowerCase())));
    }
  }

  // Namnet på transaktionen som en felhändelse hör till: routemallen (sentryRouteNaming), men en rå sökväg med ett id ska aldrig gå ut.
  if (typeof out.transaction === 'string') out.transaction = normalizeIds(out.transaction);

  // Adressen: värden och routemallen, aldrig den råa sökvägen. Ett id som inte är ett UUID eller ett tal (ett användarnamn) går inte
  // att känna igen i en sökväg, så sökvägen tas från routenamnet; saknas det blir det bara värden.
  if (out.request && typeof out.request === 'object' && typeof out.request.url === 'string') {
    const route = typeof out.transaction === 'string' ? /^[A-Z]+ (\/\S*)$/.exec(out.transaction)?.[1] : undefined;
    try {
      out.request.url = `${new URL(out.request.url).origin}${route ?? ''}`;
    } catch {
      delete out.request.url;
    }
  }

  if (out.user && typeof out.user === 'object') {
    const id = (source.user as Json).id;
    if (id === undefined || id === null) delete out.user;
    else out.user = { id: String(id) };
  }

  if (Array.isArray(out.breadcrumbs)) out.breadcrumbs = out.breadcrumbs.filter((b: Json) => !isDroppedBreadcrumb(b));

  for (const exception of out.exception?.values ?? []) {
    for (const frame of exception?.stacktrace?.frames ?? []) delete frame.vars;
  }

  return out as T;
}

/** Normaliserar ett loggmeddelande till en grupperingsnyckel: id:n och tal varierar mellan anrop men felet är detsamma. */
export function fingerprintOf(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/\d+/g, '<n>')
    .slice(0, 300);
}
