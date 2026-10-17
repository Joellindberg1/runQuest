/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Sätts till "staging" på stagingtjänsten: bannern i UI:t och noindex/robots i bygget (vite.config.ts, stagingGuard.ts). Annars osatt. */
  readonly VITE_APP_ENV?: string;
}
