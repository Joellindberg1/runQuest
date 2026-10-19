import { paths } from '@/paths';
import { resolveLegacyRedirect } from '@/app-shell/legacyRedirects';
import { resolveNextPath } from '@/app-shell/safeNext';
import { isLandingAddress } from './landingAddress';

/**
 * Dit en inloggad besökare skickas från lean landningen: samma adress som fullappens `pages/Index` ger (på `/` gamla `?tab=`-länkar och annars /board, på
 * `/login` `?next=`), med ett tillägg. Lean landningen lämnar över med en full sidladdning, så en adress som är landningen själv (`/login?next=/`) skulle
 * ladda om samma sida i en loop. Det gäller varje adress som ger landing.html (`/`, `/landing`, `/landing.html`, se landingAddress.ts). Den faller tillbaka på /board.
 */
export function signedInTarget(loginOpen: boolean, search: string): string {
  const target = loginOpen ? resolveNextPath(search) : resolveLegacyRedirect(search);
  return isLandingAddress(target) ? paths.board : target;
}
