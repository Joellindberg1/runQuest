import { paths } from '@/paths';
import { createRouteMatcher } from '@/shared/utils/routeMatcher';
import { allowedUtmQuery } from './utmAllowlist';

// Adressen som skickas till webbanalysen. Stravas API-policy förbjuder analys på Strava-data och ägarbeslutet 2026-10-16 går längre: inga id:n,
// inga namn, inget som pekar ut en person. Därför skickas aldrig den riktiga adressen utan routens mönster (`/runner/:id`), och bara ett fast
// antal adresser kan över huvud taget uppstå: skalets och de publika sidorna (`paths`), `/runner/:id` och en enda etikett för allt annat.
//
// Ingen import av någon Umami-kod här: filen är ren och prövas ensam.

/** Etiketten för en adress som inte är en känd sida (404-sidan eller en adress som inte finns). Aldrig adressen själv. */
export const NOT_FOUND_PAGE = '/(not-found)';

// Umami läser kampanjerna ur query-strängen i den skickade adressen (utm_source m.fl.); utan dem blir kampanjvyn tom. De behålls därför
// bara på landningen, dit inkommande kampanjlänkar pekar, och bara de värden som står på vitlistan (utmAllowlist.ts). Appens egna adresser
// bär aldrig några, och resten av query-strängen (next, opponent, token, id …) kan bära id eller personuppgifter och tas alltid bort.

// Alla adresser i `paths` som är strängar. Matchningen (skiftlägesokänslig som routern, fasta adresser före dynamiska) ligger i den gemensamma kärnan.
const pathValues: readonly unknown[] = Object.values(paths);
const matchRoute = createRouteMatcher(pathValues.filter((value): value is string => typeof value === 'string'));

/**
 * Adressen som skickas till webbanalysen för en sida: routens mönster, utan id, query eller fragment. På landningen behålls enbart
 * vitlistade `utm_`-värden (utmAllowlist.ts). Okända adresser blir `NOT_FOUND_PAGE`.
 */
export function normalizePageUrl(pathname: string, search: string): string {
  const pattern = matchRoute(pathname);
  if (!pattern) return NOT_FOUND_PAGE;
  return pattern === paths.landing ? `${pattern}${allowedUtmQuery(search)}` : pattern;
}
