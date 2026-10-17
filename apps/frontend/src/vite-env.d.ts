/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Sätts till "staging" på stagingtjänsten: bannern i UI:t och noindex/robots i bygget (vite.config.ts, stagingGuard.ts). Annars osatt. */
  readonly VITE_APP_ENV?: string;
  /** Bakas in av vite.config.ts (`runquest@<version>+<sha>`): felspårningens release, samma namn som källkartorna laddas upp under. */
  readonly VITE_SENTRY_RELEASE?: string;
}
