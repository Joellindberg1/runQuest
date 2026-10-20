import type { backendApi } from './backendApi';

// En rad per publik, inloggad metod hos klienten: vad den skickar till servern och vad den lämnar vidare. Delas av testerna för
// anropens form (backendApi.requests.test.ts), sessionsutgången (backendApi.request.test.ts) och bas-URL:en, så att en ny metod läggs till på ett ställe.

export const TOKEN = 'tok-123';
export const AUTH = { Authorization: `Bearer ${TOKEN}` };
export const AUTH_JSON = { ...AUTH, 'Content-Type': 'application/json' };

export interface CallRow {
  name: string;
  call: () => Promise<unknown>;
  path: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
  /** Svaret som servern ger vid 2xx och det klienten lämnar vidare. */
  okBody: unknown;
  okResult: unknown;
  /** Texten klienten ger när ett 500-svar saknar `error`. */
  fallback: string;
}

const DATA = { k: 1 };
const envelope = { success: true, data: DATA, message: 'msg' };
const wholeBody = { success: true, foo: 1 };
// Steg 1 av kuvertbytet (ADR 007 Addendum 2026-10-20): svar med nyttolast utanför data bär data bredvid de gamla nycklarna.
const messageOnly = { success: true, message: 'msg', data: null };
const status = { connected: true, expired: false };
const meta = { total: 1, limit: 5, offset: 0, has_more: false };

