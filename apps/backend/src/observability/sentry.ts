/**
 * Sentry i backend (felrapportering, ingen tracing).
 *
 * Upplägg:
 *  - `initSentry()` anropas en gång tidigt i server.ts, efter att .env laddats. Utan SENTRY_DSN gör den ingenting alls
 *    (dev, tester och CI skickar aldrig något).
 *  - ESM utan `--import`: SDK:ts auto-instrumentering (HTTP, Express, databas) behöver `--import @sentry/node/import` och ett
 *    ändrat startkommando, men ger bara spans. Här behövs bara felrapportering, och den fungerar med `node dist/server.js` som förut.
 *    Därför är auto-instrumenteringen avstängd (`enableRuntimeChannelInjection: false`) och ingen `tracesSampleRate` är satt.
 *    Tracing (en egen story) tar beslutet om `--import` då.
 *  - Kopplingspunkten för fel är loggern: `logger.error` lämnar varje rad till `captureLoggedError` (via `setErrorSink`).
 *    Handlers ändras inte. Fel som aldrig når en logger.error fångas av `installSentryErrorHandler` (Express) och av
 *    process-hanterarna för unhandledRejection/uncaughtException.
 *  - Användaren (bara id) sätts med `withSentryUser`, som kör resten av förfrågan i en egen isolation scope (se funktionen).
 *  - Inga spårningsheaders: SDK:t lägger annars `sentry-trace` och `baggage` på utgående fetch- och http-anrop även utan tracing,
 *    och det skulle skicka metadata till Strava, Supabase och väder-API:t. `tracePropagationTargets: []` stänger det.
 *  - `unhandledRejection` kör `mode: 'strict'`: händelsen skickas och processen kraschar som Node gör utan Sentry. Undantag i SDK:ns
 *    standardlista: ett avslag med namnet `AbortError` (eller `AI_NoOutputGeneratedError`) ignoreras helt, varken skickas eller kraschar
 *    (utan Sentry hade Node kraschat på det). Backend har ingen avbruten stream eller AbortController-kod som kastar sådana oväntat.
 *  - Allt som skickas går först genom `scrubSentryEvent` (scrub.ts): inga tokens, headers, bodies, namn eller e-post.
 *
 * Stabilt gränssnitt för larm som bygger vidare på detta: `captureLoggedError` är den enda platsen där en loggrad blir en händelse.
 * Rader med prefixet "🚨 KRITISK" (utils/criticalAlert.ts) blir där `fatal` med taggarna `alert=critical` och `source=<kod>`, och går
 * förbi SDK:ts repeat-filter. Sentry-alertregeln filtrerar på `alert:critical`.
 */
import * as Sentry from '@sentry/node';
import type { Express, NextFunction, Request, Response } from 'express';
import { CriticalAlert, criticalAlertOf } from '../utils/criticalAlert.js';
import { setErrorSink } from '../utils/logger.js';
import { fingerprintOf, isClientAuthError, isDroppedBreadcrumb, isExpectedClientStatus, scrubSentryEvent, secretsFromEnv, statusOfExpressError } from './scrub.js';

const MAX_DETAIL_LENGTH = 300;

/** Värdet på taggen `alert` för kritiska larm; Sentry-alertregeln filtrerar på `alert:critical`. */
export const CRITICAL_ALERT_TAG = 'critical';

/**
 * SDK 11 har tagit bort `sendDefaultPii`; `dataCollection` ersätter det, och dess standardvärden samlar ALLT (användaruppgifter,
 * cookies, headers, bodies, query-parametrar, lokala variabler i stacktraces). Här stängs varje kategori uttryckligen.
 * Kvar är det som gör ett fel läsbart: typ, meddelande och stacktrace (utan källkodsrader runt ramarna).
 */
export const NO_DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  frameContextLines: 0,
} satisfies Sentry.NodeOptions['dataCollection'];

export interface InitSentryTestOptions {
  /** Ersätter nätverkstransporten (tester fångar kuvertet i stället för att skicka det). */
  transport?: Sentry.NodeOptions['transport'];
  /** `false` hoppar över hanterarna för unhandledRejection/uncaughtException (de testas i en egen process). Standard: true. */
  processHandlers?: boolean;
}

type SentryIntegration = Exclude<NonNullable<Sentry.NodeOptions['integrations']>, (...args: never[]) => unknown>[number];

