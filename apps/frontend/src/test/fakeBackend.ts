import type { User } from '@runquest/types';

// Ersätter backendApi-singletonen i skal-/routingtesterna. Varje anrop löser med det som
// `handlers[metod]` ger; omockade metoder svarar `{ success: false }` så att sidorna landar i
// sina fel-/tomlägen i stället för att krascha.

export const ME: User = {
  id: 'u-me',
  name: 'Joel Lindberg',
  total_xp: 5243,
  current_level: 24,
  total_km: 943,
  current_streak: 3,
  longest_streak: 9,
  wins: 1,
  draws: 0,
  losses: 0,
  challenge_active: false,
  challenge_counts: {},
  displayed_title_ids: [],
  gender: null,
  runs: [],
};

export const OTHER: User = { ...ME, id: 'u-karl', name: 'Karl Persson', total_xp: 5539, total_km: 988, current_streak: 0 };

type Handler = (...args: unknown[]) => unknown;

const EMPTY_CHALLENGES = {
  tokens: [], sent_challenge: null, received_challenges: [], boosts: [], history: [], group_active: [],
};

function defaultHandlers(): Record<string, Handler> {
  return {
    getUsersWithRuns: () => ({ success: true, data: [ME, OTHER] }),
    getGroupInfo: () => ({ success: true, data: { id: 'g1', name: 'Wolfpack', is_owner: false, members: [] } }),
    getEvents: () => ({ success: true, data: { events: [] } }),
    getEventsHistory: () => ({ success: true, data: { events: [] } }),
    getMyChallenges: () => ({ success: true, data: EMPTY_CHALLENGES }),
    getStravaStatus: () => ({ success: true, data: { connected: false, expired: false } }),
    getStravaLastSync: () => ({ success: true, data: { last_sync_attempt: null, last_sync_status: 'none', next_sync_estimated: null } }),
  };
}

export const handlers: Record<string, Handler> = defaultHandlers();

export function resetFakeBackend(): void {
  for (const key of Object.keys(handlers)) delete handlers[key];
  Object.assign(handlers, defaultHandlers());
}

const syncMethods: Record<string, Handler> = {
  isAuthenticated: () => false,
  getCurrentUser: () => null,
  getToken: () => null,
};

const fake = new Proxy({} as Record<string, unknown>, {
  get(target, prop: string) {
    if (prop in target) return target[prop];
    if (prop in syncMethods) return syncMethods[prop];
    return async (...args: unknown[]) => (handlers[prop] ?? (() => ({ success: false, error: 'not mocked' })))(...args);
  },
  set(target, prop: string, value) {
    target[prop] = value;
    return true;
  },
});

export const backendApiModule = { backendApi: fake, default: fake };
