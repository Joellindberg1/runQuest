import { useState, useEffect } from 'react';
import { backendApi } from '@/shared/services/backendApi';
import { log } from '@/shared/utils/logger';

export interface RunWithUser {
  id: string;
  user_id: string;
  date: string;
  distance: number;
  xp_gained: number;
  multiplier: number;
  streak_day: number;
  base_xp: number;
  km_xp: number;
  distance_bonus: number;
  streak_bonus: number;
  source?: string;
  user_name: string;
  user_level: number;
  user_profile_picture?: string;
}

export const useGroupRunHistory = () => {
  const [runs, setRuns] = useState<RunWithUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRuns = async () => {
      try {
        const result = await backendApi.getGroupRunHistory();

        if (!result.success || !result.data) {
          throw new Error(result.error || 'Failed to fetch group run history');
        }

        setRuns(result.data.map((run) => ({
          id: run.id,
          user_id: run.user_id,
          date: run.date,
          distance: run.distance,
          xp_gained: run.xp_gained,
          multiplier: run.multiplier,
          streak_day: run.streak_day,
          base_xp: run.base_xp,
          km_xp: run.km_xp,
          distance_bonus: run.distance_bonus,
          streak_bonus: run.streak_bonus,
          source: run.source,
          user_name: run.user_name,
          user_level: run.user_level,
          user_profile_picture: run.user_profile_picture,
        })));
      } catch (error) {
        log.error('Error fetching group runs', error);
      } finally {
        setLoading(false);
      }
    };

    fetchRuns();
  }, []);

  return { runs, loading };
};