/**
 * SDK:ts repeat-filter (Dedupe) släpper en händelse som är identisk med den förra: samma meddelande, samma fingeravtryck och samma
 * stacktrace. Ett larm som upprepas från samma anropsställe (nattkontrollen av prenumerationen två nätter i rad) skulle då tystas
 * den andra gången, och ett kritiskt larm får inte försvinna. Kritiska larm går därför förbi filtret.
 */
function withoutCriticalAlerts(dedupe: SentryIntegration): SentryIntegration {
  const { processEvent } = dedupe;
  if (!processEvent) return dedupe;
  return {
    ...dedupe,
    processEvent: (event, hint, client) => (event.tags?.alert === CRITICAL_ALERT_TAG ? event : processEvent(event, hint, client)),
  };
}

/** Startar Sentry om `SENTRY_DSN` är satt. Returnerar om den startades. */
export function initSentry(env: NodeJS.ProcessEnv = process.env, testOptions: InitSentryTestOptions = {}): boolean {
  const dsn = env.SENTRY_DSN?.trim();
  if (!dsn) return false;

  const secrets = secretsFromEnv(env);
  const withProcessHandlers = testOptions.processHandlers !== false;

  Sentry.init({
    dsn,
    environment: env.SENTRY_ENVIRONMENT?.trim() || env.NODE_ENV || 'development',
    dataCollection: NO_DATA_COLLECTION,
    enableRuntimeChannelInjection: false,
    tracePropagationTargets: [],
    ...(testOptions.transport ? { transport: testOptions.transport } : {}),
    integrations: (defaults) => defaults
      // Konsolrader bär namn och annat som inte ska med; breadcrumbs behövs inte för att hitta felet.
      .filter((i) => i.name !== 'Console')
      .filter((i) => withProcessHandlers || (i.name !== 'OnUncaughtException' && i.name !== 'OnUnhandledRejection'))
      // Standardläget "warn" sväljer ett oväntat löftesavslag. "strict" fångar det och kraschar processen som Node gör utan Sentry.
      .map((i) => (i.name === 'OnUnhandledRejection' ? Sentry.onUnhandledRejectionIntegration({ mode: 'strict' }) : i))
      .map((i) => (i.name === 'Dedupe' ? withoutCriticalAlerts(i) : i)),
    beforeSend: (event) => scrubSentryEvent(event, secrets),
    beforeBreadcrumb: (breadcrumb) => (isDroppedBreadcrumb(breadcrumb) ? null : breadcrumb),
  });

  criticalThrottle.clear();
  setErrorSink(captureLoggedError);
  return true;
}

/** Stänger klienten och kopplar loss loggern (tester, och ordnad nedstängning). */
export async function closeSentry(): Promise<void> {
  setErrorSink(null);
  criticalThrottle.clear();
  await Sentry.close(2000);
}

/** Väntar tills köade händelser är skickade, så en process som är på väg att avslutas inte tappar dem. */
export async function flushSentry(timeoutMs = 2000): Promise<boolean> {
  return Sentry.isInitialized() ? Sentry.flush(timeoutMs) : true;
}

function loggedDetail(args: readonly unknown[]): unknown {
  const first = args.find((a) => a !== undefined && !(a instanceof CriticalAlert));
  if (typeof first === 'string') return first.slice(0, MAX_DETAIL_LENGTH);
  if (first !== null && typeof first === 'object') {
    const { code, message } = first as { code?: unknown; message?: unknown };
    const detail: Record<string, string | number> = {};
    if (typeof code === 'string' || typeof code === 'number') detail.code = code;
    if (typeof message === 'string') detail.message = message.slice(0, MAX_DETAIL_LENGTH);
    return Object.keys(detail).length > 0 ? detail : undefined;
  }
  return undefined;
}

/**
 * En `logger.error`-rad blir en händelse: ett Error som exception, annars meddelandet som en message-händelse.
 * Av argumenten följer aldrig mer än kod och meddelande med (aldrig bodies eller objekt i fri form).
 * JWT-fel (klientens ogiltiga token, 401) skickas inte. En status på ett loggat fel i övrigt är ett uppströmssvar och skickas.
 */
