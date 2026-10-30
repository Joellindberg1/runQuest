import type { Page, Route } from '@playwright/test';
import type { ChallengeGroupStat, ChallengeRow, MyChallengesData } from '../../../packages/shared/src/contracts/challenges';
import { targets } from './targets';

/**
 * Fejkade svar på "mina utmaningar" och gruppens ställning för specer som mäter Challenge i profil-popupen. Läget säger vad kontot och löparen i popupen kan: `ready` kan skicka,
 * `no-tokens`, `sent` (en skickad utmaning väntar) och `incoming` (en väntar på mig) är mina hinder, `runner-busy` är löparen i en live-duell, `loading` svarar aldrig och `error` felar.
 * Svaren läggs över det riktiga eller fejkade API:et i webbläsaren (sidans rutt går före kontextens), så provet är lika mot staging och mot stubben, och mitt eget id behövs aldrig.
 */
export type RunnerChallengeScenario = 'ready' | 'no-tokens' | 'sent' | 'incoming' | 'runner-busy' | 'loading' | 'error';

export interface RunnerChallengeStubOptions {
  scenario: RunnerChallengeScenario;
  runner: { id: string; name: string };
  /** En annan medlem: mottagaren av min skickade utmaning, och avsändaren av den inkommande. */
  other: { id: string; name: string };
}

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
};

const STAKE = { winner_delta: 0.15, winner_duration: 5, winner_type: 'multiplier_days', loser_delta: -0.07, loser_duration: 5, loser_type: 'multiplier_days' } as const;

const TOKEN: MyChallengesData['tokens'][number] = {
  id: 'token-minor-km', tier: 'minor', metric: 'km', duration_days: 7, earned_at: '2026-09-01T08:00:00Z', reward_id: 'reward-1', ...STAKE,
};

const apiPath = (path: string) => new RegExp(`^${targets.apiUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(/api)?${path}`);

const member = (id: string, name: string, busy: boolean): ChallengeGroupStat => ({
  user_id: id, name, wins: 1, draws: 0, losses: 0, total: 1, points: 3, challenge_active: busy, has_pending_challenge: false, current_level: 10, profile_picture: null,
});

function pendingRow(id: string, challengerId: string, challengerName: string, opponentId: string, opponentName: string): ChallengeRow {
  return {
    id, group_id: 'g1', token_id: null, tier: 'minor', challenger_id: challengerId, challenger_name: challengerName, opponent_id: opponentId, opponent_name: opponentName,
    metric: 'km', duration_days: 7, ...STAKE, challenger_level: 10, opponent_level: 11, status: 'pending', created_at: '2026-10-27T08:00:00Z',
  };
}

export async function stubRunnerChallenge(page: Page, { scenario, runner, other }: RunnerChallengeStubOptions): Promise<void> {
  const mine: MyChallengesData = {
    tokens: scenario === 'no-tokens' ? [] : [TOKEN],
    sent_challenge: scenario === 'sent' ? pendingRow('challenge-sent', 'me', 'Me', other.id, other.name) : null,
    received_challenges: scenario === 'incoming' ? [pendingRow('challenge-incoming', other.id, other.name, 'me', 'Me')] : [],
    boosts: [],
    history: [],
    group_active: [],
  };
  const group: ChallengeGroupStat[] = [member(runner.id, runner.name, scenario === 'runner-busy'), member(other.id, other.name, false)];

  const answer = async (route: Route, body: unknown, status = 200) =>
    route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers: CORS_HEADERS })
      : route.fulfill({ status, headers: CORS_HEADERS, contentType: 'application/json', body: JSON.stringify(body) });

  if (scenario === 'loading') {
    await page.route(apiPath('/challenges/my'), () => {});
  } else if (scenario === 'error') {
    await page.route(apiPath('/challenges/my'), (route) => answer(route, { success: false, error: 'stubbed failure' }, 500));
  } else {
    await page.route(apiPath('/challenges/my'), (route) => answer(route, { success: true, data: mine }));
  }
  await page.route(apiPath('/challenges/group-stats'), (route) => answer(route, { success: true, data: group }));
}
