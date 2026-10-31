import type { Page } from '@playwright/test';
import type { ChallengeGroupStat, MyChallengesData } from '../../../packages/shared/src/contracts/challenges';

/**
 * Fejkat challenges-API för specer som mäter send-arket: tokens på alla tre nivåerna och ett valfritt antal medlemmar i gruppen. Svaren läggs över det fejkade
 * API:et i webbläsaren för just de här anropen (`**` /api/challenges), så arket har innehåll att mäta även när kontot saknar tokens. Bara med `E2E_STUB_API=1`.
 */
const CORS_HEADERS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const MINOR_STAKE = { winner_delta: 0.15, winner_duration: 5, winner_type: 'multiplier_days', loser_delta: -0.07, loser_duration: 5, loser_type: 'multiplier_days' } as const;
const LEGENDARY_STAKE = { winner_delta: 0.5, winner_duration: 14, winner_type: 'multiplier_days', loser_delta: -0.25, loser_duration: 14, loser_type: 'multiplier_days' } as const;

const TOKENS: MyChallengesData['tokens'] = [
  { id: 'token-minor-km', tier: 'minor', metric: 'km', duration_days: 7, earned_at: '2026-09-01T08:00:00Z', reward_id: 'reward-1', ...MINOR_STAKE },
  { id: 'token-minor-runs', tier: 'minor', metric: 'runs', duration_days: 5, earned_at: '2026-09-02T08:00:00Z', reward_id: 'reward-2', ...MINOR_STAKE },
  { id: 'token-minor-xp', tier: 'minor', metric: 'total_xp', duration_days: 3, earned_at: '2026-09-03T08:00:00Z', reward_id: 'reward-3', ...MINOR_STAKE },
  { id: 'token-major', tier: 'major', metric: 'km', duration_days: 10, earned_at: '2026-09-04T08:00:00Z', reward_id: 'reward-4', ...MINOR_STAKE },
  { id: 'token-legendary', tier: 'legendary', metric: 'total_xp', duration_days: 30, earned_at: '2026-09-05T08:00:00Z', reward_id: 'reward-5', ...LEGENDARY_STAKE },
];

// Stubbanvändaren (jag) ligger i gruppen och syns aldrig som motståndare; resten är fritt påhittade namn, ett par med långa efternamn.
const ME = { id: 'stub-user-1', name: 'Stub Runner' };
const OTHERS = [
  'Anna Lindqvist', 'Erik Svensson', 'Maria Johansson', 'Oscar Berg', 'Karin Holm', 'Per Nilsson',
  'Sofia Ek', 'Nils Dahl', 'Lena Hedlund', 'Jonas Ström', 'Elin Wikström Lundgren', 'Tobias Rask',
];

/** Hur kontot ser ut: `ready` kan skicka, `no-tokens` har inga tokens, `live` ligger i en pågående duell. */
export type SendSheetScenario = 'ready' | 'no-tokens' | 'live';

export interface SendSheetStubOptions {
  /** Antal medlemmar i gruppen inklusive mig (högst 13). */
  members: number;
  scenario?: SendSheetScenario;
  /** Skickar svaret på POST /challenges/send först när löftet är löst; utan det svarar skicket direkt. Ett löfte som aldrig löses är ett svar som aldrig kommer. */
  holdSend?: Promise<void>;
  /** Skicket når "servern" och utmaningen skapas (tokenet förbrukas, utmaningen syns som skickad i /challenges/my) även om svaret uteblir eller kommer sent. */
  serverCreates?: boolean;
  /** Skicket misslyckas på nätverksnivå (anslutningen bryts): webbläsarens fetch kastar "Failed to fetch". */
  abortSend?: boolean;
  /** Fylls med ett element per POST /challenges/send som nådde "servern". */
  sendLog?: string[];
}

const LIVE_DUEL: MyChallengesData['group_active'][number] = {
  id: 'challenge-live', group_id: 'g1', token_id: 'token-live', tier: 'minor', challenger_id: ME.id, opponent_id: 'member-1', metric: 'km', duration_days: 7, ...MINOR_STAKE,
  challenger_level: 10, opponent_level: 11, status: 'active', created_at: '2026-10-27T08:00:00Z',
  start_date: '2026-10-28', end_date: '2026-11-04',
};

/** Utmaningen "servern" skapar när ett skick med `serverCreates` når den: tokenet Most runs mot Anna Lindqvist (första medlemmen efter mig). */
const CREATED_CHALLENGE: MyChallengesData['group_active'][number] = {
  id: 'challenge-new', group_id: 'g1', token_id: 'token-minor-runs', tier: 'minor', challenger_id: ME.id, opponent_id: 'member-1', opponent_name: 'Anna Lindqvist', metric: 'runs', duration_days: 5, ...MINOR_STAKE,
  challenger_level: 10, opponent_level: 11, status: 'pending', created_at: '2026-10-31T08:00:00Z',
};

export async function stubSendSheetApi(page: Page, { members, scenario = 'ready', holdSend, serverCreates = false, abortSend = false, sendLog }: SendSheetStubOptions): Promise<void> {
  const group: ChallengeGroupStat[] = [ME, ...OTHERS.slice(0, members - 1).map((name, index) => ({ id: `member-${index + 1}`, name }))].map(({ id, name }, index) => ({
    user_id: id, name, wins: 1, draws: 0, losses: 0, total: 1, points: 3, challenge_active: false, has_pending_challenge: false, current_level: 10 + index, profile_picture: null,
  }));
  const mine: MyChallengesData = {
    tokens: scenario === 'no-tokens' ? [] : TOKENS,
    sent_challenge: null,
    received_challenges: [],
    boosts: [],
    history: [],
    group_active: scenario === 'live' ? [LIVE_DUEL] : [],
  };
  let created = false;
  await page.route('**/api/challenges/**', async (route) => {
    const url = route.request().url();
    if (route.request().method() === 'POST' && url.endsWith('/challenges/send')) {
      sendLog?.push(url);
      if (serverCreates) created = true;
      if (abortSend) return route.abort('connectionreset');
      await holdSend;
      // Svaret kan komma efter att sidan gett upp och avbrutit anropet: då finns inget att svara, och det är inget fel i stubben.
      return route.fulfill({ status: 201, headers: CORS_HEADERS, contentType: 'application/json', body: JSON.stringify({ success: true, data: { challenge_id: 'challenge-new' } }) }).catch(() => {});
    }
    const headToHead = { opponent: { id: 'member-1', name: 'Anna Lindqvist' }, record: { wins: 0, draws: 0, losses: 0, total: 0 }, history: [], active: null };
    const afterSend: MyChallengesData = { ...mine, tokens: mine.tokens.filter((token) => token.id !== CREATED_CHALLENGE.token_id), sent_challenge: CREATED_CHALLENGE };
    const data = url.includes('/challenges/my') ? (created ? afterSend : mine) : url.includes('/group-stats') ? group : headToHead;
    return route.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
  });
}
