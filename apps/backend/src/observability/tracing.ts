/**
 * Prestandaspårning i backend (RUN-287): en transaktion per förfrågan, namngiven efter routen, med de utgående anropen
 * (Supabase, Strava, väder) som delspans. Läggs ovanpå felrapporteringen i sentry.ts och följer samma regel: ingenting som
 * kan peka ut en person lämnar processen.
 *
 * Upplägget kräver inget ändrat startkommando (`node dist/server.js`, ingen `--import`):
 *  - Server- och fetch-spans kommer från SDK:ts egna prenumerationer på Nodes diagnostics_channel (`http.server.request.start`,
 *    `undici:request:*`). De är aktiva så fort `Sentry.init` körts, även när modulerna laddats före den.
 *  - Express-instrumenteringen (route-namn, middleware-spans) är den som behöver `--import` och modul-transformering. Den är
 *    avstängd (`enableRuntimeChannelInjection: false`, se sentry.ts). I stället namnger `sentryRouteNaming` transaktionen när
 *    Express hittat sin route, samma sak SDK:ts Express-integration gör.
 *  - `traceLifecycle: 'static'`: en klassisk transaktion per förfrågan, skickad när svaret är klart. Delspans för utgående anrop
 *    skapas bara inne i en förfrågan; schedulers och webhook-arbetare (inga förfrågningar) ger ingen spårning alls.
 *
 * Det som SDK:ts spans bär (verifierat mot @sentry/node 11.8) och vad som händer med det, i `scrubTransaction`:
 *  - Servertransaktionen: namn "METOD /råa/sökvägen" (med id), `url.full`/`url.path`/`url.query`/`url.fragment`, `client.address`,
 *    `user_agent.original`, portar, `request.url`, brödsmulor och användaren. Namnet byts mot routemallen; attributen släpps igenom
 *    bara om de står på listan nedan (metod, route, status). Allt annat tas bort.
 *  - Utgående anrop (supabase-js är fetch): namn "METOD https://värd/sökväg" och `url.full` med query, `url.domain`,
 *    `server.address`, `network.peer.*`, `user_agent.original`. Query och id tas bort ur sökvägen; kvar blir metod, värd, sökvägens
 *    form, status och tid.
 *  - Okända spans (om en integration någon gång lägger till fler) behåller bara typ och tid.
 */
import * as Sentry from '@sentry/node';
import type { Request, RequestHandler } from 'express';
import { scrubSentryEvent } from './scrub.js';

type TransactionEvent = Parameters<NonNullable<Sentry.NodeOptions['beforeSendTransaction']>>[0];

/** Sentry-attributen som sätter transaktionens namn och källa; samma som SDK:ts Express-integration skriver. */
const ATTR_HTTP_ROUTE = 'http.route';
const ATTR_SEGMENT_NAME_SOURCE = 'sentry.segment.name.source';

/** Namnet på en förfrågan som ingen route tog. Aldrig den råa sökvägen. */
export const UNMATCHED_ROUTE = '(no route)';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const NUMERIC_SEGMENT = /(?<=\/)\d+(?=\/|$)/g;

/** Skyddsnät för routenamn: ett id som ändå kommit med blir `:id`. Mallar från koden (`/:id`) berörs inte. */
function normalizeIds(path: string): string {
  return path.replace(UUID, ':id').replace(NUMERIC_SEGMENT, ':id');
}

/** `baseUrl` är den matchade monteringen (kan bära id om en router monterats på en parameter), `routePath` är routens egen mall. */
function routeTemplate(baseUrl: string, routePath: string): string {
  const joined = `${normalizeIds(baseUrl)}/${routePath}`.replace(/\/{2,}/g, '/');
  const withLeading = joined.startsWith('/') ? joined : `/${joined}`;
  return withLeading.length > 1 ? withLeading.replace(/\/$/, '') : withLeading;
}

function nameTransaction(root: Sentry.Span, req: Request, route: unknown): void {
  const path = (route as { path?: unknown } | null | undefined)?.path;
  if (typeof path !== 'string') return;
  const template = routeTemplate(req.baseUrl ?? '', path);
  root.updateName(`${req.method.toUpperCase()} ${template}`);
  root.setAttributes({ [ATTR_HTTP_ROUTE]: template, [ATTR_SEGMENT_NAME_SOURCE]: 'route' });
}

/**
 * Express-middleware som ger servertransaktionen routens namn ("GET /api/runs/:id"). Express sätter `req.route` i samma ögonblick
 * som en route matchar, då `req.baseUrl` är monteringen routern ligger på; senare, när ett fel gått vidare till felhanteraren, är
 * `baseUrl` redan återställd. Därför namnges transaktionen i en setter på `req.route` och inte efteråt. Monteras först i appen.
 * Utan aktiv, inspelande transaktion (Sentry av, eller förfrågan inte provtagen) gör den ingenting alls.
 */
export function sentryRouteNaming(): RequestHandler {
  return (req, _res, next) => {
    const active = Sentry.getActiveSpan();
    const root = active ? Sentry.getRootSpan(active) : undefined;
    if (!root?.isRecording()) {
      next();
      return;
    }
    let matched: unknown;
    Object.defineProperty(req, 'route', {
      configurable: true,
      enumerable: true,
      get: () => matched,
      set: (route: unknown) => {
        matched = route;
        nameTransaction(root, req, route);
      },
    });
    next();
  };
}

/** Förfrågningar som aldrig spåras: lastbalanserarens hälsokontroll skulle annars äta kvoten. */
export function isUntracedRequest(urlPath: string): boolean {
  try {
    return new URL(urlPath, 'http://localhost').pathname === '/health';
  } catch {
    return false;
  }
}

