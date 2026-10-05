import { useMemo } from 'react';
import { useAuth } from '@/providers/authContext';
import { useUsersWithRuns } from '@/shared/hooks/useUsersWithRuns';
import { getLevelFromXP } from '@/shared/services/levelService';
import { leaderboardUtils } from '@/shared/utils/leaderboardUtils';

export interface ShellUser {
  id: string;
  name: string;
  initials: string;
  pictureUrl: string | null;
  level: number | null;
  /** Placering i gruppen (1-baserad); null tills leaderboard-datan är hämtad. */
  rank: number | null;
}

function initialsOf(name: string): string {
  const letters = name.split(/\s+/).filter(Boolean).map((part) => part[0]);
  return (letters.length > 1 ? letters[0] + letters[letters.length - 1] : letters[0] ?? '?').toUpperCase();
}

/** Inloggad användare + level/placering för header och avatarmeny (ur befintlig leaderboard-data). */
export function useShellUser(): ShellUser | null {
  const { user } = useAuth();
  const users = useUsersWithRuns(!!user);

  return useMemo(() => {
    if (!user) return null;
    const me = users.data?.find((u) => u.id === user.id);
    const sorted = users.data ? leaderboardUtils.filterAndSortUsers(users.data) : null;
    const xp = me?.total_xp ?? user.total_xp ?? null;
    return {
      id: user.id,
      name: user.name,
      initials: initialsOf(user.name),
      pictureUrl: me?.profile_picture ?? user.profile_picture ?? null,
      level: xp === null ? (user.current_level ?? null) : getLevelFromXP(xp),
      rank: me && sorted ? leaderboardUtils.getUserPosition(me, sorted) : null,
    };
  }, [user, users.data]);
}
