/**
 * A short label for an error, for log lines: its code (a Postgres or our own code) or else its name, characters limited. Never the
 * message, the details or the stack: a database or Strava error can carry the values of the row or the response in them (a Strava id,
 * a coordinate, a title), and ADR 010 decision 8.6 keeps those out of the logs.
 */

/**
 * Network-level causes we may name when the error itself has no code. supabase-js returns `{ code: '', message: 'TypeError: fetch
 * failed', details: '...Caused by: Error: read ECONNRESET (ECONNRESET)...' }` instead of throwing when the connection to the database
 * breaks, so the code only exists as a word in the text. We match the text against this fixed list and return the list entry, never a
 * piece of the text, so nothing a row could carry ever comes out.
 */
const NETWORK_CAUSE_CODES = [
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_HEADERS_OVERFLOW',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_ABORTED',
  'UND_ERR_CLOSED',
  'UND_ERR_DESTROYED',
  'AbortError',
  'TimeoutError',
] as const;

/** A listed word counts only as a whole token: `NOT_ECONNRESET_X` is not `ECONNRESET`. */
const NETWORK_CAUSE_PATTERN = new RegExp(`(?<![A-Za-z0-9_])(${NETWORK_CAUSE_CODES.join('|')})(?![A-Za-z0-9_])`);
const FETCH_FAILED_PATTERN = /(?<![A-Za-z0-9_])fetch failed(?![A-Za-z0-9_])/i;
const MAX_CAUSE_DEPTH = 4;

function stringField(value: unknown, field: string): string {
  const v = (value as Record<string, unknown> | null | undefined)?.[field];
  return typeof v === 'string' ? v : '';
}

function listed(candidate: string): string | undefined {
  return NETWORK_CAUSE_CODES.find((code) => code === candidate);
}

/** The listed code of an error's `cause` chain (a real fetch error carries it as `cause.code`), or undefined. */
function codeFromCauseChain(error: unknown): string | undefined {
  let current = (error as { cause?: unknown } | null | undefined)?.cause;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current; depth++) {
    const found = listed(stringField(current, 'code')) ?? listed(stringField(current, 'name'));
    if (found) return found;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** The listed code found as a whole word in the message or the details, or 'fetch_failed' for an unspecified fetch failure. */
function codeFromText(error: unknown): string | undefined {
  const text = `${stringField(error, 'details')}\n${stringField(error, 'message')}`;
  const match = NETWORK_CAUSE_PATTERN.exec(text);
  if (match) return match[1];
  return FETCH_FAILED_PATTERN.test(text) ? 'fetch_failed' : undefined;
}

export function errorCode(error: unknown): string {
  const own = (error as { code?: unknown } | null | undefined)?.code;
  // `||` och inte `??`: en tom kod (PostgREST/supabase-js kan ge '') ska falla igenom till orsaken, sedan namnet, sedan 'unknown'.
  const raw = own
    || codeFromCauseChain(error)
    || (error && typeof error === 'object' ? codeFromText(error) : undefined)
    || (error as { name?: unknown } | null | undefined)?.name
    || 'unknown';
  return String(raw).replace(/[^\w.:-]/g, '').slice(0, 40) || 'unknown';
}

/**
 * An Error to throw for a failed database call: a fixed message (what failed plus ids, written by us) and the source's `code`
 * from errorCode(). Never the source's own text: it can quote row values, and a catch that logs, rethrows or reports must not
 * be able to leak it. The caller logs `errorCode(thrown)` and gets the database code, or the network cause if there was none.
 */
export function errorWithCode(message: string, source: unknown): Error & { code: string } {
  return Object.assign(new Error(message), { code: errorCode(source) });
}