/** Alternativen som slår på spårning i `Sentry.init`. `rate` kommer från `tracesSampleRateOf`. */
export function tracingOptions(rate: number, secrets: readonly string[]) {
  return {
    tracesSampleRate: rate,
    // En inkommande förfrågan kan bära ett eget provtagningsbeslut (`sentry-trace: ...-1`). Utan en sampler ärver SDK:t det, och vem
    // som helst kunde då tvinga fram spårning och äta kvoten. Samplern ger alltid vårt eget tal.
    tracesSampler: () => rate,
    // Klassiska transaktioner (en per förfrågan, skickas när svaret är klart); se rubriken.
    traceLifecycle: 'static' as const,
    beforeSendTransaction: (event: TransactionEvent) => scrubTransaction(event, secrets),
  } satisfies Sentry.NodeOptions;
}

type Json = Record<string, any>;

/** Attribut som får följa med servertransaktionen: hur den gick och vilken route det var, inget om vem eller varifrån. */
const TRANSACTION_ATTRIBUTES = new Set([
  'sentry.op', 'sentry.origin', 'sentry.kind', 'sentry.sample_rate', 'sentry.segment.name.source',
  'http.request.method', 'http.route', 'http.response.status_code',
]);

/** Attribut som får följa med en span för ett utgående anrop. Värden och URL:en byggs om av `describeOutgoingCall`. */
const OUTGOING_SPAN_ATTRIBUTES = new Set(['http.request.method', 'http.response.status_code']);

// Ett sökvägssegment får stå kvar bara om det ser ut som ett ord (gemener, `_`, `-`) eller en version (`v1`). Allt annat (siffror,
// versaler, blandade tecken) kan vara ett id eller en hemlighet i en sökväg, t.ex. Strava-aktivitetens nummer eller en webhook-nyckel.
const SAFE_SEGMENT = /^(?:[a-z][a-z_-]{0,29}|v\d{1,2})$/;

function shapeOfPath(pathname: string): string {
  const segments = pathname.split('/').map((segment) => (segment === '' || SAFE_SEGMENT.test(segment) ? segment : ':id'));
  return segments.join('/') || '/';
}

function pick(source: Json | undefined, allowed: ReadonlySet<string>): Json {
  const out: Json = {};
  for (const [key, value] of Object.entries(source ?? {})) if (allowed.has(key) && value !== undefined) out[key] = value;
  return out;
}

const METHOD = /^[A-Z]{3,10}$/;

function methodOf(event: Json): string {
  const fromRequest = event.request?.method;
  if (typeof fromRequest === 'string' && METHOD.test(fromRequest.toUpperCase())) return fromRequest.toUpperCase();
  const first = typeof event.transaction === 'string' ? event.transaction.split(' ')[0] : '';
  return METHOD.test(first) ? first : 'GET';
}

/** "METOD https://värd/sökvägens form" för ett utgående anrop. Query, fragment och id i sökvägen finns inte kvar. */
function describeOutgoingCall(span: Json): { description: string; host?: string } {
  const method = typeof span.data?.['http.request.method'] === 'string' ? span.data['http.request.method'] : String(span.description ?? '').split(' ')[0] || 'GET';
  const rawUrl = typeof span.data?.['url.full'] === 'string' ? span.data['url.full'] : String(span.description ?? '').split(' ').slice(1).join(' ');
  try {
    const url = new URL(rawUrl);
    return { description: `${method} ${url.protocol}//${url.host}${shapeOfPath(url.pathname)}`, host: url.hostname };
  } catch {
    return { description: `${method} (unknown address)` };
  }
}

function scrubSpan(span: Json): Json {
  const out: Json = {};
  for (const key of ['span_id', 'parent_span_id', 'trace_id', 'start_timestamp', 'timestamp', 'op', 'origin', 'status']) {
    if (span[key] !== undefined) out[key] = span[key];
  }
  if (typeof span.op === 'string' && span.op.startsWith('http.client')) {
    const { description, host } = describeOutgoingCall(span);
    out.description = description;
    out.data = { ...pick(span.data, OUTGOING_SPAN_ATTRIBUTES), ...(host ? { 'server.address': host } : {}) };
  }
  return out;
}

/**
 * `beforeSendTransaction`: returnerar en rensad kopia av transaktionen, eller null när den inte ska skickas (förväntat klientfel).
 * Ändrar aldrig objektet den får. Namnet blir routemallen (eller "METOD (no route)" om ingen route tog förfrågan), attributen och
 * delspansen byggs om enligt rubriken, och sist går allt genom samma rensning som felhändelserna (hemligheter, e-post, tokens).
 */
export function scrubTransaction<T extends object>(event: T, secrets: readonly string[] = []): T | null {
  const source = event as Json;
  const routed = source.transaction_info?.source === 'route' && typeof source.transaction === 'string';
  const method = methodOf(source);

  const out: Json = { ...source };
  out.transaction = routed ? normalizeIds(source.transaction) : `${method} ${UNMATCHED_ROUTE}`;
  out.transaction_info = { source: routed ? 'route' : 'custom' };
  out.request = { method };
  delete out.user;
  delete out.breadcrumbs;
  if (source.contexts && typeof source.contexts === 'object') {
    out.contexts = { ...source.contexts };
    if (source.contexts.trace) out.contexts.trace = { ...source.contexts.trace, data: pick(source.contexts.trace.data, TRANSACTION_ATTRIBUTES) };
  }
  if (Array.isArray(source.spans)) out.spans = source.spans.map((span: Json) => scrubSpan(span));

  return scrubSentryEvent(out as T, secrets);
}
