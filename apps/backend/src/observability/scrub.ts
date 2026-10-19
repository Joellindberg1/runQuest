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

// Alla mönster nedan körs synkront i `beforeSend` på text vi inte styr. Därför har varje kvantifierare en övre gräns (`{0,8}` i stället för `*`
// där ett mellanrum kan upprepas, `[^\]]{0,200}` i stället för `[^\]]*`), och inget mönster nästlar eller överlappar kvantifierare. Strängarna kapas
// dessutom till MAX_SCRUBBED_STRING_LENGTH innan något mönster körs, som skydd för mönster som läggs till senare.
const JWT_LIKE = /\beyJ[A-Za-z0-9_-]{5,256}\.[A-Za-z0-9_-]{5,2048}\.[A-Za-z0-9_-]{0,1024}/g;
const BEARER = /\bBearer\s{1,8}[A-Za-z0-9._~+/=-]+/gi;
// Lookbehind och inte \b av samma skäl som STRAVA_ID nedan: `strava_access_token=...` och `db_password=...` ska också maskas.
const KEY_VALUE = /(?<![A-Za-z0-9])((?:access|refresh|id)[_-]?token|client[_-]?secret|api[_-]?key|password|passwd|secret|token|authorization)(=|["']\s{0,8}:\s{0,8})["']?([^\s"'&,;}]+)/gi;
// Strava-id (ADR 010 beslut 8.6): en andra försvarslinje om en rad som skrivits som `object_id=123` ändå skulle hamna i en händelse.
// Lookbehind och inte \b: `_` är ett ordtecken, så det fanns ingen ordgräns före `athlete_id` i `strava_athlete_id=123`. Också med citattecken före
// separatorn (`"object_id":123` i en JSON-text) och i camelCase (`objectId=123`, `stravaActivityId: 123`). Slutvillkoret hindrar att början av ett UUID
// (`owner_id=7c9e…`) tas för ett nummer. En grupps `activity_id` utan `strava`-prefix hör till STRAVA_WORD_ID, som kräver minst sju siffror.
const STRAVA_ID = /(?<![A-Za-z0-9])((?:strava[_-]?)?(?:object|owner|athlete)[_-]?id|strava[_-]?activity[_-]?id)(["']?\s{0,8}[=:]\s{0,8}["']?)\d+(?![A-Za-z0-9-])/gi;
// Strava-aktivitets- och atletnummer i löpande text (`activity 12345678901 not found`, `activity "1…"`, `activity (1…)`, `activities [1…, 2…]`, `activity_id=1…`,
// `activityId: 1…`). Minst sju siffror: Stravas nummer är nio till elva siffror, och våra egna löpnummer (t.ex. nyhetsraders activity_id) ska inte maskas.
const STRAVA_WORD_ID = /(?<![A-Za-z0-9])(activit(?:y|ies)(?:[_-]?id)?|athletes?(?:[_-]?id)?)(["']?(?:\s{1,8}id\b)?\s{0,8}(?:[=:]\s{0,8})?[#"'(\[]{0,2})(\d{7,}(?:["')\]]?\s{0,4}(?:,|and|&)\s{0,4}[#"'(\[]?\d{7,})*)/gi;
// Numret i en Strava-URL eller ett routeanrop (`GET /activities/123`). Blir `:id` som routemönstren, så transaktionsnamnen fortsätter att stämma.
const STRAVA_PATH_ID = /(?<=\/(?:activities|athletes)\/)\d+/g;
// Postgres-detaljen `Key (strava_activity_id)=(12345678901) already exists.` (också med flera kolumner): värdena maskas om någon kolumn är ett Strava-nummer.
const PG_KEY_DETAIL = /\bKey \(([^()]{0,200})\)=\(([^()]{0,300})\)/g;
const STRAVA_COLUMN = /(?:^|[,\s])(?:strava[_-]?(?:activity|athlete)[_-]?id|athlete[_-]?id)(?:$|[,\s])/i;
// PostgREST-filter i en URL: `strava_activity_id=eq.123`, `strava_activity_id.eq.123`, `strava_athlete_id.in.(1,2)`.
const POSTGREST_FILTER = /(?<![A-Za-z0-9])((?:strava[_-]?(?:activity|athlete)[_-]?id|(?:object|athlete)[_-]?id)[.=](?:eq|neq|gt|gte|lt|lte|in)\.)(?:\d+|\([\d,\s]{0,300}\))/gi;
// Koordinater i text: `lat 57.7, lng 11.9`, `"longitude":11.9`, `start_latlng=[57.7, 11.9]`, `startLatLng: [..]` och ett löst par `57.70887, 11.97456`.
const COORDINATE_KEYWORD = /(?<![A-Za-z0-9])(lat(?:itude)?|lng|lon(?:gitude)?)(["']?\s{0,8}(?:[=:]\s{0,8})?["']?)-?\d{1,3}\.\d+/gi;
const LATLNG_PAIR = /(?<![A-Za-z0-9])((?:start[_-]?|end[_-]?)?lat[_-]?lng)(["']?\s{0,8}[=:]\s{0,8})\[[^\]]{0,200}\]/gi;
const COORDINATE_PAIR = /(?<![\d.])(-?\d{1,3}\.\d{4,})\s{0,4},\s{0,4}(-?\d{1,3}\.\d{4,})(?![\d.])/g;
// Fält som bär ett Strava-nummer eller en koordinat. `owner_id` på en grupp är ett UUID (en sträng med bokstäver) och rensas därför bara när värdet är siffror.
// `activity`, `athlete` och `activity_id` utan `strava`-prefix kräver minst sju siffror (nyhetsraders activity_id är ett litet löpnummer).
const STRAVA_NUMBER_KEY = /^(?:(?:strava[_-]?)?(?:object|owner|athlete)[_-]?id|strava[_-]?activity[_-]?id)$/i;
const STRAVA_LONG_NUMBER_KEY = /^(?:activity|athlete)(?:[_-]?id)?$/i;
const COORDINATE_KEY = /^(?:lat|lng|lon|latitude|longitude|(?:start[_-]?|end[_-]?)?lat[_-]?lng)$/i;
const HEX_40 = /\b[0-9a-f]{40}\b/gi;
// Lokaldelen och domänen har den längd RFC 5321 tillåter; utan gränserna var mönstret kvadratiskt på en lång sträng utan snabel-a.
const EMAIL = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,24}/g;

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

/** Ett löst decimalpar är en koordinat bara om det ryms på jorden; annars är det två tal som råkar stå intill varandra. */
function isCoordinate(lat: string, lng: string): boolean {
  return Math.abs(Number(lat)) <= 90 && Math.abs(Number(lng)) <= 180;
}

function digitsOf(value: unknown): string | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return String(value);
  return typeof value === 'string' && /^\d{1,30}$/.test(value) ? value : null;
}

function isStravaNumberField(key: string, value: unknown): boolean {
  const digits = digitsOf(value);
  if (digits === null) return false;
  return STRAVA_NUMBER_KEY.test(key) || (STRAVA_LONG_NUMBER_KEY.test(key) && digits.length >= 7);
}

/** Längsta text som lämnar processen (efter att hemligheterna maskats). Längre strängar kapas innan något mönster körs. */
export const MAX_SCRUBBED_STRING_LENGTH = 8192;
const TRUNCATED = '…[truncated]';

/**
 * Rensar en sträng. Hemligheterna ur miljön maskas först, på hela texten (en hemlighet som korsar kapgränsen ska inte lämna ett skäl),
 * därefter kapas texten till `maxLength` och först då körs mönstren. `maxLength` kan stängas av (`Infinity`) för att pröva mönstren för sig.
 */
export function scrubString(value: string, secrets: readonly string[], maxLength: number = MAX_SCRUBBED_STRING_LENGTH): string {
  let out = value;
  for (const secret of secrets) out = out.split(secret).join(FILTERED);
  if (out.length > maxLength) out = `${out.slice(0, maxLength)}${TRUNCATED}`;
  return out
    .replace(ENCRYPTED_VALUE, FILTERED)
    .replace(BEARER, `Bearer ${FILTERED}`)
    .replace(JWT_LIKE, FILTERED)
    .replace(KEY_VALUE, (_m, key: string, sep: string) => `${key}${sep}${FILTERED}`)
    .replace(STRAVA_ID, (_m, key: string, sep: string) => `${key}${sep}${FILTERED}`)
    .replace(STRAVA_WORD_ID, (_m, key: string, sep: string) => `${key}${sep}${FILTERED}`)
    .replace(PG_KEY_DETAIL, (detail: string, columns: string) => (STRAVA_COLUMN.test(columns) ? `Key (${columns})=(${FILTERED})` : detail))
    .replace(POSTGREST_FILTER, (_m, filter: string) => `${filter}${FILTERED}`)
    .replace(STRAVA_PATH_ID, ':id')
    .replace(LATLNG_PAIR, (_m, key: string, sep: string) => `${key}${sep}${FILTERED}`)
    .replace(COORDINATE_KEYWORD, (_m, key: string, sep: string) => `${key}${sep}${FILTERED}`)
    .replace(COORDINATE_PAIR, (pair: string, lat: string, lng: string) => (isCoordinate(lat, lng) ? FILTERED : pair))
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
  if (key !== undefined && (COORDINATE_KEY.test(key) || isStravaNumberField(key, value))) return value === null || value === undefined ? value : FILTERED;
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
