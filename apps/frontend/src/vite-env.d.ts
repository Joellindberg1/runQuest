/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Sätts till "staging" på stagingtjänsten: bannern i UI:t och noindex/robots i bygget (vite.config.ts, stagingGuard.ts). Annars osatt. */
  readonly VITE_APP_ENV?: string;
  /** Bakas in av vite.config.ts (`runquest@<version>+<sha>`): felspårningens release, samma namn som källkartorna laddas upp under. */
  readonly VITE_SENTRY_RELEASE?: string;
  /** Umami-webbplatsens id (inte hemligt). Sätts bara på prodtjänsten; saknas den laddas inget skript och inget skickas (staging, lokalt, CI). Se src/shared/analytics. */
  readonly VITE_UMAMI_WEBSITE_ID?: string;
}
