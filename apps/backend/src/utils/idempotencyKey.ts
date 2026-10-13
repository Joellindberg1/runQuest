// Idempotency-Key för POST /api/runs: en uuid v4 per klientinskick (kontrakt i ADR 007-noten).

export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

export const INVALID_IDEMPOTENCY_KEY_ERROR = 'Idempotency-Key must be a UUID v4';

export type IdempotencyKeyParse =
  | { ok: true; key: string | null }
  | { ok: false; error: string };

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Headern saknas → ok med key null (oförändrat beteende, ingen idempotens). Finns den måste den vara en uuid v4,
 * annars ok: false — en tyst ignorerad nyckel skulle ge klienten falsk trygghet om att omförsök är säkra.
 * Nyckeln normaliseras till gemener (uuid-kolumnen och unikindexet jämför kanoniskt).
 * Upprepade headers når Node som en kommaseparerad sträng och avvisas därmed som ogiltiga.
 */
export function parseIdempotencyKey(headerValue: string | string[] | undefined): IdempotencyKeyParse {
  if (headerValue === undefined) return { ok: true, key: null };
  if (typeof headerValue !== 'string' || !UUID_V4.test(headerValue.trim())) {
    return { ok: false, error: INVALID_IDEMPOTENCY_KEY_ERROR };
  }
  return { ok: true, key: headerValue.trim().toLowerCase() };
}
