import React, { useMemo, useState } from 'react';
import type { Challenge, ChallengeToken, UserBoost } from '@runquest/types';
import type { ChallengeHistoryItem } from '@runquest/shared';
import { useIsDesktop } from '@/app-shell/useIsDesktop';
import { DuelsLayout } from '@/features/challenges/components/DuelsLayout';
import {
  DEFAULT_DUELS_VIEW, DUELS_VIEWS, buildBoosts, buildHistoryRows, buildIncoming, buildLiveCards, buildRecord, buildSent, buildStandings,
  buildTokenGroups, nameMap, summaryText, tokenTotal, type GroupStat, type MyChallenges, type ProgressByChallenge,
} from '@/features/challenges/duelsModel';
import { buildTierRules, observedStakes } from '@/features/challenges/rulesModel';
import { sendBlocker } from '@/features/challenges/sendModel';
import { useViewParam } from '@/shared/hooks/useViewParam';

// /preview/challenges — Duels-skärmen med exempeldata, utan inloggning. Samma DuelsLayout som /duels, men med färdiga
// vymodeller byggda ur nedanstående data i stället för hämtade; Send/Accept/… gör ingenting.

const DAY_MS = 86_400_000;
const ME_ID = 'u1';

const isoDay = (offsetDays: number): string => new Date(Date.now() + offsetDays * DAY_MS).toISOString().split('T')[0];
const isoTime = (offsetDays: number): string => new Date(Date.now() + offsetDays * DAY_MS).toISOString();

const MEMBERS: Array<{ id: string; name: string; wins: number; draws: number; losses: number; level: number }> = [
  { id: 'u1', name: 'Anna Lindqvist', wins: 5, draws: 1, losses: 2, level: 12 },
  { id: 'u2', name: 'Erik Svensson', wins: 4, draws: 2, losses: 3, level: 10 },
  { id: 'u3', name: 'Maria Johansson', wins: 3, draws: 0, losses: 3, level: 9 },
  { id: 'u4', name: 'Johan Karlsson', wins: 2, draws: 2, losses: 4, level: 8 },
  { id: 'u5', name: 'Sara Nilsson', wins: 1, draws: 1, losses: 4, level: 6 },
  { id: 'u6', name: 'Lars Petersson', wins: 0, draws: 0, losses: 0, level: 5 },
  { id: 'u7', name: 'Klara Bergström', wins: 0, draws: 0, losses: 0, level: 4 },
  { id: 'u8', name: 'Mikael Holm', wins: 0, draws: 0, losses: 0, level: 3 },
];

const STATS: GroupStat[] = MEMBERS.map((member) => ({
  user_id: member.id,
  name: member.name,
  wins: member.wins,
  draws: member.draws,
  losses: member.losses,
  total: member.wins + member.draws + member.losses,
  points: 0,
  challenge_active: ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'].includes(member.id),
  has_pending_challenge: false,
  current_level: member.level,
  profile_picture: null,
}));

const MINOR = { winner_delta: 0.15, winner_duration: 5, winner_type: 'multiplier_days', loser_delta: -0.07, loser_duration: 5, loser_type: 'multiplier_days' };
const MAJOR = { winner_delta: 0.25, winner_duration: 10, winner_type: 'multiplier_days', loser_delta: -0.12, loser_duration: 10, loser_type: 'multiplier_days' };
const LEGENDARY = { winner_delta: 0.5, winner_duration: 14, winner_type: 'multiplier_days', loser_delta: -0.25, loser_duration: 14, loser_type: 'multiplier_days' };

const challenge = (over: Partial<Challenge> & Pick<Challenge, 'id' | 'challenger_id' | 'opponent_id' | 'tier'>): Challenge => {
  const names = Object.fromEntries(MEMBERS.map((member) => [member.id, member.name]));
  return {
    group_id: 'g1',
    challenger_name: names[over.challenger_id],
    opponent_name: names[over.opponent_id],
    metric: 'km',
    duration_days: 10,
    ...{ minor: MINOR, major: MAJOR, legendary: LEGENDARY }[over.tier],
    challenger_level: 10,
    opponent_level: 10,
    status: 'active',
    created_at: isoTime(-5),
    ...over,
  };
};

