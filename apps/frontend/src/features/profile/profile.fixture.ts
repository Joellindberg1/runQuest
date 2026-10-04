import type { Run, User } from '@runquest/types';

// Testdata för Profile: rundor och en användare i users-with-runs-formen.

export const ME_ID = 'u-me';

export const run = (over: Partial<Run> & Pick<Run, 'date'>): Run => ({
  id: `r-${over.date}-${over.distance ?? 8}${over.created_at ?? ''}`,
  user_id: ME_ID,
  distance: 8,
  xp_gained: 44,
  multiplier: 1.1,
  streak_day: 1,
  base_xp: 15,
  km_xp: 16,
  distance_bonus: 5,
  streak_bonus: 3,
  is_treadmill: false,
  ...over,
});

export const user = (over: Partial<User> & Pick<User, 'id' | 'name' | 'total_xp'>): User => ({
  current_level: 1,
  total_km: 100,
  current_streak: 0,
  longest_streak: 0,
  runs: [],
  challenge_counts: {},
  displayed_title_ids: [],
  wins: 0,
  draws: 0,
  losses: 0,
  ...over,
});
