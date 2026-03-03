import React from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Leaderboard } from '@/features/leaderboard';
import { ActiveChallengeWidget } from '@/features/challenges/components/ActiveChallengeWidget';
import type { User, Run, Challenge } from '@/types/run';

// ─── Mock Data ────────────────────────────────────────────────────────────────

const makeRun = (userId: string, daysAgo: number, distance: number, xp: number): Run => {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return {
    id: `run-${userId}-${daysAgo}`,
    user_id: userId,
    date: date.toISOString().split('T')[0],
    distance,
    xp_gained: xp,
    multiplier: 1.0,
    streak_day: 1,
    base_xp: Math.round(xp * 0.5),
    km_xp: Math.round(xp * 0.3),
    distance_bonus: Math.round(xp * 0.1),
    streak_bonus: Math.round(xp * 0.1),
  };
};

const MOCK_USERS: User[] = [
  { id: 'u1', name: 'Anna Lindqvist',  total_xp: 8420, current_level: 12, total_km: 312.5, current_streak: 7,  longest_streak: 21, challenge_active: true,  wins: 8, draws: 1, losses: 2,
    challenge_counts: { minor: 7, major: 3, legendary: 1 },
    runs: [makeRun('u1', 0, 8.2, 310), makeRun('u1', 1, 10.1, 380), makeRun('u1', 3, 12.5, 450)] },
  { id: 'u2', name: 'Erik Svensson',   total_xp: 7150, current_level: 10, total_km: 265.0, current_streak: 4,  longest_streak: 14, challenge_active: true,  wins: 5, draws: 2, losses: 4,
    challenge_counts: { minor: 6, major: 5 },
    runs: [makeRun('u2', 1, 5.0, 200), makeRun('u2', 3, 15.0, 560)] },
  { id: 'u3', name: 'Maria Johansson', total_xp: 6380, current_level: 9,  total_km: 218.7, current_streak: 2,  longest_streak: 10,                           wins: 3, draws: 0, losses: 3,
    challenge_counts: { minor: 4, major: 2 },
    runs: [makeRun('u3', 2, 9.0, 345), makeRun('u3', 4, 11.3, 420)] },
  { id: 'u4', name: 'Johan Karlsson',  total_xp: 5200, current_level: 8,  total_km: 178.3, current_streak: 0,  longest_streak: 8,                            wins: 2, draws: 1, losses: 2,
    challenge_counts: { minor: 5 },
    runs: [makeRun('u4', 5, 7.0, 270), makeRun('u4', 9, 6.0, 235)] },
  { id: 'u5', name: 'Sara Nilsson',    total_xp: 4100, current_level: 6,  total_km: 134.0, current_streak: 3,  longest_streak: 6,  challenge_active: true,  wins: 1, draws: 0, losses: 1,
    challenge_counts: { minor: 2 },
    runs: [makeRun('u5', 1, 4.5, 180), makeRun('u5', 4, 8.0, 305)] },
  { id: 'u6', name: 'Lars Petersson',  total_xp: 3750, current_level: 5,  total_km: 112.5, current_streak: 1,  longest_streak: 5,                            wins: 0, draws: 1, losses: 2,
    challenge_counts: { minor: 3 },
    runs: [makeRun('u6', 0, 6.0, 235)] },
  { id: 'u7', name: 'Klara Bergström', total_xp: 2900, current_level: 4,  total_km: 89.0,  current_streak: 0,  longest_streak: 4,
    runs: [makeRun('u7', 3, 5.5, 215)] },
  { id: 'u8', name: 'Mikael Holm',     total_xp: 1850, current_level: 3,  total_km: 54.2,  current_streak: 2,  longest_streak: 3,
    runs: [makeRun('u8', 1, 3.5, 140)] },
];

const MOCK_CURRENT_USER = MOCK_USERS[0];

// Active challenge widget data
const endDate = new Date();
endDate.setDate(endDate.getDate() + 5);

const ACTIVE_CHALLENGE: Challenge = {
  id: 'c1', group_id: 'g1', tier: 'major',
  challenger_id: 'u1', challenger_name: 'Anna Lindqvist',
  opponent_id: 'u2', opponent_name: 'Erik Svensson',
  metric: 'km', duration_days: 10,
  winner_delta: 0.25, winner_duration: 10, winner_type: 'multiplier_days',
  loser_delta: -0.12, loser_duration: 10, loser_type: 'multiplier_days',
  challenger_level: 12, opponent_level: 10,
  end_date: endDate.toISOString().split('T')[0],
  status: 'active',
  created_at: new Date(Date.now() - 5 * 86_400_000).toISOString(),
};

const ACTIVE_PROGRESS = [
  { user_id: 'u1', name: 'Anna Lindqvist', value: 38.4 },
  { user_id: 'u2', name: 'Erik Svensson',  value: 31.1 },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

const LeaderboardPreviewPage: React.FC = () => {
  const widget = (
    <ActiveChallengeWidget
      challenge={ACTIVE_CHALLENGE}
      progress={ACTIVE_PROGRESS}
      currentUserId={MOCK_CURRENT_USER.id}
      onClick={() => window.location.assign('/preview/challenges')}
    />
  );

  return (
    <AppLayout groupName="Wolfpack - Göteborgsvarvet 2026" topbarLeftWidget={widget}>
      <div className="mb-4 px-3 py-2 rounded-md bg-primary/10 border border-primary/20 text-sm text-primary font-medium inline-block">
        Preview — visar exempeldata
      </div>
      <Leaderboard users={MOCK_USERS} currentUser={MOCK_CURRENT_USER} />
    </AppLayout>
  );
};

export default LeaderboardPreviewPage;