const ACTIVE: Challenge[] = [
  challenge({ id: 'c1', tier: 'major', challenger_id: 'u1', opponent_id: 'u2', metric: 'km', start_date: isoDay(-5), end_date: isoDay(5) }),
  challenge({ id: 'c3', tier: 'major', challenger_id: 'u3', opponent_id: 'u4', metric: 'runs', start_date: isoDay(-7), end_date: isoDay(3) }),
  challenge({ id: 'c4', tier: 'minor', challenger_id: 'u5', opponent_id: 'u6', metric: 'runs', duration_days: 5, start_date: isoDay(-3), end_date: isoDay(1) }),
];

const PROGRESS: ProgressByChallenge = {
  c1: [{ user_id: 'u1', value: 38.4 }, { user_id: 'u2', value: 31.1 }],
  c3: [{ user_id: 'u3', value: 12 }, { user_id: 'u4', value: 9 }],
  c4: [{ user_id: 'u5', value: 7 }, { user_id: 'u6', value: 4 }],
};

const RECEIVED: Challenge[] = [
  challenge({
    id: 'c2', tier: 'legendary', challenger_id: 'u4', opponent_id: 'u1', metric: 'total_xp', duration_days: 21, status: 'pending',
    legendary_sent_at: isoTime(-2), created_at: isoTime(-2),
  }),
];

const TOKENS: MyChallenges['tokens'] = [
  { id: 't1', user_id: 'u1', tier: 'legendary', metric: 'total_xp', duration_days: 21, ...LEGENDARY, earned_at: isoTime(-5) },
  { id: 't2', user_id: 'u1', tier: 'major', metric: 'km', duration_days: 10, ...MAJOR, earned_at: isoTime(-3) },
  { id: 't3', user_id: 'u1', tier: 'minor', metric: 'runs', duration_days: 7, ...MINOR, earned_at: isoTime(-10) },
  { id: 't4', user_id: 'u1', tier: 'minor', metric: 'total_xp', duration_days: 5, ...MINOR, earned_at: isoTime(-15) },
] satisfies ChallengeToken[];

const HISTORY: Challenge[] = [
  challenge({
    id: 'h1', tier: 'minor', challenger_id: 'u1', opponent_id: 'u3', metric: 'runs', duration_days: 7, status: 'completed',
    winner_id: 'u1', outcome: 'challenger_wins', end_date: isoDay(-9), created_at: isoTime(-17),
  }),
];

const BOOSTS: UserBoost[] = [
  { id: 'b1', user_id: 'u1', challenge_id: 'h1', outcome: 'winner', type: 'multiplier_days', delta: 0.15, created_at: isoTime(-4), expires_at: isoTime(1) },
];

const MATCH = (id: string, over: Partial<ChallengeHistoryItem>): ChallengeHistoryItem => ({
  id,
  tier: 'major',
  metric: 'km',
  duration_days: 10,
  start_date: null,
  end_date: null,
  ended_at: isoTime(-20),
  outcome: 'challenger_wins',
  winner_id: 'u1',
  challenger: { id: 'u1', name: 'Anna Lindqvist', profile_picture: null, level: 11 },
  opponent: { id: 'u2', name: 'Erik Svensson', profile_picture: null, level: 10 },
  challenger_value: 87.3,
  opponent_value: 71.8,
  winner_boost: { type: 'multiplier_days', delta: 0.25, duration: 10 },
  loser_boost: { type: 'multiplier_days', delta: -0.12, duration: 10 },
  ...over,
});

