import * as Sentry from '@sentry/react';
import { DEFAULT_TRACES_SAMPLE_RATE, clampTracesSampleRate } from '@runquest/shared';
import { isShellPath, routeNameOf } from './routeNames';
import { collectStorageValues, scrubSentryEvent } from './scrubSentryEvent';
import { scrubSpanJson, scrubTransaction } from './scrubTransaction';

// Enda filen som importerar @sentry/* (ESLint-regeln i eslint.config.js). Den laddas bara via dynamisk import från errorReporting.ts.
// Inställningarna är medvetet snåla: inga standard-PII (se dataCollection nedan), ingen session replay och inga extra integrationer
// utöver webbvärdena. Standardintegrationerna (globala fel- och unhandledrejection-hanterare, brödsmulor) körs genom beforeSend.
//
// Webbvärden (RUN-287): LCP, CLS, FCP och TTFB hör till sidladdningen och INP till hela besöket. Allt mäts först efter inloggning,
// eftersom den här filen bara laddas när skalet monterar; landningen mäts av Lighthouse (RUN-259).
//  - Sidladdningen mäts bara om dokumentet laddades på en skalsida och appen fortfarande står kvar där. Annars var det landningen
//    (eller inloggningen) som laddades, och dess LCP ska inte skrivas på /board.
//  - Inga navigationer, inga anrop och inga resurser spåras (instrumentNavigation/traceFetch/traceXHR av): sidbyten är inga nya
//    sidladdningar, och API-anropen ska inte bära headers eller hamna i en rapport.
//  - `tracePropagationTargets: []`: SDK:t lägger annars `sentry-trace` och `baggage` på anrop till den egna origin, vilket skulle
//    skicka metadata till backend och göra Sentrys id till en del av varje förfrågan. Ändra det aldrig utan att läsa RUN-287.
//  - `traceLifecycle: 'static'`: klassiska transaktioner (en per sidladdning); transaktionen går genom scrubTransaction.

export interface SentryStartOptions {
  dsn: string;
  environment: string;
  /** Andelen sidladdningar som mäts. Aldrig över taket i packages/shared; saknas den används standarden. */
  tracesSampleRate?: number;
  /** Adressens sökväg när dokumentet laddades (före inloggningen). Saknas den mäts ingen sidladdning. */
  documentPath?: string;
  /** Ersätter nätverkstransporten (tester fångar kuvertet i stället för att skicka det). */
  transport?: Sentry.BrowserOptions['transport'];
}

const trimmedPath = (address: string): string => (address.split(/[?#]/)[0] ?? '').replace(/\/$/, '');

export function startSentry({ dsn, environment, tracesSampleRate, documentPath, transport }: SentryStartOptions): (error: unknown, context?: Record<string, unknown>) => void {
  const currentPath = window.location.pathname;
  const measurePageLoad = documentPath !== undefined && isShellPath(documentPath) && trimmedPath(documentPath) === trimmedPath(currentPath);

  Sentry.init({
    dsn,
    environment,
    // @sentry/react 11 har tagit bort sendDefaultPii; dess ersättare dataCollection har PÅ som standard för användare, cookies, headers och
    // query. Allt stängs uttryckligen, vilket är vad sendDefaultPii: false betydde i 10. beforeSend är andra försvarslinjen.
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    beforeSend: (event) => scrubSentryEvent(event, collectStorageValues(window.localStorage)),
    tracesSampleRate: clampTracesSampleRate(tracesSampleRate ?? DEFAULT_TRACES_SAMPLE_RATE),
    traceLifecycle: 'static',
    tracePropagationTargets: [],
    integrations: [
      Sentry.browserTracingIntegration({
        instrumentPageLoad: measurePageLoad,
        instrumentNavigation: false,
        instrumentBfcacheRestore: false,
        traceFetch: false,
        traceXHR: false,
        enableHTTPTimings: false,
        enableLongTask: false,
        enableLongAnimationFrame: false,
        enableInp: true,
        linkPreviousTrace: 'off',
        beforeStartSpan: (span) => ({ ...span, name: routeNameOf(window.location.pathname) }),
      }),
    ],
    beforeSendTransaction: (event) => scrubTransaction(event, collectStorageValues(window.localStorage)),
    // Gäller också INP, som skickas som en egen span utanför sidladdningen och får namnet på sidan som är öppen när den skickas.
    beforeSendSpan: Sentry.withStaticSpan((span) => scrubSpanJson(span, window.location.pathname)),
    ...(transport ? { transport } : {}),
  });
  // SDK:t skriver sidans råa sökväg som transaktionsnamn på scopen när en sidladdning startar, och det följer då med varje felrapport,
  // även en från en annan sida. Felrapporterna ska se ut som före RUN-287 (inget transaktionsnamn), så det tas bort.
  Sentry.getCurrentScope().setTransactionName(undefined);

  return (error, context) => {
    Sentry.captureException(error instanceof Error ? error : new Error(String(error)), { extra: { ...context } });
  };
}
