import { useQuery } from '@tanstack/react-query';
import { backendApi } from '@/shared/services/backendApi';
import type { User } from '@runquest/types';

/** En cache för gruppens användare + rundor: skalet, sidorna och Runner card delar den. */
export const USERS_WITH_RUNS_QUERY_KEY = ['users-with-runs'] as const;

export function mapApiUser(u: User): User {
  return {
    id: u.id,
    name: u.name,
    total_xp: u.total_xp || 0,
    current_level: u.current_level || 1,
    total_km: parseFloat(u.total_km?.toString() || '0'),
    current_streak: u.current_streak || 0,
    longest_streak: u.longest_streak || 0,
    profile_picture: u.profile_picture || undefined,
    wins: u.wins ?? 0,
    draws: u.draws ?? 0,
    losses: u.losses ?? 0,
    challenge_active: u.challenge_active ?? false,
    challenge_counts: u.challenge_counts ?? {},
    displayed_title_ids: u.displayed_title_ids ?? [],
    gender: u.gender ?? null,
    runs: u.runs?.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      date: r.date,
      distance: parseFloat(r.distance.toString()),
      xp_gained: r.xp_gained,
      multiplier: parseFloat(r.multiplier.toString()),
      streak_day: r.streak_day,
      base_xp: r.base_xp,
      km_xp: r.km_xp,
      distance_bonus: r.distance_bonus,
      streak_bonus: r.streak_bonus,
      is_treadmill: r.is_treadmill ?? null,
    })) ?? [],
  };
}

export function useUsersWithRuns(enabled = true) {
  return useQuery({
    queryKey: USERS_WITH_RUNS_QUERY_KEY,
    queryFn: async () => {
      const res = await backendApi.getUsersWithRuns();
      if (!res.success || !res.data) throw new Error(res.error || 'Failed to fetch users');
      return res.data.map(mapApiUser);
    },
    enabled,
  });
}