const MATCHES: ChallengeHistoryItem[] = [
  MATCH('m1', { tier: 'minor', metric: 'runs', duration_days: 7, ended_at: isoTime(-9), challenger_value: 34, opponent_value: 27, challenger: { id: 'u1', name: 'Anna Lindqvist', profile_picture: null, level: 12 }, opponent: { id: 'u3', name: 'Maria Johansson', profile_picture: null, level: 9 }, winner_boost: { type: 'multiplier_days', delta: 0.15, duration: 5 }, loser_boost: { type: 'multiplier_days', delta: -0.07, duration: 5 } }),
  MATCH('m2', { ended_at: isoTime(-26), outcome: 'opponent_wins', winner_id: 'u1', challenger: { id: 'u2', name: 'Erik Svensson', profile_picture: null, level: 10 }, opponent: { id: 'u1', name: 'Anna Lindqvist', profile_picture: null, level: 11 } }),
  MATCH('m3', { tier: 'legendary', metric: 'total_xp', duration_days: 21, ended_at: isoTime(-49), challenger_value: 4820, opponent_value: 3190, opponent: { id: 'u5', name: 'Sara Nilsson', profile_picture: null, level: 6 }, winner_boost: { type: 'multiplier_days', delta: 0.5, duration: 14 }, loser_boost: { type: 'multiplier_days', delta: -0.25, duration: 14 } }),
  MATCH('m4', { tier: 'major', metric: 'runs', ended_at: isoTime(-35), outcome: 'draw', winner_id: null, challenger_value: 14, opponent_value: 14, challenger: { id: 'u4', name: 'Johan Karlsson', profile_picture: null, level: 8 } }),
];

/** Vymodellerna för preview-data — samma byggare som skärmen använder. */
function buildPreview(now: Date, mineOnly: boolean) {
  const names = nameMap(STATS);
  const incoming = buildIncoming(RECEIVED, names, now);
  const sent = buildSent(null, names);
  const groups = buildTokenGroups(TOKENS);
  const inLiveDuel = ACTIVE.some((c) => c.challenger_id === ME_ID || c.opponent_id === ME_ID);
  return {
    incoming,
    sent,
    groups,
    inLiveDuel,
    blocker: sendBlocker({ tokenCount: tokenTotal(groups), inLiveDuel, sent, incomingCount: incoming.length }),
    live: buildLiveCards(ACTIVE, PROGRESS, ME_ID, names, now),
    standings: buildStandings(STATS, ME_ID),
    boosts: buildBoosts(BOOSTS, HISTORY, ME_ID, names, now),
    record: buildRecord(STATS.find((stat) => stat.user_id === ME_ID)),
    rules: buildTierRules(observedStakes([...TOKENS, ...ACTIVE])),
    historyRows: buildHistoryRows(MATCHES, ME_ID, mineOnly),
  };
}

const noop = () => {};

const ChallengesPreviewPage: React.FC = () => {
  const isDesktop = useIsDesktop();
  const [view, setView] = useViewParam(DUELS_VIEWS, DEFAULT_DUELS_VIEW);
  const [mineOnly, setMineOnly] = useState(false);
  const now = useMemo(() => new Date(), []);
  const model = useMemo(() => buildPreview(now, mineOnly), [now, mineOnly]);

  if (isDesktop === undefined) return null;

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <DuelsLayout
        isDesktop={isDesktop}
        view={view}
        onViewChange={setView}
        summary={summaryText({ live: ACTIVE.length, waitingOnMe: model.incoming.length, tokens: tokenTotal(model.groups) }, isDesktop)}
        notice={null}
        blocker={model.blocker}
        inLiveDuel={model.inLiveDuel}
        onOpenSend={noop}
        live={model.live}
        incoming={model.incoming}
        sent={model.sent}
        standings={model.standings}
        history={{
          status: 'ready',
          rows: model.historyRows,
          mineOnly,
          onToggleMine: () => setMineOnly((previous) => !previous),
          hasMore: false,
          loadingMore: false,
          onLoadMore: noop,
          retrying: false,
          onRetry: noop,
        }}
        rules={model.rules}
        tokens={model.groups}
        boosts={model.boosts}
        record={model.record}
        busyId={null}
        onAccept={noop}
        onDecline={noop}
        onWithdraw={noop}
        onOpenRunner={noop}
      />
    </div>
  );
};

export default ChallengesPreviewPage;
