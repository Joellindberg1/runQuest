import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Progress } from '@/shared/components/ui/progress';
import { User, Calendar } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/shared/components/ui/avatar';
import { leaderboardUtils } from '@/utils/leaderboardUtils';
import type { User as UserType } from '@/types/run';
import { UserRunHistory } from './UserRunHistory';
import { UserTitlesList } from './UserTitlesList';
import { getLevelFromXP, getXPForLevel, getXPForNextLevel } from '@/utils/xpCalculation';
import { MAX_LEVEL } from '@/constants/appConstants';
import { getInitials } from '@/shared/utils/formatters';

interface UserProfileProps {
  user: UserType;
  allUsers: UserType[];
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

export const UserProfile: React.FC<UserProfileProps> = ({ user, allUsers }) => {
  const currentLevel = getLevelFromXP(user.total_xp);
  const currentLevelXP = getXPForLevel(currentLevel);
  const nextLevelXP = currentLevel < MAX_LEVEL ? getXPForNextLevel(currentLevel) : currentLevelXP;
  const xpProgress = currentLevel < MAX_LEVEL ? ((user.total_xp - currentLevelXP) / (nextLevelXP - currentLevelXP)) * 100 : 100;
  const currentMultiplier = getStreakMultiplier(user.current_streak);

  const position = allUsers.length > 0
    ? leaderboardUtils.getUserPosition(user, leaderboardUtils.filterAndSortUsers(allUsers))
    : null;

  const handleRunUpdated = () => {
    window.dispatchEvent(new Event('runsUpdated'));
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Profile Header */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="w-5 h-5" />
            {user.name}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-6 mb-6">
            <div className="flex flex-col items-center gap-3">
              <Avatar className="h-24 w-24">
                <AvatarImage src={user.profile_picture || ''} />
                <AvatarFallback className="text-lg font-semibold">
                  {getInitials(user.name)}
                </AvatarFallback>
              </Avatar>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 flex-1">
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">Lvl {currentLevel}</div>
                <div className="text-sm text-gray-600">Level</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">{user.total_xp.toLocaleString()}</div>
                <div className="text-sm text-gray-600">Total XP</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-600">{user.total_km.toFixed(1)}</div>
                <div className="text-sm text-gray-600">Total KM</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-orange-600">{user.current_streak}</div>
                <div className="text-sm text-gray-600">Day Streak</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-red-600">#{position ?? '?'}</div>
                <div className="text-sm text-gray-600">Position</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Level Progress */}
      <Card>
        <CardHeader>
          <CardTitle>Level Progress</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Level {currentLevel}</span>
              <span>Level {Math.min(currentLevel + 1, MAX_LEVEL)}</span>
            </div>
            <Progress value={Math.max(0, Math.min(100, xpProgress))} className="h-3 border border-black" />
            <div className="text-center text-sm text-gray-600">
              {currentLevel < MAX_LEVEL ? `${(nextLevelXP - user.total_xp).toLocaleString()} XP until next level` : 'Max Level Reached!'}
            </div>
          </div>
        </CardContent>
      </Card>

      <UserTitlesList userId={user.id} />

      {/* Streak Information */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            Streak Stats
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="text-center p-4 bg-orange-50 rounded-lg">
              <div className="text-xl font-bold text-orange-600">{user.current_streak}</div>
              <div className="text-sm text-gray-600">Current Streak</div>
            </div>
            <div className="text-center p-4 bg-yellow-50 rounded-lg">
              <div className="text-xl font-bold text-yellow-600">{currentMultiplier}x</div>
              <div className="text-sm text-gray-600">XP Multiplier</div>
            </div>
            <div className="text-center p-4 bg-green-50 rounded-lg">
              <div className="text-xl font-bold text-green-600">{user.longest_streak}</div>
              <div className="text-sm text-gray-600">Longest Streak</div>
            </div>
          </div>
          <div className="mt-4 text-sm text-gray-600">
            Keep running daily (min 1.6km) to maintain your streak and multiplier!
          </div>
        </CardContent>
      </Card>

      <UserRunHistory runs={user.runs || []} onRunUpdated={handleRunUpdated} />
    </div>
  );
};
