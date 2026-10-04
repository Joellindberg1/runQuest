// Alla route-paths på ett ställe (ADR 006 beslut 2). Inga path-strängar i komponenter.
export const paths = {
  login: '/login',
  board: '/board',
  titles: '/titles',
  duels: '/duels',
  events: '/events',
  news: '/news',
  log: '/log',
  profile: '/profile',
  runnerPattern: '/runner/:id',
  runner: (id: string) => `/runner/${encodeURIComponent(id)}`,
  playbook: '/playbook',
  features: '/features',
  settings: '/settings',
  admin: '/admin',
  previewBoard: '/preview',
  previewDuels: '/preview/challenges',
  /** Gamla adressen som redirectas till `duels` (ADR 006 beslut 7). */
  legacyChallenges: '/challenges',
} as const;

/** Delvy-parametern för "send challenge"-sheeten (ADR 006 beslut 4). Konsumeras av Duels i inkrement 5. */
export const SEND_PARAM = 'send';

export const DEFAULT_LANDING_PATH = paths.board;
