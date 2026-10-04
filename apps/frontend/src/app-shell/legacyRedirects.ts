import { paths } from '@/paths';

const TAB_TARGETS: Record<string, string> = {
  leaderboard: paths.board,
  titles: paths.titles,
  profile: paths.profile,
  'log-run': paths.log,
};

/**
 * Gamla `/?tab=…` → ny route. Övriga sökparametrar bevaras, `tab` tas bort; okänd/saknad flik → /board.
 */
export function resolveLegacyRedirect(search: string): string {
  const params = new URLSearchParams(search);
  const tab = params.get('tab');
  params.delete('tab');

  const target = (tab && TAB_TARGETS[tab]) || paths.board;
  const rest = params.toString();
  return rest ? `${target}?${rest}` : target;
}

/** `/challenges` → `/duels`, med sökparametrarna intakta. */
export function legacyChallengesTarget(search: string): string {
  return `${paths.duels}${search}`;
}
