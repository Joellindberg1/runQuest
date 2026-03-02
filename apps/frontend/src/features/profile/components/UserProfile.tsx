import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Progress } from '@/shared/components/ui/progress';
import { Calendar } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/shared/components/ui/avatar';
import { leaderboardUtils } from '@/shared/utils/leaderboardUtils';
import type { User as UserType } from '@/types/run';
import { UserRunHistory } from './UserRunHistory';
import { UserTitlesList } from './UserTitlesList';
import { getLevelFromXP, getXPForLevel, getXPForNextLevel } from '@/shared/services/levelService';
import { MAX_LEVEL } from '@/constants/appConstants';
import { getInitials } from '@/shared/utils/formatters';

interface UserProfileProps {
  user: UserType;
  allUsers: UserType[];
  onRunUpdated: () => void;
}

const getStreakMultiplier = (streak: number) => {
  if (streak >= 270) return 2.0;
  if (streak >= 240) return 1.9;
  if (streak >= 220) return 1.8;
  if (streak >= 180) return 1.7;
  if (streak >= 120) return 1.6;
  if (streak >= 90) return 1.5;
  if (streak >= 60) return 1.4;
  if (streak >= 30) return 1.3;
  if (streak >= 15) return 1.2;
  if (streak >= 5) return 1.1;
  return 1.0;
};

export const UserProfile: React.FC<UserProfileProps> = ({ user, allUsers, onRunUpdated }) => {
  const currentLevel = getLevelFromXP(user.total_xp);
  const currentLevelXP = getXPForLevel(currentLevel);
  const nextLevelXP = currentLevel < MAX_LEVEL ? getXPForNextLevel(currentLevel) : currentLevelXP;
  const xpProgress = currentLevel < MAX_LEVEL
    ? ((user.total_xp - currentLevelXP) / (nextLevelXP - currentLevelXP)) * 100
    : 100;
  const currentMultiplier = getStreakMultiplier(user.current_streak);

  const position = allUsers.length > 0
    ? leaderboardUtils.getUserPosition(user, leaderboardUtils.filterAndSortUsers(allUsers))
    : null;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6 items-start">

        {/* Left column: profile info + streak + titles */}
        <div className="space-y-6">

          {/* Profile card + Streak Stats side by side */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* Profile card — avatar, stats, level progress */}
            <Card className="bg-sidebar border-2 border-foreground/15">
              <CardHeader>
                {/* Row: avatar left | name center | position right */}
                <div className="grid grid-cols-[auto_1fr_auto] items-center gap-4">
                  <Avatar className="h-16 w-16 shrink-0">
                    <AvatarImage src={user.profile_picture || ''} />
                    <AvatarFallback className="text-lg font-semibold">
                      {getInitials(user.name)}
                    </AvatarFallback>
                  </Avatar>
                  <h2 className="text-xl font-bold text-center">{user.name}</h2>
                  <span className="text-lg font-bold shrink-0">#{position ?? '?'}</span>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Stats */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold">Lvl {currentLevel}</div>
                    <div className="text-sm text-muted-foreground">Level</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold">{user.total_xp.toLocaleString()}</div>
                    <div className="text-sm text-muted-foreground">Total XP</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold">{user.total_km.toFixed(1)}</div>
                    <div className="text-sm text-muted-foreground">Total KM</div>
                  </div>
                </div>

                {/* XP Progress bar */}
                <div className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>Level {currentLevel}</span>
                    <span>Level {Math.min(currentLevel + 1, MAX_LEVEL)}</span>
                  </div>
                  <Progress value={Math.max(0, Math.min(100, xpProgress))} className="h-3 border border-foreground/20" />
                  <div className="text-center text-sm text-muted-foreground">
                    {currentLevel < MAX_LEVEL
                      ? `${(nextLevelXP - user.total_xp).toLocaleString()} XP until next level`
                      : 'Max Level Reached!'}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Streak Stats */}
            <Card className="bg-sidebar border-2 border-foreground/15">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Calendar className="w-4 h-4" />
                  Streak Stats
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div className="text-center p-2 bg-background border border-foreground/10 rounded-lg">
                    <div className="text-xl font-bold">{user.current_streak}</div>
                    <div className="text-xs text-muted-foreground">Current</div>
                  </div>
                  <div className="text-center p-2 bg-background border border-foreground/10 rounded-lg">
                    <div className="text-xl font-bold">{currentMultiplier}x</div>
                    <div className="text-xs text-muted-foreground">Multiplier</div>
                  </div>
                </div>
                <div className="text-center p-2 bg-background border border-foreground/10 rounded-lg">
                  <div className="text-xl font-bold">{user.longest_streak}</div>
                  <div className="text-xs text-muted-foreground">Longest Streak</div>
                </div>
              </CardContent>
            </Card>
          </div>

          <UserTitlesList userId={user.id} />
        </div>

        {/* Right column: Run History (1/3 width on lg+) */}
        <div>
          <UserRunHistory runs={user.runs || []} onRunUpdated={onRunUpdated} />
        </div>

      </div>
    </div>
  );
};