export function captureLoggedError(message: string, args: readonly unknown[]): void {
  if (!Sentry.isInitialized()) return;

  // Före klientfiltret: ett kritiskt larm får aldrig tystas av att det bär ett JWT-fel.
  const alert = criticalAlertOf(message, args);
  if (!alert && isClientAuthError(args)) return;

  // Händelsen ärver aldrig loggtexten när anroparen gett en egen (utan Strava-id): meddelande, gruppering och kontext använder den.
  const text = alert?.sentryMessage ?? message;
  const grouping = fingerprintOf(text);

  let suppressedSinceLast = 0;
  if (alert) {
    const decision = throttleCriticalAlert(`${alert.source}|${grouping}`, Date.now());
    if (!decision.send) return;
    suppressedSinceLast = decision.suppressedSinceLast;
  }

  // `fatal` och taggen alert=critical är det Sentry-alertregeln filtrerar på. `source` säger vilket larm det är; user_id är vårt eget id.
  const alertContext = alert
    ? {
        level: 'fatal' as const,
        tags: { alert: CRITICAL_ALERT_TAG, source: alert.source, ...(alert.userId ? { user_id: alert.userId } : {}) },
      }
    : { level: 'error' as const };
  const suppressedExtra = suppressedSinceLast > 0 ? { suppressed_since_last: suppressedSinceLast } : {};

  const error = args.find((a): a is Error => a instanceof Error);
  if (error) {
    Sentry.captureException(error, { extra: { log_message: text, ...suppressedExtra }, ...alertContext });
    return;
  }
  const detail = loggedDetail(args);
  const extra = { ...(detail !== undefined ? { log_detail: detail } : {}), ...suppressedExtra };
  Sentry.captureMessage(text, {
    ...alertContext,
    fingerprint: [grouping],
    ...(Object.keys(extra).length > 0 ? { extra } : {}),
  });
}

/** Högst en Sentry-händelse per (källa, fingeravtryck) och så här lång tid; resten räknas (`extra.suppressed_since_last`). */
export const CRITICAL_ALERT_THROTTLE_MS = 10 * 60_000;

const criticalThrottle = new Map<string, { sentAt: number; suppressed: number }>();

/**
 * Spärren mot en larmstorm (t.ex. en token-skrivning som felar för varje användare): första larmet går igenom, de följande inom
 * fönstret räknas, och nästa som släpps igenom bär antalet. Loggraden berörs inte: allt syns fortfarande i Railway-loggen.
 * Tillståndet ligger i processen och nollställs vid omstart och vid `initSentry`.
 */
function throttleCriticalAlert(key: string, now: number): { send: true; suppressedSinceLast: number } | { send: false } {
  const entry = criticalThrottle.get(key);
  if (entry && now - entry.sentAt < CRITICAL_ALERT_THROTTLE_MS) {
    entry.suppressed += 1;
    return { send: false };
  }
  criticalThrottle.set(key, { sentAt: now, suppressed: 0 });
  return { send: true, suppressedSinceLast: entry?.suppressed ?? 0 };
}

/**
 * Kör `fn` med den inloggade användaren (bara id, aldrig namn eller e-post) på alla händelser som uppstår i den, i en EGEN
 * isolation scope. Användaren sätts aldrig på den globala scopen, så den kan inte hamna på en annan förfrågans händelser eller på
 * schedulers, oavsett i vilken async-kontext anroparen råkar köra (express.json() läser t.ex. bodyn i callbacks utanför
 * förfrågans kontext). authenticateJWT anropar den runt `next()`.
 */
export function withSentryUser<T>(userId: string | undefined, fn: () => T): T {
  if (!Sentry.isInitialized()) return fn();
  return Sentry.withIsolationScope((scope) => {
    scope.setUser(userId ? { id: userId } : null);
    return fn();
  });
}

/**
 * Express-felhanterare: rapporterar ett fel som nådde Express utan att en handler tog det (kastat i en route), bara om det är
 * ett serverfel (500 eller högre). Skickar felet vidare, så svaret blir detsamma som utan Sentry. Monteras sist i appen.
 */
export function installSentryErrorHandler(app: Pick<Express, 'use'>): void {
  app.use((error: unknown, _req: Request, _res: Response, next: NextFunction) => {
    if (Sentry.isInitialized()) {
      const status = statusOfExpressError(error);
      if (status >= 500 && !isExpectedClientStatus(status)) {
        Sentry.captureException(error, { mechanism: { type: 'auto.middleware.express', handled: false } });
      }
    }
    next(error);
  });
}

/** För `npm run sentry:test`: en enda testhändelse som syns i Sentry med miljötaggen. Returnerar händelse-id:t. */
export function captureTestEvent(): string {
  return Sentry.captureMessage('RunQuest backend sentry:test', {
    level: 'info',
    tags: { sentry_test: 'true' },
    fingerprint: ['sentry:test'],
  });
}
