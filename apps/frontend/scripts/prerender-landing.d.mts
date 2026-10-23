export const LANDING_MARKER: string;
export const LOADER_MARKER: string;
export const SESSION_HINT_MARKER: string;
export const LOADER_PHASE_MARKER: string;

/** Läget ur kommandoraden (`--mode x`, `--mode=x`, `-m x`), eller undefined. */
export function modeFromArgs(argv: string[]): string | undefined;

export interface PrerenderOptions {
  /** Frontend-katalogen: den med vite.config.ts. */
  root: string;
  /** Katalogen med det byggda landing.html och index.html. */
  distDir: string;
  /** SSR-ingången relativt `root`; standard `src/landing-ssr.tsx`. Andra värden finns för test av bygg-vakterna. */
  ssrEntry?: string;
  /** Läget klientbygget kördes i (`vite build --mode x`); standard `production`. */
  mode?: string;
}

export function prerenderLanding(options: PrerenderOptions): Promise<void>;
