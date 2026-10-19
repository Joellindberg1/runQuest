import { paths } from '@/paths';
import { resolveLegacyRedirect } from '@/app-shell/legacyRedirects';
import { resolveNextPath } from '@/app-shell/safeNext';

const isLandingAddress = (address: string): boolean => new URL(address, window.location.origin).pathname === paths.landing;

/**
 * Dit en inloggad besökare skickas från lean landningen: samma adress som fullappens `pages/Index` ger (på `/` gamla `?tab=`-länkar och annars /board, på
 * `/login` `?next=`), med ett tillägg. Lean landningen lämnar över med en full sidladdning, så en adress som är landningen själv (`/login?next=/`) skulle
 * ladda om samma sida i en loop. Den faller tillbaka på /board.
 */
export function signedInTarget(loginOpen: boolean, search: string): string {
  const target = loginOpen ? resolveNextPath(search) : resolveLegacyRedirect(search);
  return isLandingAddress(target) ? paths.board : target;
}
