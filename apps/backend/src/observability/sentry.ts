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
 *  - Användaren (`setSentryUser`, bara id) hålls isär mellan förfrågningar av SDK:ns egen HTTP-integration, som ger varje
 *    inkommande förfrågan en egen scope även utan `--import`. Testet "does not let one request's user leak..." vaktar det.
 *  - Allt som skickas går först genom `scrubSentryEvent` (scrub.ts): inga tokens, headers, bodies, namn eller e-post.
 *
 * Stabilt gränssnitt för larm som bygger vidare på detta: `captureLoggedError` är den enda platsen där en loggrad blir en händelse.
 * Vill ett larm ha egen nivå eller tagg (t.ex. rader med prefixet "🚨 KRITISKT") ändras det där, på ett ställe.
 */
import * as Sentry from '@sentry/node';
import type { Express, NextFunction, Request, Response } from 'express';
import { setErrorSink } from '../utils/logger.js';
import { fingerprintOf, isDroppedBreadcrumb, isExpectedClientStatus, scrubSentryEvent, secretsFromEnv, statusOfLoggedArgs } from './scrub.js';

const MAX_DETAIL_LENGTH = 300;

/**
 * SDK 11 har tagit bort `sendDefaultPii`; `dataCollection` ersätter det, och dess standardvärden samlar ALLT (användaruppgifter,
 * cookies, headers, bodies, query-parametrar, lokala variabler i stacktraces). Här stängs varje kategori uttryckligen.
 * Kvar är det som gör ett fel läsbart: typ, meddelande, stacktrace med några rader källkod runt varje ram.
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
} satisfies Sentry.NodeOptions['dataCollection'];

export interface InitSentryTestOptions {
  /** Ersätter nätverkstransporten (tester fångar kuvertet i stället för att skicka det). */
  transport?: Sentry.NodeOptions['transport'];
  /** `false` hoppar över hanterarna för unhandledRejection/uncaughtException (de testas i en egen process). Standard: true. */
  processHandlers?: boolean;
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
    ...(testOptions.transport ? { transport: testOptions.transport } : {}),
    integrations: (defaults) => defaults
      // Konsolrader bär namn och annat som inte ska med; breadcrumbs behövs inte för att hitta felet.
      .filter((i) => i.name !== 'Console')
      .filter((i) => withProcessHandlers || (i.name !== 'OnUncaughtException' && i.name !== 'OnUnhandledRejection'))
      // Standardläget "warn" sväljer ett oväntat löftesavslag. "strict" fångar det och kraschar processen som Node gör utan Sentry.
      .map((i) => (i.name === 'OnUnhandledRejection' ? Sentry.onUnhandledRejectionIntegration({ mode: 'strict' }) : i)),
    beforeSend: (event) => scrubSentryEvent(event, secrets),
    beforeBreadcrumb: (breadcrumb) => (isDroppedBreadcrumb(breadcrumb) ? null : breadcrumb),
  });

  setErrorSink(captureLoggedError);
  return true;
}

/** Stänger klienten och kopplar loss loggern (tester, och ordnad nedstängning). */
export async function closeSentry(): Promise<void> {
  setErrorSink(null);
  await Sentry.close(2000);
}

/** Väntar tills köade händelser är skickade, så en process som är på väg att avslutas inte tappar dem. */
export async function flushSentry(timeoutMs = 2000): Promise<boolean> {
  return Sentry.isInitialized() ? Sentry.flush(timeoutMs) : true;
}

function loggedDetail(args: readonly unknown[]): unknown {
  const first = args.find((a) => a !== undefined);
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
 * Förväntade klientfel (401/403/404/429, JWT-fel) skickas inte.
 */
export function captureLoggedError(message: string, args: readonly unknown[]): void {
  if (!Sentry.isInitialized()) return;

  const status = statusOfLoggedArgs(args);
  if (status !== undefined && isExpectedClientStatus(status)) return;

  const error = args.find((a): a is Error => a instanceof Error);
  if (error) {
    Sentry.captureException(error, { extra: { log_message: message } });
    return;
  }
  const detail = loggedDetail(args);
  Sentry.captureMessage(message, {
    level: 'error',
    fingerprint: [fingerprintOf(message)],
    ...(detail !== undefined ? { extra: { log_detail: detail } } : {}),
  });
}

/** Identifierar den inloggade användaren mot händelser i den här förfrågan: bara id, aldrig namn eller e-post. */
export function setSentryUser(userId: string | undefined): void {
  if (!Sentry.isInitialized()) return;
  Sentry.setUser(userId ? { id: userId } : null);
}

/**
 * Express-felhanterare: rapporterar ett fel som nådde Express utan att en handler tog det (kastat i en route), bara om det är
 * ett serverfel (500 eller högre). Skickar felet vidare, så svaret blir detsamma som utan Sentry. Monteras sist i appen.
 */
export function installSentryErrorHandler(app: Pick<Express, 'use'>): void {
  app.use((error: unknown, _req: Request, _res: Response, next: NextFunction) => {
    if (Sentry.isInitialized()) {
      const status = statusOfLoggedArgs([error]) ?? 500;
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
