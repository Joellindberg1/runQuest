import type { User } from '@runquest/types';
import type { HeadToHeadResponse, RankDeltaResponse, WeekLeaderboardResponse, XpConfigResponse } from '@runquest/shared';

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

// Svarsformerna följer packages/shared/src/contracts (ADR 007) — typerna håller fixturerna ärliga.
const WEEK_DATES = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'];
const weekDays = (kms: number[]) =>
  kms.map((km, i) => ({ date: WEEK_DATES[i], km, xp: km * 6, runs: km > 0 ? 1 : 0 }));

export const WEEK: WeekLeaderboardResponse = {
  week: { start: '2026-09-28', end: '2026-10-04', previous_start: '2026-09-21', is_current: true, today: '2026-10-04' },
  users: [
    {
      user_id: OTHER.id, name: OTHER.name, profile_picture: null, level: 24, km: 31, runs: 4, xp: 186,
      days: weekDays([0, 12, 6, 0, 8, 5, 0]),
      rank: 1, previous_rank: 2, rank_delta: 1,
    },
    {
      user_id: ME.id, name: ME.name, profile_picture: null, level: 24, km: 10, runs: 1, xp: 60,
      days: weekDays([0, 0, 0, 0, 10, 0, 0]),
      rank: 2, previous_rank: 1, rank_delta: -1,
    },
  ],
  totals: { km: 148.6, runs: 21, xp: 900, active_runners: 5, members: 6, best_week_km: 181, pct_of_best_week: 82 },
  mover: { user_id: OTHER.id, rank_delta: 1 },
};

export const RANK_DELTA: RankDeltaResponse = {
  as_of: '2026-09-28',
  users: [
    { user_id: OTHER.id, xp: OTHER.total_xp, rank: 1, previous_xp: 5300, previous_rank: 2, rank_delta: 1 },
    { user_id: ME.id, xp: ME.total_xp, rank: 2, previous_xp: 5200, previous_rank: 1, rank_delta: -1 },
  ],
};

// Trappan är medvetet INTE produktionens (5 d → 1.1× …): vyerna ska läsa den ur config-endpointen.
export const XP_CONFIG: XpConfigResponse = {
  settings: { base_xp: 15, xp_per_km: 2, bonus_5km: 5, bonus_10km: 15, bonus_15km: 25, bonus_20km: 50, min_run_distance: 1 },
  streak_multipliers: [
    { days: 3, multiplier: 1.3 }, { days: 7, multiplier: 1.5 }, { days: 14, multiplier: 1.8 }, { days: 21, multiplier: 2 },
  ],
};

// Inga utmaningar mellan paret ännu (Runner card, inkrement 3).
export const HEAD_TO_HEAD_EMPTY: HeadToHeadResponse = {
  opponent: { id: OTHER.id, name: OTHER.name, profile_picture: null },
  record: { wins: 0, draws: 0, losses: 0, total: 0 },
  history: [],
  active: null,
};

type Handler = (...args: unknown[]) => unknown;

const EMPTY_CHALLENGES = {
  tokens: [], sent_challenge: null, received_challenges: [], boosts: [], history: [], group_active: [],
};

function defaultHandlers(): Record<string, Handler> {
  return {
    getUsersWithRuns: () => ({ success: true, data: [ME, OTHER] }),
    getWeekLeaderboard: () => ({ success: true, data: WEEK }),
    getRankDelta: () => ({ success: true, data: RANK_DELTA }),
    getXpConfig: () => ({ success: true, data: XP_CONFIG }),
    getHeadToHead: () => ({ success: true, data: HEAD_TO_HEAD_EMPTY }),
    getUserTitles: () => ({ success: true, data: [] }),
    getTitleLeaderboard: () => ({ success: true, data: [] }),
    getGroupInfo: () => ({ success: true, data: { id: 'g1', name: 'Wolfpack', is_owner: false, members: [] } }),
    getEventList: () => ({ success: true, data: { events: [] } }),
    getEventHistoryPage: () => ({ success: true, data: { events: [], meta: { total: 0, limit: 6, offset: 0, has_more: false } } }),
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
