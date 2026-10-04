import { paths } from '@/paths';

export type BottomTab = 'ranks' | 'titles' | 'duels' | 'you';
export type NavDestination =
  | 'board' | 'titles' | 'duels' | 'events'
  | 'profile' | 'log' | 'playbook' | 'features'
  | 'settings' | 'admin' | 'news' | 'runner';

const FIRST_SEGMENT_TO_DESTINATION: Record<string, NavDestination> = {
  board: 'board',
  titles: 'titles',
  duels: 'duels',
  events: 'events',
  profile: 'profile',
  log: 'log',
  playbook: 'playbook',
  features: 'features',
  settings: 'settings',
  admin: 'admin',
  news: 'news',
  runner: 'runner',
};

// Samma mappning som prototypens backMap (ADR 006 beslut 2).
const DESTINATION_TO_TAB: Record<NavDestination, BottomTab> = {
  board: 'ranks',
  runner: 'ranks',
  events: 'ranks',
  titles: 'titles',
  duels: 'duels',
  profile: 'you',
  log: 'you',
  news: 'you',
  playbook: 'you',
  features: 'you',
  settings: 'you',
  admin: 'you',
};

export function destinationFor(pathname: string): NavDestination | null {
  const first = pathname.split('/').filter(Boolean)[0];
  return (first && FIRST_SEGMENT_TO_DESTINATION[first]) || null;
}

/** Bottenbarens aktiva flik ur pathname. `null` för okända adresser (ingen flik lyser). */
export function activeTabFor(pathname: string): BottomTab | null {
  const destination = destinationFor(pathname);
  return destination ? DESTINATION_TO_TAB[destination] : null;
}

/** Sidnavens aktiva rad. Runner card hör till Leaderboard; settings/admin/news har ingen rad. */
export function activeSideNavItemFor(pathname: string): NavDestination | null {
  const destination = destinationFor(pathname);
  if (destination === 'runner') return 'board';
  if (destination === 'settings' || destination === 'admin' || destination === 'news') return null;
  return destination;
}

export const TAB_TARGETS: Record<BottomTab, string> = {
  ranks: paths.board,
  titles: paths.titles,
  duels: paths.duels,
  you: paths.profile,
};
