import React from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Leaderboard } from '@/features/leaderboard';
import type { User, Run } from '@/types/run';

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
  {
    id: 'u1',
    name: 'Anna Lindqvist',
    total_xp: 8420,
    current_level: 12,
    total_km: 312.5,
    current_streak: 7,
    longest_streak: 21,
    runs: [
      makeRun('u1', 0,  8.2, 310),
      makeRun('u1', 1, 10.1, 380),
      makeRun('u1', 3, 12.5, 450),
      makeRun('u1', 5,  6.0, 240),
      makeRun('u1', 7, 21.1, 790),
    ],
  },
  {
    id: 'u2',
    name: 'Erik Svensson',
    total_xp: 7150,
    current_level: 10,
    total_km: 265.0,
    current_streak: 4,
    longest_streak: 14,
    runs: [
      makeRun('u2', 1,  5.0, 200),
      makeRun('u2', 3, 15.0, 560),
      makeRun('u2', 6, 10.2, 390),
      makeRun('u2', 8,  7.5, 290),
    ],
  },
  {
    id: 'u3',
    name: 'Maria Johansson',
    total_xp: 6380,
    current_level: 9,
    total_km: 218.7,
    current_streak: 2,
    longest_streak: 10,
    runs: [
      makeRun('u3', 2,  9.0, 345),
      makeRun('u3', 4, 11.3, 420),
      makeRun('u3', 9,  5.5, 215),
    ],
  },
  {
    id: 'u4',
    name: 'Johan Karlsson',
    total_xp: 5200,
    current_level: 8,
    total_km: 178.3,
    current_streak: 0,
    longest_streak: 8,
    runs: [
      makeRun('u4', 5,  7.0, 270),
      makeRun('u4', 9,  6.0, 235),
      makeRun('u4', 14, 9.5, 360),
    ],
  },
  {
    id: 'u5',
    name: 'Sara Nilsson',
    total_xp: 4100,
    current_level: 6,
    total_km: 134.0,
    current_streak: 3,
    longest_streak: 6,
    runs: [
      makeRun('u5', 1, 4.5, 180),
      makeRun('u5', 4, 8.0, 305),
      makeRun('u5', 10, 5.2, 200),
    ],
  },
  {
    id: 'u6',
    name: 'Lars Petersson',
    total_xp: 3750,
    current_level: 5,
    total_km: 112.5,
    current_streak: 1,
    longest_streak: 5,
    runs: [
      makeRun('u6', 0, 6.0, 235),
      makeRun('u6', 7, 5.0, 195),
    ],
  },
  {
    id: 'u7',
    name: 'Klara Bergström',
    total_xp: 2900,
    current_level: 4,
    total_km: 89.0,
    current_streak: 0,
    longest_streak: 4,
    runs: [
      makeRun('u7', 3, 5.5, 215),
      makeRun('u7', 11, 4.0, 160),
    ],
  },
  {
    id: 'u8',
    name: 'Mikael Holm',
    total_xp: 1850,
    current_level: 3,
    total_km: 54.2,
    current_streak: 2,
    longest_streak: 3,
    runs: [
      makeRun('u8', 1, 3.5, 140),
      makeRun('u8', 6, 4.8, 190),
    ],
  },
];

// Use the first user as "current user" for preview purposes
const MOCK_CURRENT_USER = MOCK_USERS[0];

// ─── Page ─────────────────────────────────────────────────────────────────────

const LeaderboardPreviewPage: React.FC = () => {
  return (
    <AppLayout groupName="Wolfpack - Göteborgsvarvet 2026">
      <div className="mb-4 px-3 py-2 rounded-md bg-primary/10 border border-primary/20 text-sm text-primary font-medium inline-block">
        Preview — visar exempeldata
      </div>
      <Leaderboard users={MOCK_USERS} currentUser={MOCK_CURRENT_USER} />
    </AppLayout>
  );
};

export default LeaderboardPreviewPage;