export function callRows(api: typeof backendApi): CallRow[] {
  return [
    { name: 'changePassword', call: () => api.changePassword('old', 'new'), path: '/auth/change-password', method: 'POST', headers: AUTH_JSON,
      body: { currentPassword: 'old', newPassword: 'new' }, okBody: messageOnly, okResult: { success: true, message: 'msg' }, fallback: 'Password change failed' },
    { name: 'getAllUsers', call: () => api.getAllUsers(), path: '/auth/users', method: 'GET', headers: AUTH_JSON,
      okBody: envelope, okResult: { success: true, data: DATA }, fallback: 'Failed to fetch users' },
    { name: 'getUsersWithRuns', call: () => api.getUsersWithRuns(), path: '/auth/users-with-runs', method: 'GET', headers: AUTH_JSON,
      okBody: envelope, okResult: { success: true, data: DATA }, fallback: 'Failed to fetch users with runs' },
    { name: 'getWeekLeaderboard', call: () => api.getWeekLeaderboard('2026-09-21'), path: '/leaderboard/week?week_start=2026-09-21', method: 'GET', headers: AUTH_JSON,
      okBody: envelope, okResult: { success: true, data: DATA }, fallback: 'Failed to fetch week leaderboard' },
    { name: 'getRankDelta', call: () => api.getRankDelta(), path: '/leaderboard/rank-delta', method: 'GET', headers: AUTH_JSON,
      okBody: envelope, okResult: { success: true, data: DATA }, fallback: 'Failed to fetch rank changes' },
    { name: 'getAdminWaitlist', call: () => api.getAdminWaitlist(), path: '/admin/waitlist', method: 'GET', headers: AUTH_JSON,
      okBody: envelope, okResult: { success: true, data: DATA }, fallback: 'Failed to load the waitlist' },
    { name: 'getXpConfig', call: () => api.getXpConfig(), path: '/config/xp', method: 'GET', headers: AUTH_JSON,
      okBody: envelope, okResult: { success: true, data: DATA }, fallback: 'Failed to fetch XP config' },
    { name: 'getHeadToHead', call: () => api.getHeadToHead('u-1', 3), path: '/challenges/head-to-head/u-1?limit=3', method: 'GET', headers: AUTH_JSON,
      okBody: envelope, okResult: { success: true, data: DATA }, fallback: 'Failed to fetch head to head' },
    { name: 'getChallengeGroupHistory', call: () => api.getChallengeGroupHistory(20, 40), path: '/challenges/group-history?limit=20&offset=40', method: 'GET', headers: AUTH_JSON,
      okBody: { ...envelope, meta: { total: 1 } }, okResult: { success: true, data: DATA, meta: { total: 1 } }, fallback: 'Failed to fetch challenge history' },
    { name: 'createUser', call: () => api.createUser('Anna', 'a@example.com', 'pw'), path: '/auth/users', method: 'POST', headers: AUTH_JSON,
      body: { name: 'Anna', email: 'a@example.com', password: 'pw' }, okBody: envelope, okResult: { success: true, data: DATA }, fallback: 'Failed to create user' },
    { name: 'resetUserPassword', call: () => api.resetUserPassword('u1', 'pw'), path: '/auth/users/u1/password', method: 'PUT', headers: AUTH_JSON,
      body: { newPassword: 'pw' }, okBody: messageOnly, okResult: { success: true, message: 'msg' }, fallback: 'Failed to reset password' },
    { name: 'authenticatedRequest', call: () => api.authenticatedRequest('/anything'), path: '/anything', method: 'GET', headers: AUTH_JSON,
      okBody: wholeBody, okResult: { success: true, data: wholeBody }, fallback: 'Request failed: /anything' },
    { name: 'getStravaStatus', call: () => api.getStravaStatus(), path: '/strava/status', method: 'GET', headers: AUTH_JSON,
      okBody: { success: true, ...status, data: status }, okResult: { success: true, data: status }, fallback: 'Failed to fetch Strava status' },
    { name: 'connectStrava', call: () => api.connectStrava('abc', 'v1' as never), path: '/strava/callback', method: 'POST', headers: AUTH_JSON,
      body: { code: 'abc', consent_version: 'v1' }, okBody: messageOnly, okResult: { success: true, message: 'msg' }, fallback: 'Failed to connect Strava' },
    { name: 'syncStrava', call: () => api.syncStrava(), path: '/strava/sync', method: 'POST', headers: AUTH_JSON,
      okBody: { success: true, message: 'msg', newRuns: 1, totalActivities: 2, data: { newRuns: 1, totalActivities: 2 } }, okResult: { success: true, data: { newRuns: 1, totalActivities: 2 } }, fallback: 'Failed to sync Strava' },
    { name: 'setStravaSyncPaused', call: () => api.setStravaSyncPaused(true), path: '/strava/sync-paused', method: 'PUT', headers: AUTH_JSON,
      body: { paused: true }, okBody: envelope, okResult: { success: true, data: DATA }, fallback: 'Request failed' },
    { name: 'disconnectStrava', call: () => api.disconnectStrava(), path: '/strava/disconnect', method: 'DELETE', headers: AUTH_JSON,
      okBody: messageOnly, okResult: { success: true, message: 'msg' }, fallback: 'Failed to disconnect Strava' },
    { name: 'backfillStravaExtendedData', call: () => api.backfillStravaExtendedData(), path: '/strava/backfill-extended', method: 'POST', headers: AUTH_JSON,
      okBody: { success: true, totalUpdated: 3, summary: [], data: { totalUpdated: 3, summary: [] } }, okResult: { success: true, data: { totalUpdated: 3, summary: [] } }, fallback: 'Failed to run the Strava backfill' },
    { name: 'getTitleLeaderboard', call: () => api.getTitleLeaderboard(), path: '/titles/leaderboard', method: 'GET', headers: AUTH_JSON,
      okBody: envelope, okResult: { success: true, data: DATA }, fallback: 'Failed to fetch title leaderboard' },
    { name: 'getUserTitles', call: () => api.getUserTitles('u1'), path: '/titles/user/u1', method: 'GET', headers: AUTH_JSON,
      okBody: envelope, okResult: { success: true, data: DATA }, fallback: 'Failed to fetch user titles' },
    { name: 'getTitleGroupEligibility', call: () => api.getTitleGroupEligibility(), path: '/titles/group-eligibility', method: 'GET', headers: AUTH_JSON,
      okBody: envelope, okResult: { success: true, data: DATA }, fallback: 'Failed to fetch title progress' },
    { name: 'updateDisplayedTitles', call: () => api.updateDisplayedTitles(['t1']), path: '/auth/me/displayed-titles', method: 'PUT', headers: AUTH_JSON,
      body: { title_ids: ['t1'] }, okBody: { success: true, data: null }, okResult: { success: true }, fallback: 'Failed to update the displayed titles' },
    { name: 'refreshTitleLeaderboards', call: () => api.refreshTitleLeaderboards(), path: '/titles/refresh', method: 'POST', headers: AUTH_JSON,
      okBody: wholeBody, okResult: { success: true }, fallback: 'Request failed' },
    { name: 'getAdminSettings', call: () => api.getAdminSettings(), path: '/auth/admin-settings', method: 'GET', headers: AUTH_JSON,
      okBody: envelope, okResult: { success: true, data: DATA }, fallback: 'Failed to fetch admin settings' },
    { name: 'updateAdminSettings', call: () => api.updateAdminSettings({ base_xp: 7 } as never), path: '/auth/admin-settings', method: 'PUT', headers: AUTH_JSON,
      body: { base_xp: 7 }, okBody: envelope, okResult: { success: true, data: DATA, message: 'msg' }, fallback: 'Failed to update admin settings' },
    { name: 'getStreakMultipliers', call: () => api.getStreakMultipliers(), path: '/auth/streak-multipliers', method: 'GET', headers: AUTH_JSON,
      okBody: envelope, okResult: { success: true, data: DATA }, fallback: 'Failed to fetch streak multipliers' },
    { name: 'updateStreakMultipliers', call: () => api.updateStreakMultipliers([{ days: 3, multiplier: 1.1 }] as never), path: '/auth/streak-multipliers', method: 'PUT', headers: AUTH_JSON,
      body: { multipliers: [{ days: 3, multiplier: 1.1 }] }, okBody: envelope, okResult: { success: true, data: DATA, message: 'msg' }, fallback: 'Failed to update streak multipliers' },
    { name: 'updateRun', call: () => api.updateRun('r1', { distance: 9 }), path: '/runs/r1', method: 'PUT', headers: AUTH_JSON,
      body: { distance: 9 }, okBody: { run: { id: 'r1' }, message: 'msg' }, okResult: { success: true, data: { id: 'r1' }, message: 'msg' }, fallback: 'Failed to update run' },
    { name: 'deleteRun', call: () => api.deleteRun('r1'), path: '/runs/r1', method: 'DELETE', headers: AUTH_JSON,
      okBody: { success: true, message: 'msg' }, okResult: { success: true, message: 'msg' }, fallback: 'Failed to delete run' },
    { name: 'createRun', call: () => api.createRun('2026-10-11', 8.4, true, 'key-1'), path: '/runs', method: 'POST', headers: { ...AUTH_JSON, 'Idempotency-Key': 'key-1' },
      body: { date: '2026-10-11', distance: 8.4, is_treadmill: true }, okBody: { run: { id: 'r1' }, message: 'msg' }, okResult: { success: true, data: { id: 'r1' }, message: 'msg' }, fallback: 'Failed to create run' },
    { name: 'getGroupRunHistoryPage', call: () => api.getGroupRunHistoryPage(100, 0), path: '/runs/group-history?limit=100&offset=0', method: 'GET', headers: AUTH_JSON,
      okBody: { success: true, runs: [], data: { runs: [] }, meta }, okResult: { success: true, data: { runs: [], meta } }, fallback: 'Failed to fetch the group run history' },
    { name: 'getGroupInfo', call: () => api.getGroupInfo(), path: '/groups/my', method: 'GET', headers: AUTH,
      okBody: envelope, okResult: { success: true, data: DATA }, fallback: 'Failed to fetch group info' },
    { name: 'joinGroup', call: () => api.joinGroup('ABC123'), path: '/groups/join', method: 'POST', headers: AUTH_JSON,
      body: { invite_code: 'ABC123' }, okBody: { success: true, message: 'msg', group: { id: 'g1' }, data: { group: { id: 'g1' } } }, okResult: { success: true, data: { group: { id: 'g1' } }, message: 'msg' }, fallback: 'Failed to join the group' },
    { name: 'getMyChallenges', call: () => api.getMyChallenges(), path: '/challenges/my', method: 'GET', headers: AUTH,
      okBody: envelope, okResult: { success: true, data: DATA }, fallback: 'Failed to fetch challenges' },
    { name: 'sendChallenge', call: () => api.sendChallenge('tok-1', 'u-2'), path: '/challenges/send', method: 'POST', headers: AUTH_JSON,
      body: { token_id: 'tok-1', opponent_id: 'u-2' }, okBody: envelope, okResult: { success: true, data: DATA }, fallback: 'Failed to send challenge' },
    { name: 'respondToChallenge', call: () => api.respondToChallenge('c1', 'accept'), path: '/challenges/c1/respond', method: 'PUT', headers: AUTH_JSON,
      body: { action: 'accept' }, okBody: envelope, okResult: { success: true }, fallback: 'Failed to respond to challenge' },
    { name: 'withdrawChallenge', call: () => api.withdrawChallenge('c1'), path: '/challenges/c1/withdraw', method: 'PUT', headers: AUTH,
      okBody: envelope, okResult: { success: true }, fallback: 'Failed to withdraw challenge' },
    { name: 'getChallengeProgress', call: () => api.getChallengeProgress('c1'), path: '/challenges/c1/progress', method: 'GET', headers: AUTH,
      okBody: envelope, okResult: { success: true, data: DATA }, fallback: 'Failed to fetch progress' },
    { name: 'getChallengeGroupStats', call: () => api.getChallengeGroupStats(), path: '/challenges/group-stats', method: 'GET', headers: AUTH,
      okBody: envelope, okResult: { success: true, data: DATA }, fallback: 'Failed to fetch group stats' },
    { name: 'getEventHistoryPage', call: () => api.getEventHistoryPage(6, 12), path: '/events/history?limit=6&offset=12', method: 'GET', headers: AUTH_JSON,
      okBody: { success: true, events: [], data: { events: [] }, meta }, okResult: { success: true, data: { events: [], meta } }, fallback: 'Failed to fetch the event history' },
    { name: 'getEventList', call: () => api.getEventList(), path: '/events', method: 'GET', headers: AUTH_JSON,
      okBody: { success: true, events: [], data: { events: [] } }, okResult: { success: true, data: { events: [] } }, fallback: 'Failed to fetch events' },
    { name: 'getNews', call: () => api.getNews({ limit: 30, before: 90, type: 'level_up', involves: 'me' }), path: '/news?limit=30&before=90&type=level_up&involves=me', method: 'GET', headers: AUTH_JSON,
      okBody: { ...envelope, meta: { has_more: false } }, okResult: { success: true, data: DATA, meta: { has_more: false } }, fallback: 'Failed to fetch news' },
    { name: 'markNewsSeen', call: () => api.markNewsSeen(5), path: '/news/seen', method: 'POST', headers: AUTH_JSON,
      body: { up_to_id: 5 }, okBody: envelope, okResult: { success: true, data: DATA }, fallback: 'Failed to mark the news as read' },
    { name: 'markNewsRead', call: () => api.markNewsRead([7, 9]), path: '/news/read', method: 'POST', headers: AUTH_JSON,
      body: { ids: [7, 9] }, okBody: envelope, okResult: { success: true, data: DATA }, fallback: 'Failed to mark the rows as read' },
    { name: 'getSettings', call: () => api.getSettings(), path: '/settings', method: 'GET', headers: AUTH_JSON,
      okBody: { ...envelope, meta: { customised: [] } }, okResult: { success: true, data: DATA, meta: { customised: [] } }, fallback: 'Failed to fetch settings' },
    { name: 'putSettings', call: () => api.putSettings({ 'notify.title_others': false }), path: '/settings', method: 'PUT', headers: AUTH_JSON,
      body: { values: { 'notify.title_others': false } }, okBody: { ...envelope, meta: { customised: [] } }, okResult: { success: true, data: DATA, meta: { customised: [] } }, fallback: 'Failed to save settings' },
  ];
}
