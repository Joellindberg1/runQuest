import { paths } from '@/paths';

// Adressen som skickas till webbanalysen. Stravas API-policy förbjuder analys på Strava-data och ägarbeslutet 2026-10-16 går längre: inga id:n,
// inga namn, inget som pekar ut en person. Därför skickas aldrig den riktiga adressen utan routens mönster (`/runner/:id`), och bara ett fast
// antal adresser kan över huvud taget uppstå: skalets och de publika sidorna (`paths`), `/runner/:id` och en enda etikett för allt annat.
//
// Ingen import av någon Umami-kod här: filen är ren och prövas ensam.

/** Etiketten för en adress som inte är en känd sida (404-sidan eller en adress som inte finns). Aldrig adressen själv. */
export const NOT_FOUND_PAGE = '/(not-found)';

// Umami läser kampanjerna ur query-strängen i den skickade adressen (utm_source m.fl.); utan dem blir kampanjvyn tom. De behålls därför
// bara på landningen, dit inkommande kampanjlänkar pekar. Appens egna adresser bär aldrig några, och resten av query-strängen
// (next, opponent, token, id …) kan bära id eller personuppgifter och tas alltid bort.
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;
const MAX_UTM_LENGTH = 64;
const PLAIN_TAG = /^[A-Za-z0-9._~+-]+$/;
const UUID_SHAPE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// Alla adresser i `paths` som är strängar. Fasta adresser först, så att en fast sida alltid går före ett dynamiskt mönster som skulle kunna täcka den.
const routePatterns: readonly string[] = (Object.values(paths).filter((value) => typeof value === 'string') as string[])
  .sort((a, b) => Number(a.includes(':')) - Number(b.includes(':')));

const segmentsOf = (path: string): string[] => path.split('/').filter((segment, index) => index === 0 || segment !== '');

function matches(pattern: string, path: string): boolean {
  const patternSegments = segmentsOf(pattern);
  const pathSegments = segmentsOf(path.toLowerCase());
  if (patternSegments.length !== pathSegments.length) return false;
  return patternSegments.every((segment, index) => segment.startsWith(':') || segment === pathSegments[index]);
}

function utmQuery(search: string): string {
  const incoming = new URLSearchParams(search.split('#')[0]);
  const kept = new URLSearchParams();
  for (const key of UTM_KEYS) {
    const value = incoming.get(key)?.trim() ?? '';
    if (value.length > 0 && value.length <= MAX_UTM_LENGTH && PLAIN_TAG.test(value) && !UUID_SHAPE.test(value)) kept.set(key, value);
  }
  const query = kept.toString();
  return query ? `?${query}` : '';
}

/**
 * Adressen som skickas till webbanalysen för en sida: routens mönster, utan id, query eller fragment. På landningen behålls enbart
 * `utm_`-kampanjerna med enkla taggvärden. Okända adresser blir `NOT_FOUND_PAGE`.
 */
export function normalizePageUrl(pathname: string, search: string): string {
  if (!pathname.startsWith('/')) return NOT_FOUND_PAGE;
  const pattern = routePatterns.find((candidate) => matches(candidate, pathname));
  if (!pattern) return NOT_FOUND_PAGE;
  return pattern === paths.landing ? `${pattern}${utmQuery(search)}` : pattern;
}
