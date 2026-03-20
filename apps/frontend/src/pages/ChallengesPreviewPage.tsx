import React from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { ChallengesPage, type ChallengeWithProgress } from '@/features/challenges/components/ChallengesPage';
import { ActiveChallengeWidget } from '@/features/challenges/components/ActiveChallengeWidget';
import type { Challenge, ChallengeToken, UserBoost, ChallengeStats } from '@runquest/types';
import type { LeaderboardEntry } from '@/features/challenges/components/ChallengeLeaderboard';
import type { GroupMember } from '@/features/challenges/components/SendChallengeModal';

// ─── Mock data ─────────────────────────────────────────────────────────────────

const ME_ID = 'u1';

const GROUP_MEMBERS: GroupMember[] = [
  { id: 'u1', name: 'Anna Lindqvist',  challenge_active: true  },
  { id: 'u2', name: 'Erik Svensson',   challenge_active: true  },
  { id: 'u3', name: 'Maria Johansson', challenge_active: true  },
  { id: 'u4', name: 'Johan Karlsson',  challenge_active: true  },
  { id: 'u5', name: 'Sara Nilsson',    challenge_active: true  },
  { id: 'u6', name: 'Lars Petersson',  challenge_active: true  },
  { id: 'u7', name: 'Klara Bergström', challenge_active: false },
  { id: 'u8', name: 'Mikael Holm',     challenge_active: false },
];

const LEADERBOARD: LeaderboardEntry[] = [
  { user_id: 'u1', name: 'Anna Lindqvist',  wins: 5, draws: 1, losses: 2 },
  { user_id: 'u2', name: 'Erik Svensson',   wins: 4, draws: 2, losses: 3 },
  { user_id: 'u3', name: 'Maria Johansson', wins: 3, draws: 0, losses: 3 },
  { user_id: 'u4', name: 'Johan Karlsson',  wins: 2, draws: 2, losses: 4 },
  { user_id: 'u5', name: 'Sara Nilsson',    wins: 1, draws: 1, losses: 4 },
  { user_id: 'u6', name: 'Lars Petersson',  wins: 0, draws: 0, losses: 0 },
  { user_id: 'u7', name: 'Klara Bergström', wins: 0, draws: 0, losses: 0 },
  { user_id: 'u8', name: 'Mikael Holm',     wins: 0, draws: 0, losses: 0 },
];

function makeEndDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().split('T')[0];
}
function makeStartDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

// ── Active challenges ──────────────────────────────────────────────────────────

// My challenge: Anna vs Erik (Major · KM) — 5 days left
const MY_CHALLENGE: Challenge = {
  id: 'c1', group_id: 'g1', tier: 'major',
  challenger_id: 'u1', challenger_name: 'Anna Lindqvist',
  opponent_id: 'u2', opponent_name: 'Erik Svensson',
  metric: 'km', duration_days: 10,
  winner_delta: 0.25, winner_duration: 10, winner_type: 'multiplier_days',
  loser_delta: -0.12, loser_duration: 10, loser_type: 'multiplier_days',
  challenger_level: 12, opponent_level: 10,
  start_date: makeStartDate(5), end_date: makeEndDate(5),
  status: 'active',
  created_at: new Date(Date.now() - 5 * 86_400_000).toISOString(),
};

// Group challenge 2: Maria vs Johan (Major · Runs) — 3 days left
const CHALLENGE_2: Challenge = {
  id: 'c3', group_id: 'g1', tier: 'major',
  challenger_id: 'u3', challenger_name: 'Maria Johansson',
  opponent_id: 'u4', opponent_name: 'Johan Karlsson',
  metric: 'runs', duration_days: 10,
  winner_delta: 0.25, winner_duration: 10, winner_type: 'multiplier_days',
  loser_delta: -0.12, loser_duration: 10, loser_type: 'multiplier_days',
  challenger_level: 9, opponent_level: 8,
  start_date: makeStartDate(7), end_date: makeEndDate(3),
  status: 'active',
  created_at: new Date(Date.now() - 7 * 86_400_000).toISOString(),
};

// Group challenge 3: Sara vs Lars (Minor · Runs) — 2 days left
const CHALLENGE_3: Challenge = {
  id: 'c4', group_id: 'g1', tier: 'minor',
  challenger_id: 'u5', challenger_name: 'Sara Nilsson',
  opponent_id: 'u6', opponent_name: 'Lars Petersson',
  metric: 'runs', duration_days: 5,
  winner_delta: 0.15, winner_duration: 5, winner_type: 'multiplier_days',
  loser_delta: -0.07, loser_duration: 5, loser_type: 'multiplier_days',
  challenger_level: 6, opponent_level: 5,
  start_date: makeStartDate(3), end_date: makeEndDate(2),
  status: 'active',
  created_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
};

