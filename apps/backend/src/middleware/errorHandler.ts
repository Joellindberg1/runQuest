// Felhanteringen sist i createApp() (ADR 007 Addendum 2026-10-20, punkt 2): 404 för en route som ingen matchade, och en JSON-felhanterare efter Sentry-hanteraren
// för allt som nått Express som ett fel (en trasig JSON-body, en för stor body, ett kast som ingen route fångat). Utan den svarar Express med en HTML-sida.
//
// Säkerhet (punkt 5): ett felsvar har ingen andra försvarslinje, eftersom skrubbern körs på det som går till Sentry men inte på HTTP-svar. Texten väljs därför
// ur en FAST tabell efter feltyp eller status, aldrig ur `error.message`, `error.stack`, `error.cause` eller `error.expose`. JSON.parse-felet i express.json()
// kan citera början av brödtexten (`Unexpected token 'x', "{"password":"…`), och ett kastat fel kan bära ett Strava-id, en koordinat eller ett token.
import type { NextFunction, Request, Response } from 'express';
import type { ApiErrorCode } from '@runquest/shared';
import { logger } from '../utils/logger.js';
import { errorCode } from '../utils/errorCode.js';
import { statusOfExpressError } from '../observability/scrub.js';
import { fail, failAnyStatus } from '../utils/respond.js';

const MIN_ERROR_STATUS = 400;
const MAX_ERROR_STATUS = 599;
const SERVICE_UNAVAILABLE = 503;

interface Outcome { status: number; code: ApiErrorCode; text: string }

/**
 * Body-parserns feltyper (body-parser/http-errors `error.type`) och svaret de ger. En Map och inget vanligt objekt: `error.type` kommer från ett fel vi inte styr, och en uppslagning i ett
 * objekt hittar `constructor`, `toString` och `__proto__` (en funktion eller ett prototypobjekt i stället för ett svar).
 */
const BY_TYPE = new Map<string, Outcome>([
  ['entity.parse.failed', { status: 400, code: 'invalid_json', text: 'Invalid JSON body' }],
  ['entity.too.large', { status: 413, code: 'payload_too_large', text: 'Request body too large' }],
  ['encoding.unsupported', { status: 415, code: 'unsupported_media_type', text: 'Unsupported media type' }],
  ['charset.unsupported', { status: 415, code: 'unsupported_media_type', text: 'Unsupported media type' }],
]);

const FALLBACK: Outcome = { status: 500, code: 'internal_error', text: 'Internal server error' };

const INVALID_REQUEST_TEXT = 'Invalid request';
const SERVICE_UNAVAILABLE_TEXT = 'Service unavailable';
const INTERNAL_ERROR_TEXT = 'Internal server error';

/** 404 för en route som ingen matchade. Loggar `req.path`, aldrig `originalUrl`: frågesträngen kan bära en OAuth-`code` eller `hub.verify_token`. */
export function notFoundHandler(req: Request, res: Response): void {
  logger.info(`❓ 404 - Route not found: ${req.method} ${req.path}`);
  fail(res, 404, 'Route not found', 'route_not_found');
}

function typeOf(error: unknown): string | undefined {
  const type = (error as { type?: unknown } | null)?.type;
  return typeof type === 'string' ? type : undefined;
}

/** Svaret för ett fel: ur typtabellen, annars ur statusen. Läser egenskaper på ett fel vi inte styr (getters, Proxy) och kan därför kasta: anroparen fångar det. */
function outcomeOf(error: unknown): Outcome & { report: boolean } {
  const known = BY_TYPE.get(typeOf(error) ?? '');
  if (known) return { ...known, report: false };

  const raw = statusOfExpressError(error);
  const status = raw >= MIN_ERROR_STATUS && raw <= MAX_ERROR_STATUS ? raw : 500;
  if (status < 500) return { status, code: 'invalid_request', text: INVALID_REQUEST_TEXT, report: false };
  if (status === SERVICE_UNAVAILABLE) return { status, code: 'service_unavailable', text: SERVICE_UNAVAILABLE_TEXT, report: true };
  return { status, code: 'internal_error', text: INTERNAL_ERROR_TEXT, report: true };
}

/**
 * Monteras EFTER Sentry-hanteraren (som rapporterar 500 och uppåt och skickar felet vidare). Fyra utfall:
 *  - svaret är redan påbörjat (`headersSent`): felet går vidare till Express, som stänger anslutningen;
 *  - en känd body-parserfeltyp: den typens status, kod och text;
 *  - övriga 4xx: `invalid_request`; 503: `service_unavailable`; allt annat (500 och uppåt, en status utanför 400-599): `internal_error`;
 *  - ett fel som själv kastar när det läses (getter, Proxy): det fasta 500-svaret.
 */
export function jsonErrorHandler(error: unknown, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  // Ett fel med en getter eller en Proxy som kastar får aldrig ge Expresss HTML-sida: då svarar vi det fasta 500-svaret.
  let outcome: Outcome & { report: boolean };
  try {
    outcome = outcomeOf(error);
  } catch {
    outcome = { ...FALLBACK, report: true };
  }

  if (outcome.report) {
    // Rapporteringen till Sentry gör hanteraren före oss; här finns bara en loggrad med felkoden, aldrig felobjektet (logger.warn når inte Sentry).
    try {
      logger.warn(`⚠️ Unhandled error on ${req.method} ${req.path} (${errorCode(error)})`);
    } catch {
      logger.warn(`⚠️ Unhandled error on ${req.method} ${req.path}`);
    }
  }
  failAnyStatus(res, outcome.status, outcome.text, outcome.code);
}
