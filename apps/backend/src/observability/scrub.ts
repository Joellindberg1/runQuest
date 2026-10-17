/**
 * Vad som aldrig lämnar processen till Sentry, och vilka händelser som inte skickas alls.
 * Rena funktioner utan beroende på SDK:t, så de går att testa med en fixtur (scrub.test.ts).
 *
 * Principen är två lager: vi bifogar inget känsligt (inga bodies, inga headers, inga namn), och det som ändå kommer med
 * (ett felmeddelande från databasen, en URL) rensas här på både nyckelnamn och värdemönster.
 */

export const FILTERED = '[Filtered]';

/** Förväntade klientfel: ett svar på fel förfrågan, inte ett fel i vår kod. */
export const CLIENT_STATUSES_NOT_REPORTED: readonly number[] = [401, 403, 404, 429];

export function isExpectedClientStatus(status: unknown): boolean {
  const n = typeof status === 'string' && status.trim() !== '' ? Number(status) : status;
  return typeof n === 'number' && CLIENT_STATUSES_NOT_REPORTED.includes(n);
}

// jsonwebtoken kastar dessa vid ogiltig eller utgången token; authenticateJWT svarar 401 på dem.
const JWT_ERROR_NAMES = new Set(['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError']);

function numericStatus(value: unknown): number | undefined {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) ? n : undefined;
}

/** HTTP-statusen ett loggat fel hör till, om argumenten bär en (felobjekt, Strava-/fetch-svar) eller är ett JWT-fel (401). */
export function statusOfLoggedArgs(args: readonly unknown[]): number | undefined {
  for (const arg of args) {
    if (arg === null || typeof arg !== 'object') continue;
    const candidate = arg as { name?: unknown; status?: unknown; statusCode?: unknown; response?: { status?: unknown; statusCode?: unknown } | null };
    if (typeof candidate.name === 'string' && JWT_ERROR_NAMES.has(candidate.name)) return 401;
    const status = numericStatus(candidate.status) ?? numericStatus(candidate.statusCode)
      ?? numericStatus(candidate.response?.status) ?? numericStatus(candidate.response?.statusCode);
    if (status !== undefined) return status;
  }
  return undefined;
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
const KEY_VALUE = /\b((?:access|refresh|id)[_-]?token|client[_-]?secret|api[_-]?key|password|passwd|secret|token|authorization)(=|["']\s*:\s*)["']?([^\s"'&,;}]+)/gi;
const HEX_40 = /\b[0-9a-f]{40}\b/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

const MIN_SECRET_LENGTH = 8;

/** Värdena på miljövariabler som ser ut som hemligheter (nyckel, token, lösenord, secret), utom DSN:en. De rensas ur alla strängar. */
export function secretsFromEnv(env: NodeJS.ProcessEnv): string[] {
  return Object.entries(env)
    .filter(([name, value]) => /SECRET|KEY|TOKEN|PASSWORD/i.test(name) && !/DSN/i.test(name) && typeof value === 'string' && value.length >= MIN_SECRET_LENGTH)
    .map(([, value]) => value as string);
}

function scrubString(value: string, secrets: readonly string[]): string {
  let out = value;
  for (const secret of secrets) out = out.split(secret).join(FILTERED);
  return out
    .replace(BEARER, `Bearer ${FILTERED}`)
    .replace(JWT_LIKE, FILTERED)
    .replace(KEY_VALUE, (_m, key: string, sep: string) => `${key}${sep}${FILTERED}`)
    .replace(HEX_40, FILTERED)
    .replace(EMAIL, FILTERED);
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
    if (typeof request.url === 'string') request.url = request.url.split(/[?#]/)[0];
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
