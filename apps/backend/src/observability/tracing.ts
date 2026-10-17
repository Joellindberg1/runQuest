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
import { subscribe } from 'node:diagnostics_channel';
import { normalizeIds, scrubSentryEvent } from './scrub.js';

type TransactionEvent = Parameters<NonNullable<Sentry.NodeOptions['beforeSendTransaction']>>[0];

/** Sentry-attributen som sätter transaktionens namn och källa; samma som SDK:ts Express-integration skriver. */
const ATTR_HTTP_ROUTE = 'http.route';
const ATTR_SEGMENT_NAME_SOURCE = 'sentry.segment.name.source';

/** Namnet på en förfrågan som ingen route tog. Aldrig den råa sökvägen. */
export const UNMATCHED_ROUTE = '(no route)';

/** `baseUrl` är den matchade monteringen (kan bära id om en router monterats på en parameter), `routePath` är routens egen mall. */
function routeTemplate(baseUrl: string, routePath: string): string {
  const joined = `${normalizeIds(baseUrl)}/${routePath}`.replace(/\/{2,}/g, '/');
  const withLeading = joined.startsWith('/') ? joined : `/${joined}`;
  return withLeading.length > 1 ? withLeading.replace(/\/$/, '') : withLeading;
}

/**
 * Namnger förfrågan efter routen. Transaktionen (om förfrågan är provtagen) får namn och `http.route`; isolation scope, som varje
 * felhändelse från förfrågan ärver sitt `transaction` från, får samma namn. Utan det bär en felhändelse den råa sökvägen med id.
 */
function nameRequest(root: Sentry.Span | undefined, scope: Sentry.Scope, req: Request, route: unknown): void {
  const path = (route as { path?: unknown } | null | undefined)?.path;
  if (typeof path !== 'string') return;
  const template = routeTemplate(req.baseUrl ?? '', path);
  const name = `${req.method.toUpperCase()} ${template}`;
  scope.setTransactionName(name);
  if (!root) return;
  root.updateName(name);
  root.setAttributes({ [ATTR_HTTP_ROUTE]: template, [ATTR_SEGMENT_NAME_SOURCE]: 'route' });
}

/**
 * Express-middleware som ger förfrågan routens namn ("GET /api/runs/:id"), på transaktionen och på felhändelser. Express sätter
 * `req.route` i samma ögonblick som en route matchar, då `req.baseUrl` är monteringen routern ligger på; senare, när ett fel gått
 * vidare till felhanteraren, är `baseUrl` redan återställd. Därför namnges förfrågan i en setter på `req.route` och inte efteråt.
 * Monteras först i appen. Utan Sentry gör den ingenting; en förfrågan som inte provtagits får bara felhändelsernas namn.
 */
export function sentryRouteNaming(): RequestHandler {
  return (req, _res, next) => {
    if (!Sentry.isInitialized()) {
      next();
      return;
    }
    const active = Sentry.getActiveSpan();
    const rootSpan = active ? Sentry.getRootSpan(active) : undefined;
    const root = rootSpan?.isRecording() ? rootSpan : undefined;
    const scope = Sentry.getIsolationScope();
    let matched: unknown;
    Object.defineProperty(req, 'route', {
      configurable: true,
      enumerable: true,
      get: () => matched,
      set: (route: unknown) => {
        matched = route;
        nameRequest(root, scope, req, route);
      },
    });
    next();
  };
}

/**
 * Tar bort spårningshuvudena från en inkommande förfrågan innan SDK:t läser dem. SDK:t fortsätter annars anroparens trace (id,
 * föräldra-span, provtagningsslump och "baggage" med fria textfält), och de värdena hamnar i vår transaktion och i kuvertets
 * trace-header. Ingen av våra anropare skickar dem (frontend sätter inga), så alla som finns kommer utifrån.
 * SDK:t läser huvudena i sin prenumeration på kanalen `http.server.request.start`; prenumerationer anropas i den ordning de gjordes,
 * så den här måste registreras före `Sentry.init`. Registreras en gång per process.
 */
