import type { Run, User } from '@runquest/types';

// Påhittade löpare för exempelvyer utan inloggning: /preview (LeaderboardPreviewPage) och Landing (features/landing).
// EN datamängd, så preview-sidan och landningssidan visar samma "flock". Inga riktiga personer.

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

export const PREVIEW_USERS: User[] = [
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

/** Rank-pilarna är påhittade (positivt = klättrat, som rank_delta i ADR 007). */
export const PREVIEW_RANK_DELTAS: Record<string, number | null> = { u1: 1, u2: -1, u3: 0, u4: 2, u5: null, u6: -2 };
