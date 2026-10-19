// Gemensam matchningskärna för adresser som ska bli ett routemönster (`/runner/:id`) och aldrig den riktiga adressen. Webbanalysen
// (shared/analytics/normalizePageUrl.ts) och prestandaspårningen (shared/observability/routeNames.ts) anropar den med var sin lista
// mönster och lägger själva på hanteringen av okända adresser. Ren funktion: ingen import av analys- eller Sentry-kod.
//
// Matchningen följer routern: skiftläget spelar ingen roll, och ett avslutande eller dubblerat snedstreck ignoreras. Ett `:namn`-segment
// matchar exakt ett icke-tomt segment. Det som returneras är alltid ett av mönstren som skickades in, så en adress med ett id kan inte komma ut.

const segmentsOf = (path: string): string[] => path.split('/').filter((segment, index) => index === 0 || segment !== '');

function matches(patternSegments: readonly string[], pathSegments: readonly string[]): boolean {
  if (patternSegments.length !== pathSegments.length) return false;
  return patternSegments.every((segment, index) => segment.startsWith(':') || segment === pathSegments[index]);
}

/**
 * Bygger en matchare för listan `patterns`. Fasta mönster prövas före dynamiska, så att en fast sida alltid går före ett dynamiskt
 * mönster som skulle kunna täcka den. Matcharen tar bara sökvägen (inga query eller fragment) och ger mönstret, eller `undefined`
 * om adressen inte börjar med `/` eller inte matchar något mönster.
 */
export function createRouteMatcher(patterns: readonly string[]): (pathname: string) => string | undefined {
  const ordered = [...patterns]
    .sort((a, b) => Number(a.includes(':')) - Number(b.includes(':')))
    .map((pattern) => ({ pattern, segments: segmentsOf(pattern) }));
  return (pathname) => {
    if (!pathname.startsWith('/')) return undefined;
    const pathSegments = segmentsOf(pathname.toLowerCase());
    return ordered.find((candidate) => matches(candidate.segments, pathSegments))?.pattern;
  };
}
