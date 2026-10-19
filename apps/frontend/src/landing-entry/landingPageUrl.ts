import { paths } from '@/paths';
import { normalizePageUrl } from '@/shared/analytics/normalizePageUrl';
import { isLandingAddress } from './landingAddress';

/**
 * Adressen som lean ingången rapporterar till webbanalysen: fullappens normalisering (`normalizePageUrl`: routemönster, inga id:n, vitlistade utm_ på
 * landningen) med ett tillägg. Filadresserna som Caddy löser till landing.html (`/landing`, `/landing.html`) är landningen och rapporteras som `/`, inte som
 * en okänd sida; lean routern skriver om dem till `/` strax efter första ritningen, men sidvisningen ska inte hänga på att den hinner före väntetiden.
 */
export function landingPageUrl(pathname: string, search: string): string {
  return normalizePageUrl(isLandingAddress(pathname) ? paths.landing : pathname, search);
}
