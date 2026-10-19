import { paths } from '@/paths';

/** Filadresserna som Caddy löser till dist/landing.html via `try_files {path} {path}.html …`: filen själv och filen utan ändelse. */
export const LANDING_FILE_PATHS = ['/landing.html', '/landing'] as const;

const LANDING_PATHS: ReadonlySet<string> = new Set([paths.landing, ...LANDING_FILE_PATHS]);

/**
 * Är adressen landningen? `/` och varje adress som ger landing.html: Caddys `try_files` serverar filen också på `/landing.html` och `/landing`. Lean
 * routern lämnar allt annat över till fullappen med en omladdning, så en adress som ger landing.html men inte räknades hit vore en evig omladdningsloop.
 * Skiftläge och ett avslutande snedstreck spelar ingen roll (routern matchar så); fråga och fragment ignoreras.
 */
export function isLandingAddress(address: string): boolean {
  const { pathname } = new URL(address, 'http://localhost');
  return LANDING_PATHS.has(pathname.toLowerCase().replace(/(.)\/+$/, '$1'));
}
