/**
 * A short label for an error, for log lines: its code (a Postgres or our own code) or else its name, characters limited. Never the
 * message, the details or the stack: a database or Strava error can carry the values of the row or the response in them (a Strava id,
 * a coordinate, a title), and ADR 010 decision 8.6 keeps those out of the logs.
 */
export function errorCode(error: unknown): string {
  // `||` och inte `??`: en tom kod (PostgREST kan ge '') ska falla igenom till namnet, och ett tomt namn till 'unknown'.
  const raw = (error as { code?: unknown } | null)?.code || (error as { name?: unknown } | null)?.name || 'unknown';
  return String(raw).replace(/[^\w.:-]/g, '').slice(0, 40) || 'unknown';
}
