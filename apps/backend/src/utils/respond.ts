// Svarshjälparna (ADR 007 Addendum 2026-10-20, punkt 1 och 2): ett kuvert för lyckade svar och ett felformat, på ett ställe.
//
//   ok(res, data, meta?)            200 { success: true, data, meta? }       (`data` är null när åtgärden saknar nyttolast)
//   fail(res, status, error, code?) 4xx/5xx { success: false, error, code }  (code = standardkoden för statusen om den utelämnas)
//
// Säkerhet (punkt 5): `fail` tar en FAST text som anropsstället skrivit, eller en valideringstext byggd av anroparens egen indata. Det går inte att skicka
// vidare ett fel av misstag: parametern är en `string`, och en `Error` (eller något annat som inte är en sträng) som slinker in via en cast byts mot den fasta texten för
// statusen i stället för att ekas. Skrubbern körs på det som går till Sentry men inte på HTTP-svar, så skyddet här måste vara strukturellt.
//
// `fail` och `ok` loggar och rapporterar ingenting: loggningen ligger kvar hos anroparen (`logger.error`, som är Sentry-kopplingen), så en händelse aldrig skickas två gånger.
//
// Steg 1 (expand, dubbelsvar): `okWithLegacy` skickar `data` BREDVID de gamla toppnivånycklarna, `failWritten` lägger `written: true` bredvid koden
// `recalc_failed_after_write`. Båda tas bort i steg 2 (contract); sök på dem för att hitta varje ställe.
import type { Response } from 'express';
import type { ApiErrorCode, ApiSuccess } from '@runquest/shared';

/** Statusarna ett felsvar använder. En status utanför listan är ett kompileringsfel: lägg den i `DEFAULT_CODE_BY_STATUS` och i katalogen först. */
export type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 415 | 429 | 500 | 503;

const DEFAULT_CODE_BY_STATUS: Record<ErrorStatus, ApiErrorCode> = {
  400: 'invalid_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  429: 'rate_limited',
  500: 'internal_error',
  503: 'service_unavailable',
};

/** Fasta texter per status: de används av felhanteraren och när `fail` får något som inte är en sträng. Aldrig ur ett felobjekt. */
const FIXED_TEXT_BY_STATUS: Record<ErrorStatus, string> = {
  400: 'Invalid request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not found',
  409: 'Conflict',
  413: 'Request body too large',
  415: 'Unsupported media type',
  429: 'Too many attempts, try again later',
  500: 'Internal server error',
  503: 'Service unavailable',
};

/** Standardkoden för en status (tabellen i ADR 007 Addendum 2026-10-20 punkt 3). */
export function defaultErrorCode(status: ErrorStatus): ApiErrorCode {
  return DEFAULT_CODE_BY_STATUS[status];
}

/** Den fasta texten för en status. */
export function fixedErrorText(status: ErrorStatus): string {
  return FIXED_TEXT_BY_STATUS[status];
}

/** Formen på ett lyckat svar i kontraktet: `{ success: true, data, meta? }` (ApiSuccess) eller dess dubbelsvar (DualEnvelope) i steg 1. */
type SuccessWire = { success: true; data: unknown; meta?: unknown };
/** Det en kontraktstyp har utöver kuvertet: de gamla toppnivånycklarna. */
type LegacyOf<TWire> = Omit<TWire, 'success' | 'data' | 'meta'>;

/**
 * Lyckat svar: `{ success: true, data, meta? }`. Statusen är den som `res` redan har (200, eller 201 efter `res.status(201)`). Typparametern är svarets kontraktstyp
 * (`ok<AdminUsersResponse>(res, rows)`): då kontrollerar kompilatorn `data` och `meta` mot den, så klientens typ och serverns svar följer samma definition (ADR 007 A7).
 */
export function ok<TWire extends SuccessWire = ApiSuccess<unknown, unknown>>(res: Response, data: TWire['data'], meta?: NonNullable<TWire['meta']>): void {
  res.json({
    success: true,
    data: data === undefined ? null : data,
    ...(meta !== undefined && { meta }),
  });
}

/**
 * Steg 1 (dubbelsvar): som `ok`, men de gamla toppnivånycklarna (`events`, `run`, `message`, `token`, räknare ...) skickas kvar bredvid `data`, så att en klient från före steg 1
 * läser samma svar. `meta` är kuvertets (paginering, diagnostik) och ligger kvar på toppnivå som förut. Typparametern är kontraktstypen (`DualEnvelope<…>`), som kontrollerar
 * både `data`, de gamla nycklarna och `meta`. Tas bort i steg 2 (RUN-364): sök på `okWithLegacy` för att hitta varje ställe.
 */
export function okWithLegacy<TWire extends SuccessWire>(res: Response, data: TWire['data'], legacy: LegacyOf<TWire>, meta?: NonNullable<TWire['meta']>): void {
  res.json({
    success: true,
    ...legacy,
    data: data === undefined ? null : data,
    ...(meta !== undefined && { meta }),
  });
}

function errorBody(status: ErrorStatus, text: unknown, code: ApiErrorCode | undefined): { success: false; error: string; code: ApiErrorCode } {
  return {
    success: false,
    // En icke-sträng (en Error via en cast, ett objekt) ekas aldrig: den fasta texten för statusen tar dess plats.
    error: typeof text === 'string' ? text : fixedErrorText(status),
    code: code ?? defaultErrorCode(status),
  };
}

/** Felsvar: `{ success: false, error, code }`. `error` är en fast text för visning och loggar, aldrig för logik; `code` är det klienten grenar på. */
export function fail(res: Response, status: ErrorStatus, text: string, code?: ApiErrorCode): void {
  res.status(status).json(errorBody(status, text, code));
}

/**
 * Bara för den centrala felhanteraren (`middleware/errorHandler.ts`), vars status kommer från ett fel som nått Express (400-599, även sådana som inte är i `ErrorStatus`:
 * 405, 431, 502 ...). Koden och texten väljer anroparen ur fasta tabeller. Routes använder `fail`, vars status är begränsad.
 */
export function failAnyStatus(res: Response, status: number, text: string, code: ApiErrorCode): void {
  res.status(status).json({ success: false, error: text, code });
}

/**
 * 207 och 500 i `POST /titles/reprocess-all` är de enda svaren med `success: false` som bär `data` (bara räknare, punkt 4). 207 är ett 2xx-svar
 * med `success: false` (kuvertets enda undantag): några lyckades, några föll.
 */
export function failWithData<TData>(res: Response, status: 207 | 500, text: string, code: ApiErrorCode, data: TData): void {
  res.status(status).json({
    success: false,
    error: typeof text === 'string' ? text : fixedErrorText(500),
    code,
    data,
  });
}

/**
 * Steg 1 (dubbelsvar): raden skrevs men XP-omräkningen föll. Koden `recalc_failed_after_write` bär betydelsen "skrivet, försök inte igen"; `written: true`
 * finns kvar för klienter från före steg 1 och tas bort i steg 2 (RUN-364).
 */
export function failWritten(res: Response, text: string): void {
  res.status(500).json({ ...errorBody(500, text, 'recalc_failed_after_write'), written: true });
}