// Group challenge 4: Klara vs Mikael (Legendary · XP) — 8 days left
const CHALLENGE_4: Challenge = {
  id: 'c5', group_id: 'g1', tier: 'legendary',
  challenger_id: 'u7', challenger_name: 'Klara Bergström',
  opponent_id: 'u8', opponent_name: 'Mikael Holm',
  metric: 'total_xp', duration_days: 21,
  winner_delta: 0.5, winner_duration: 14, winner_type: 'multiplier_days',
  loser_delta: -0.25, loser_duration: 14, loser_type: 'multiplier_days',
  challenger_level: 4, opponent_level: 3,
  start_date: makeStartDate(6), end_date: makeEndDate(8),
  status: 'active',
  created_at: new Date(Date.now() - 6 * 86_400_000).toISOString(),
};

const ALL_ACTIVE: ChallengeWithProgress[] = [
  {
    challenge: MY_CHALLENGE,
    progress: [
      { user_id: 'u1', name: 'Anna Lindqvist', value: 38.4 },
      { user_id: 'u2', name: 'Erik Svensson',  value: 31.1 },
    ],
  },
  {
    challenge: CHALLENGE_2,
    progress: [
      { user_id: 'u3', name: 'Maria Johansson', value: 12 },
      { user_id: 'u4', name: 'Johan Karlsson',  value: 9  },
    ],
  },
  {
    challenge: CHALLENGE_3,
    progress: [
      { user_id: 'u5', name: 'Sara Nilsson',   value: 7 },
      { user_id: 'u6', name: 'Lars Petersson', value: 4 },
    ],
  },
  {
    challenge: CHALLENGE_4,
    progress: [
      { user_id: 'u7', name: 'Klara Bergström', value: 1820 },
      { user_id: 'u8', name: 'Mikael Holm',     value: 1410 },
    ],
  },
];

// ── Sent (preview only — in live you can't send while active) ─────────────────
const SENT_CHALLENGE: Challenge = {
  id: 'c-sent', group_id: 'g1', tier: 'minor',
  challenger_id: 'u1', challenger_name: 'Anna Lindqvist',
  opponent_id: 'u7', opponent_name: 'Klara Bergström',
  metric: 'runs', duration_days: 7,
  winner_delta: 0.15, winner_duration: 5, winner_type: 'multiplier_days',
  loser_delta: -0.07, loser_duration: 5, loser_type: 'multiplier_days',
  challenger_level: 12, opponent_level: 4,
  status: 'pending',
  created_at: new Date().toISOString(),
};

// ── Received ──────────────────────────────────────────────────────────────────
const sentAt = new Date(Date.now() - 2 * 86_400_000);
const RECEIVED: Challenge[] = [
  {
    id: 'c2', group_id: 'g1', tier: 'legendary',
    challenger_id: 'u4', challenger_name: 'Johan Karlsson',
    opponent_id: 'u1', opponent_name: 'Anna Lindqvist',
    metric: 'total_xp', duration_days: 21,
    winner_delta: 0.5, winner_duration: 14, winner_type: 'multiplier_days',
    loser_delta: -0.25, loser_duration: 14, loser_type: 'multiplier_days',
    challenger_level: 8, opponent_level: 12,
    legendary_sent_at: sentAt.toISOString(),
    status: 'pending',
    created_at: sentAt.toISOString(),
  },
];

// ── Tokens ────────────────────────────────────────────────────────────────────
const TOKENS: ChallengeToken[] = [
  { id: 't1', user_id: 'u1', tier: 'legendary', metric: 'total_xp', duration_days: 21, winner_delta: 0.5,  winner_duration: 14, loser_delta: -0.25, loser_duration: 14, earned_at: new Date(Date.now() - 5 * 86_400_000).toISOString() },
  { id: 't2', user_id: 'u1', tier: 'major',     metric: 'km',       duration_days: 10, winner_delta: 0.25, winner_duration: 10, loser_delta: -0.12, loser_duration: 10, earned_at: new Date(Date.now() - 3 * 86_400_000).toISOString() },
  { id: 't3', user_id: 'u1', tier: 'minor',     metric: 'runs',     duration_days: 7,  winner_delta: 0.15, winner_duration: 5,  loser_delta: -0.07, loser_duration: 5,  earned_at: new Date(Date.now() - 10 * 86_400_000).toISOString() },
  { id: 't4', user_id: 'u1', tier: 'minor',     metric: 'total_xp', duration_days: 5,  winner_delta: 0.15, winner_duration: 5,  loser_delta: -0.07, loser_duration: 5,  earned_at: new Date(Date.now() - 15 * 86_400_000).toISOString() },
];

const BOOSTS: UserBoost[] = [
  { id: 'b1', user_id: 'u1', challenge_id: 'c0', outcome: 'winner', type: 'multiplier_days', delta: 0.25, remaining: 5, created_at: new Date(Date.now() - 9 * 86_400_000).toISOString() },
];

