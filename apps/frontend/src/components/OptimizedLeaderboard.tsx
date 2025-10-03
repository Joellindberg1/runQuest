/**
 * Optimized Leaderboard component using React Query for better performance
 */

import React from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { leaderboardUtils } from '@/utils/leaderboardUtils';
import { getLevelFromXP } from '@/utils/xpCalculation';
import { UserTitles } from './leaderboard/UserTitles';
import { UserStats } from './leaderboard/UserStats';
import { UserCardHeader } from './leaderboard/UserCardHeader';
import { LevelProgress } from './leaderboard/LevelProgress';
import { User } from '@/types/run';
import { useMultipleUserTitles } from '@/hooks/useTitleQueries';

interface OptimizedLeaderboardProps {
  users: User[];
  currentUser: User;
}

export const OptimizedLeaderboard: React.FC<OptimizedLeaderboardProps> = ({ users, currentUser }) => {
  const userIds = users.map(user => user.id);
  const { 
    data: userTitlesData = {}, 
    isLoading: titlesLoading 
  } = useMultipleUserTitles(userIds);

  const sortedUsers = leaderboardUtils.filterAndSortUsers(users);

  if (sortedUsers.length === 0) {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold mb-2">🏆 Leaderboard 🏆</h1>
        </div>
        <div className="text-center py-12">
          <div className="text-2xl text-gray-500 mb-2">No users found</div>
          <div className="text-gray-400">Start logging runs to appear on the leaderboard!</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold mb-2">🏆 Leaderboard 🏆</h1>
        {titlesLoading && (
          <div className="text-sm text-gray-500">Loading title data...</div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {sortedUsers.map((user) => {
          const isCurrentUser = user.id === currentUser.id;
          const stats = leaderboardUtils.calculateUserStats(user);
          const position = leaderboardUtils.getUserPosition(user, sortedUsers);
          const isPodium = position <= 3;
          
          // Use optimized title data - only current holders
          const allUserTitles = userTitlesData[user.id] || [];
          const currentHolderTitles = allUserTitles.filter(title => title.is_current_holder);
          
          const initials = leaderboardUtils.getInitials(user.name);
          
          const getPositionStyles = () => {
            if (position === 1) {
              // Gold - medium border for better visibility
              return 'border-2 !border-amber-600 bg-amber-100 shadow-amber-200/40 shadow-lg';
            } else if (position === 2) {
              // Silver - medium border for better visibility
              return 'border-2 !border-zinc-600 bg-zinc-100 shadow-zinc-300/40 shadow-lg';
            } else if (position === 3) {
              // Bronze - medium border for better visibility
              return 'border-2 !border-orange-800 bg-orange-200 shadow-orange-300/40 shadow-lg';
            }
            // Default darker gray border for positions 4+ - same width as podium but darker color
            return 'border-2 !border-gray-500';
          };
          
          return (
            <Card 
              key={user.id} 
              className={`relative ${
                isCurrentUser && position > 3 ? 'ring-2 ring-green-500 bg-green-50/50' : getPositionStyles()
              }`}
            >
              {/* Green indicator for current user in top 3 positions */}
              {isCurrentUser && isPodium && (
                <div className="absolute top-2 left-2 w-4 h-4 bg-green-500 rounded-full shadow-xl shadow-green-500/70 animate-pulse z-10"></div>
              )}
              
              <CardHeader className="pb-3">
                <UserCardHeader 
                  user={user}
                  position={position}
                  level={stats.level}
                  initials={initials}
                />

                <UserTitles 
                  titles={currentHolderTitles} 
                  isLoading={titlesLoading}
                />

                <LevelProgress 
                  xpProgress={stats.xpProgress}
                  xpLeftForNextLevel={stats.xpLeftForNextLevel}
                />
              </CardHeader>

              <CardContent>
                <UserStats 
                  user={user}
                  stats={{
                    numberOfRuns: stats.numberOfRuns,
                    longestRun: stats.longestRun,
                    averageKmPerRun: stats.averageKmPerRun,
                    avgXpPer14Days: stats.avgXpPer14Days,
                    daysToNextLevel: stats.daysToNextLevel,
                    latestRun: stats.latestRun
                  }}
                />
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};