export const LANDING_MARKER: string;
export const LOADER_MARKER: string;

export interface PrerenderOptions {
  /** Frontend-katalogen: den med vite.config.ts. */
  root: string;
  /** Katalogen med det byggda landing.html och index.html. */
  distDir: string;
  /** SSR-ingången relativt `root`; standard `src/landing-ssr.tsx`. Andra värden finns för test av bygg-vakterna. */
  ssrEntry?: string;
}

export function prerenderLanding(options: PrerenderOptions): Promise<void>;