// ── History ───────────────────────────────────────────────────────────────────
const HISTORY: Challenge[] = [
  {
    id: 'h1', group_id: 'g1', tier: 'minor',
    challenger_id: 'u1', challenger_name: 'Anna Lindqvist',
    opponent_id: 'u3', opponent_name: 'Maria Johansson',
    metric: 'runs', duration_days: 7,
    winner_delta: 0.15, winner_duration: 5, winner_type: 'multiplier_days',
    loser_delta: -0.07, loser_duration: 5, loser_type: 'multiplier_days',
    challenger_level: 12, opponent_level: 9,
    end_date: new Date(Date.now() - 9 * 86_400_000).toISOString().split('T')[0],
    status: 'completed', winner_id: 'u1', outcome: 'winner',
    challenger_final_value: 34, opponent_final_value: 27,
    created_at: new Date(Date.now() - 17 * 86_400_000).toISOString(),
  },
  {
    id: 'h2', group_id: 'g1', tier: 'major',
    challenger_id: 'u2', challenger_name: 'Erik Svensson',
    opponent_id: 'u1', opponent_name: 'Anna Lindqvist',
    metric: 'km', duration_days: 14,
    winner_delta: 0.25, winner_duration: 10, winner_type: 'multiplier_days',
    loser_delta: -0.12, loser_duration: 10, loser_type: 'multiplier_days',
    challenger_level: 10, opponent_level: 11,
    end_date: new Date(Date.now() - 26 * 86_400_000).toISOString().split('T')[0],
    status: 'completed', winner_id: 'u2', outcome: 'loss',
    challenger_final_value: 87.3, opponent_final_value: 71.8,
    created_at: new Date(Date.now() - 41 * 86_400_000).toISOString(),
  },
  {
    id: 'h3', group_id: 'g1', tier: 'legendary',
    challenger_id: 'u1', challenger_name: 'Anna Lindqvist',
    opponent_id: 'u5', opponent_name: 'Sara Nilsson',
    metric: 'total_xp', duration_days: 21,
    winner_delta: 0.5, winner_duration: 14, winner_type: 'multiplier_days',
    loser_delta: -0.25, loser_duration: 14, loser_type: 'multiplier_days',
    challenger_level: 11, opponent_level: 6,
    end_date: new Date(Date.now() - 49 * 86_400_000).toISOString().split('T')[0],
    status: 'completed', winner_id: 'u1', outcome: 'winner',
    challenger_final_value: 4820, opponent_final_value: 3190,
    created_at: new Date(Date.now() - 71 * 86_400_000).toISOString(),
  },
  {
    id: 'h4', group_id: 'g1', tier: 'minor',
    challenger_id: 'u3', challenger_name: 'Maria Johansson',
    opponent_id: 'u4', opponent_name: 'Johan Karlsson',
    metric: 'km', duration_days: 5,
    winner_delta: 0.15, winner_duration: 5, winner_type: 'multiplier_days',
    loser_delta: -0.07, loser_duration: 5, loser_type: 'multiplier_days',
    challenger_level: 9, opponent_level: 8,
    end_date: new Date(Date.now() - 20 * 86_400_000).toISOString().split('T')[0],
    status: 'completed', winner_id: 'u3', outcome: 'winner',
    challenger_final_value: 22.5, opponent_final_value: 17.0,
    created_at: new Date(Date.now() - 26 * 86_400_000).toISOString(),
  },
  {
    id: 'h5', group_id: 'g1', tier: 'major',
    challenger_id: 'u4', challenger_name: 'Johan Karlsson',
    opponent_id: 'u2', opponent_name: 'Erik Svensson',
    metric: 'runs', duration_days: 10,
    winner_delta: 0.25, winner_duration: 10, winner_type: 'multiplier_days',
    loser_delta: -0.12, loser_duration: 10, loser_type: 'multiplier_days',
    challenger_level: 8, opponent_level: 10,
    end_date: new Date(Date.now() - 35 * 86_400_000).toISOString().split('T')[0],
    status: 'completed', outcome: 'draw',
    challenger_final_value: 14, opponent_final_value: 14,
    created_at: new Date(Date.now() - 46 * 86_400_000).toISOString(),
  },
];

// Stats: Anna has active challenge → blocks sending in live (shown in modal)
const STATS: ChallengeStats = { wins: 5, draws: 1, losses: 2, challenge_active: true };

// ─── Page ──────────────────────────────────────────────────────────────────────

const ChallengesPreviewPage: React.FC = () => {
  const myEntry = ALL_ACTIVE.find(e => e.challenge.challenger_id === ME_ID || e.challenge.opponent_id === ME_ID);
  const widget = myEntry ? (
    <ActiveChallengeWidget
      challenge={myEntry.challenge}
      progress={myEntry.progress}
      currentUserId={ME_ID}
      onClick={() => {}}
    />
  ) : undefined;

  return (
    <AppLayout groupName="Wolfpack — Göteborgsvarvet 2026" sidebarWidget={widget} themeClass="runquest-hybrid">
      <ChallengesPage
        currentUserId={ME_ID}
        leaderboard={LEADERBOARD}
        allActiveChallenges={ALL_ACTIVE}
        sentChallenge={SENT_CHALLENGE}
        receivedChallenges={RECEIVED}
        tokens={TOKENS}
        allHistory={HISTORY}
        boosts={BOOSTS}
        stats={STATS}
        groupMembers={GROUP_MEMBERS}
      />
    </AppLayout>
  );
};

export default ChallengesPreviewPage;
