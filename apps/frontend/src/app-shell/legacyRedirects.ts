import { paths } from '@/paths';

/** Gamla flikar → ny route. Exporteras för sessionstipset i landing.html (landing-entry/sessionHint.ts), som bäddar in samma tabell. */
export const TAB_TARGETS: Readonly<Record<string, string>> = {
  leaderboard: paths.board,
  titles: paths.titles,
  profile: paths.profile,
  'log-run': paths.log,
};

/** Egna nycklar bara: `constructor`, `toString` och `__proto__` finns på varje objekt och är inga flikar. */
const targetForTab = (tab: string | null): string | undefined =>
  tab !== null && Object.prototype.hasOwnProperty.call(TAB_TARGETS, tab) ? TAB_TARGETS[tab] : undefined;

/**
 * Gamla `/?tab=…` → ny route. Övriga sökparametrar bevaras, `tab` tas bort; okänd/saknad flik → /board.
 */
export function resolveLegacyRedirect(search: string): string {
  const params = new URLSearchParams(search);
  const tab = params.get('tab');
  params.delete('tab');

  const target = targetForTab(tab) ?? paths.board;
  const rest = params.toString();
  return rest ? `${target}?${rest}` : target;
}

/** `/challenges` → `/duels`, med sökparametrarna intakta. */
export function legacyChallengesTarget(search: string): string {
  return `${paths.duels}${search}`;
}
