import { useState, useEffect } from 'react';
import { useAuth } from '@/features/auth';
import { backendApi } from '@/shared/services/backendApi';
import { toast } from 'sonner';
import { log } from '@/shared/utils/logger';
import type { User } from '@/types/run';

interface ApiUser {
  id: string;
  name: string;
  total_xp?: number;
  current_level?: number;
  total_km?: number | string;
  current_streak?: number;
  longest_streak?: number;
  profile_picture?: string;
  wins?: number;
  draws?: number;
  losses?: number;
  challenge_active?: boolean;
  challenge_counts?: { minor?: number; major?: number; legendary?: number };
  runs?: Array<{
    id: string;
    user_id: string;
    date: string;
    distance: number | string;
    xp_gained: number;
    multiplier: number | string;
    streak_day: number;
    base_xp: number;
    km_xp: number;
    distance_bonus: number;
    streak_bonus: number;
  }>;
}

interface UseLeaderboardDataResult {
  users: User[];
  currentUser: User | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useLeaderboardData(): UseLeaderboardDataResult {
  const { user: authUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUsers = async () => {
    try {
      const result = await backendApi.getUsersWithRuns();

      if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to fetch users');
      }

      const usersWithRuns: User[] = result.data.map((user: ApiUser) => ({
        id: user.id,
        name: user.name,
        total_xp: user.total_xp || 0,
        current_level: user.current_level || 1,
        total_km: parseFloat(user.total_km?.toString() || '0'),
        current_streak: user.current_streak || 0,
        longest_streak: user.longest_streak || 0,
        profile_picture: user.profile_picture || undefined,
        wins: user.wins ?? 0,
        draws: user.draws ?? 0,
        losses: user.losses ?? 0,
        challenge_active: user.challenge_active ?? false,
        challenge_counts: user.challenge_counts ?? {},
        runs: user.runs?.map((run) => ({
          id: run.id,
          user_id: run.user_id,
          date: run.date,
          distance: parseFloat(run.distance.toString()),
          xp_gained: run.xp_gained,
          multiplier: parseFloat(run.multiplier.toString()),
          streak_day: run.streak_day,
          base_xp: run.base_xp,
          km_xp: run.km_xp,
          distance_bonus: run.distance_bonus,
          streak_bonus: run.streak_bonus,
        })) || [],
      }));

      setUsers(usersWithRuns);

      if (authUser) {
        const current = usersWithRuns.find((u) => u.id === authUser.id);
        setCurrentUser(current || null);
      }
    } catch (error) {
      log.error('Failed to fetch users', error);
      toast.error('Failed to load user data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authUser) {
      fetchUsers();
    } else {
      setLoading(false);
    }
  }, [authUser]);

  return { users, currentUser, loading, refresh: fetchUsers };
}
