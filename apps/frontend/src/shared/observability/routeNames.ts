import { paths } from '@/paths';

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

const RUNNER_PREFIX = paths.runnerPattern.slice(0, paths.runnerPattern.indexOf(':'));

function pathOnly(address: string): string {
  const path = address.split(/[?#]/)[0] ?? '';
  return path.length > 1 ? path.replace(/\/$/, '') : path;
}

/** Routens namn för en adress: `/board`, `/runner/:id` eller `/(other)`. Tar bara sökvägen; query och fragment berörs inte. */
export function routeNameOf(address: string): string {
  const path = pathOnly(address);
  if (SHELL_PAGES.includes(path)) return path;
  if (path.startsWith(RUNNER_PREFIX)) {
    const id = path.slice(RUNNER_PREFIX.length);
    if (id.length > 0 && !id.includes('/')) return paths.runnerPattern;
  }
  return UNKNOWN_ROUTE;
}

/** Är adressen en sida i det inloggade skalet (där prestandan mäts)? Landning, inloggning, villkor och preview är det inte. */
export function isShellPath(address: string): boolean {
  return routeNameOf(address) !== UNKNOWN_ROUTE;
}
