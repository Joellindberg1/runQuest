import * as Sentry from '@sentry/react';
import { collectStorageValues, scrubSentryEvent } from './scrubSentryEvent';

// Enda filen som importerar @sentry/* (ESLint-regeln i eslint.config.js). Den laddas bara via dynamisk import från errorReporting.ts.
// Inställningarna är medvetet snåla: inga standard-PII (se dataCollection nedan), ingen tracing eller Web Vitals (egen story), ingen session replay och inga
// extra integrationer. Standardintegrationerna (globala fel- och unhandledrejection-hanterare, brödsmulor) körs genom beforeSend.

interface SentryStartOptions {
  dsn: string;
  environment: string;
  /** Bygget bakar in namnet (vite.config.ts); källkartorna är uppladdade under samma. Utan det symboliseras inga stackar. */
  release?: string;
}

export function startSentry({ dsn, environment, release }: SentryStartOptions): (error: unknown, context?: Record<string, unknown>) => void {
  Sentry.init({
    dsn,
    environment,
    release,
    // @sentry/react 11 har tagit bort sendDefaultPii; dess ersättare dataCollection har PÅ som standard för användare, cookies, headers och
    // query. Allt stängs uttryckligen, vilket är vad sendDefaultPii: false betydde i 10. beforeSend är andra försvarslinjen.
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    beforeSend: (event) => scrubSentryEvent(event, collectStorageValues(window.localStorage)),
  });

  return (error, context) => {
    Sentry.captureException(error instanceof Error ? error : new Error(String(error)), { extra: { ...context } });
  };
}
