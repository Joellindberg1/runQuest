import { paths } from '@/paths';
import { createRouteMatcher } from '@/shared/utils/routeMatcher';

// Sidnamn för prestandaspårningen: samma princip som sidnamnen i Umami. Ett namn visar vilken sida det var, aldrig vems. Därför
// finns det bara ett fast antal namn: skalets sidor (`paths`) och `/runner/:id`. Allt annat får ett enda namn, så en adress med ett
// id kan aldrig hamna i ett transaktionsnamn.
//
// Ingen import av @sentry/* här: filen är ren och används av både felspårningens lätta ingång och dess lata chunk.

/** Namnet på en adress som inte är en känd skalsida. */
export const UNKNOWN_ROUTE = '/(other)';

// Skalets sidor, i samma ordning som i routes.tsx. routeNames.test.ts går igenom `paths` och fäller en ny sida som saknas här.
const SHELL_PAGES: readonly string[] = [
  paths.board, paths.titles, paths.duels, paths.events, paths.news, paths.log, paths.profile, paths.badges,
  paths.playbook, paths.features, paths.settings, paths.admin,
];

// Matchningen delas med Umami-sidnamnen (shared/utils/routeMatcher.ts) och följer routern: skiftläget och ett avslutande eller dubblerat
// snedstreck spelar ingen roll. Före den delade kärnan var routenamnen skiftlägeskänsliga och `/Board` blev `/(other)`; nu får den
// samma namn som `/board`. Skillnaden gör bara att färre adresser hamnar under det okända namnet, och namnet är fortfarande alltid ett
// av mönstren ovan, aldrig adressen.
const matchShellRoute = createRouteMatcher([...SHELL_PAGES, paths.runnerPattern]);

function pathOnly(address: string): string {
  return address.split(/[?#]/)[0] ?? '';
}

/** Routens namn för en adress: `/board`, `/runner/:id` eller `/(other)`. Tar bara sökvägen; query och fragment berörs inte. */
export function routeNameOf(address: string): string {
  return matchShellRoute(pathOnly(address)) ?? UNKNOWN_ROUTE;
}

/** Är adressen en sida i det inloggade skalet (där prestandan mäts)? Landning, inloggning, villkor och preview är det inte. */
export function isShellPath(address: string): boolean {
  return routeNameOf(address) !== UNKNOWN_ROUTE;
}
