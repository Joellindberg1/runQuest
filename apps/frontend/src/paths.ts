// Alla route-paths på ett ställe (ADR 006 beslut 2). Inga path-strängar i komponenter.
export const paths = {
  /** Landing för utloggade (ADR 006 beslut 1). */
  landing: '/',
  /** Landing med inloggningsdialogen öppen (ADR 006 beslut 1, addendum 2026-10-11): adressen speglar att dialogen är öppen. */
  login: '/login',
  /** Integritet och villkor, publik (RUN-204). */
  legal: '/legal',
  board: '/board',
  titles: '/titles',
  duels: '/duels',
  events: '/events',
  news: '/news',
  log: '/log',
  profile: '/profile',
  badges: '/badges',
  runnerPattern: '/runner/:id',
  runner: (id: string) => `/runner/${encodeURIComponent(id)}`,
  playbook: '/playbook',
  features: '/features',
  settings: '/settings',
  admin: '/admin',
  previewBoard: '/preview',
  previewDuels: '/preview/challenges',
  previewBadges: '/preview/badges',
  /** Gamla adressen som redirectas till `duels` (ADR 006 beslut 7). */
  legacyChallenges: '/challenges',
} as const;

/** Ankare på /legal (RUN-204): integritetsdelen och villkoren. */
export const LEGAL_PRIVACY_ID = 'privacy';
export const LEGAL_TERMS_ID = 'terms';
export const legalPrivacyPath = `${paths.legal}#${LEGAL_PRIVACY_ID}`;
export const legalTermsPath = `${paths.legal}#${LEGAL_TERMS_ID}`;

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

/**
 * Router-state som Landingens Sign in-länk skickar med till `/login`: dialogen öppnades ovanpå Landing, som ligger ett
 * steg bakåt i historiken. Då är stängning = Back (adressen och historiken stämmer); utan flaggan (direktladdad
 * `/login`, redirect från RequireAuth) ersätts adressen med `/`.
 */
export const FROM_LANDING_STATE = { fromLanding: true } as const;

export const isFromLanding = (state: unknown): boolean => (state as { fromLanding?: unknown } | null)?.fromLanding === true;