const TRACE_HEADERS = ['sentry-trace', 'baggage', 'traceparent', 'tracestate'];
let incomingTraceContextStripped = false;
export function stripIncomingTraceContext(): void {
  if (incomingTraceContextStripped) return;
  incomingTraceContextStripped = true;
  subscribe('http.server.request.start', (message) => {
    const headers = (message as { request?: { headers?: Record<string, unknown> } }).request?.headers;
    if (headers) for (const name of TRACE_HEADERS) delete headers[name];
  });
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

/**
 * Sökvägssegmenten i våra utgående anrop som får stå kvar i en span. Allt annat blir `:id`: ett Strava-nummer, ett filnamn i
 * lagringen (ett användarnamn), en e-postadress i en filtrering eller en nyckel i en webhook-adress. En lista och inte ett mönster,
 * eftersom ett gement ord lika gärna kan vara ett användarnamn. Ett nytt segment som saknas här blir `:id`, vilket är säkert;
 * testet "lists every table, view, rpc and storage bucket" i tracing.test.ts fäller bygget så att det syns.
 */
export const FIRST_PARTY_PATH_SEGMENTS: ReadonlySet<string> = new Set([
  // Supabase: PostgREST, rpc, lagring (bucketen, inte filerna i den) och auth
  'rest', 'v1', 'rpc', 'storage', 'object', 'public', 'authenticated', 'sign', 'auth', 'profile-pictures',
  // Tabeller (apps/backend/migrations) och vyn som koden läser
  'activity_log', 'admin_settings', 'challenge_durations', 'challenge_metrics', 'challenge_rewards', 'challenges', 'event_entries',
  'event_pool_members', 'event_pools', 'event_templates', 'events', 'groups', 'level_challenge_rewards', 'level_requirements',
  'news_read', 'run_weather', 'runs', 'strava_tokens', 'strava_webhook_events', 'streak_multipliers', 'title_leaderboard',
  'title_leaderboard_view', 'titles', 'user_badges', 'user_boosts', 'user_challenge_tokens', 'user_seen_items', 'user_settings',
  'user_titles', 'users', 'waitlist_signups',
  // rpc-funktioner koden anropar
  'claim_strava_webhook_events', 'increment_event_xp', 'update_all_title_leaderboards', 'update_title_leaderboard',
  // Strava: api/v3/activities/{id}, athlete, athlete/activities, push_subscriptions och oauth/token|deauthorize
  'api', 'v3', 'activities', 'athlete', 'push_subscriptions', 'oauth', 'token', 'deauthorize',
  // Open-Meteo
  'forecast', 'archive',
]);

function shapeOfPath(pathname: string): string {
  const segments = pathname.split('/').map((segment) => (segment === '' || FIRST_PARTY_PATH_SEGMENTS.has(segment) ? segment : ':id'));
  return segments.join('/') || '/';
}

function pick(source: Json | undefined, allowed: ReadonlySet<string>): Json {
  const out: Json = {};
  for (const [key, value] of Object.entries(source ?? {})) if (allowed.has(key) && value !== undefined) out[key] = value;
  return out;
}

/** Fält på toppnivån i en transaktion som får följa med. SDK:ts egen metadata om processen och bygget; inget som någon kan fylla på. */
const TRANSACTION_FIELDS: readonly string[] = [
  'type', 'event_id', 'timestamp', 'start_timestamp', 'platform', 'environment', 'release', 'dist', 'server_name', 'sdk', 'modules', 'spans',
];
/** Contexts som får följa med: SDK:ts egna beskrivningar av förfrågan och processen. Okända (någon kan ha lagt dit fritt innehåll) tas bort. */
const TRANSACTION_CONTEXTS: readonly string[] = ['trace', 'response', 'runtime', 'app', 'os', 'device', 'culture', 'cloud_resource'];
const TRACE_FIELDS: readonly string[] = ['trace_id', 'span_id', 'parent_span_id', 'op', 'status', 'origin'];

function pickFields(source: Json, fields: readonly string[]): Json {
  const out: Json = {};
  for (const field of fields) if (source[field] !== undefined) out[field] = source[field];
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

  // Tillåtelselista på toppnivån: bara det SDK:t själv fyller i för en transaktion. Taggar, extra, fingeravtryck, användare,
  // brödsmulor och annat som någon lagt på scopen följer aldrig med.
  const out: Json = {
    ...pickFields(source, TRANSACTION_FIELDS),
    transaction: routed ? normalizeIds(source.transaction) : `${method} ${UNMATCHED_ROUTE}`,
    transaction_info: { source: routed ? 'route' : 'custom' },
    request: { method },
  };
  if (source.contexts && typeof source.contexts === 'object') {
    const contexts: Json = {};
    for (const name of TRANSACTION_CONTEXTS) if (source.contexts[name] && typeof source.contexts[name] === 'object') contexts[name] = source.contexts[name];
    if (contexts.trace) contexts.trace = { ...pickFields(contexts.trace, TRACE_FIELDS), data: pick(contexts.trace.data, TRANSACTION_ATTRIBUTES) };
    if (contexts.response) contexts.response = { status_code: contexts.response.status_code };
    out.contexts = contexts;
  }
  if (Array.isArray(source.spans)) out.spans = source.spans.map((span: Json) => scrubSpan(span));

  return scrubSentryEvent(out as T, secrets);
}
