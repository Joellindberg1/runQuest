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

/** Delvy-parametern för "send challenge"-sheeten (ADR 006 beslut 4). Konsumeras av DuelsScreen (features/challenges). */
export const SEND_PARAM = 'send';

/**
 * Förvald motståndare för send-sheeten. Runner cards Challenge-knapp navigerar till
 * `/duels?send=1&opponent=<userId>` (`duelsSendPath`); sheeten (DuelsScreen/SendSheet) läser `opponent` och förväljer
 * löparen. `send=1` ensamt = välj motståndare själv.
 * ADR 006 beslut 4 har samma form (flagga och värde separerade); sheeten validerar `opponent` mot gruppen.
 */
export const OPPONENT_PARAM = 'opponent';

/** /duels med send-sheeten öppen och (valfritt) en förvald motståndare. */
export const duelsSendPath = (opponentId?: string): string => {
  const params = new URLSearchParams({ [SEND_PARAM]: '1' });
  if (opponentId) params.set(OPPONENT_PARAM, opponentId);
  return `${paths.duels}?${params.toString()}`;
};

export const DEFAULT_LANDING_PATH = paths.board;
