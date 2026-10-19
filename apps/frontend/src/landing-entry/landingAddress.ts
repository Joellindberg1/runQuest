import { paths } from '@/paths';

/** Filadresserna som Caddy löser till dist/landing.html via `try_files {path} {path}.html …`: filen själv och filen utan ändelse. */
export const LANDING_FILE_PATHS = ['/landing.html', '/landing'] as const;

const LANDING_PATHS: ReadonlySet<string> = new Set([paths.landing, ...LANDING_FILE_PATHS]);

/**
 * Är adressen landningen? `/` och varje adress som ger landing.html: Caddys `try_files` serverar filen också på `/landing.html` och `/landing`. Lean
 * routern lämnar allt annat över till fullappen med en omladdning, så en adress som ger landing.html men inte räknades hit vore en evig omladdningsloop.
 * Skiftläge och ett avslutande snedstreck spelar ingen roll (routern matchar så); fråga och fragment ignoreras. Kastar aldrig: en adress som börjar med
 * `//` blir en värd om den ges till `new URL` som den är (`new URL('//', base)` kastar "Invalid URL"), så en sökväg byggs alltid på en fast värd, och en adress
 * som ändå inte går att tolka är inte landningen.
 */
export function isLandingAddress(address: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(address.startsWith('/') ? `http://localhost${address}` : address, 'http://localhost').pathname;
  } catch {
    return false;
  }
  return LANDING_PATHS.has(pathname.toLowerCase().replace(/(.)\/+$/, '$1'));
}
