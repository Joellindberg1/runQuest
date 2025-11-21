
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { backendApi } from '@/shared/services/backendApi';
import { leaderboardUtils } from '@/utils/leaderboardUtils';
import { getLevelFromXP } from '@/utils/xpCalculation';
import { UserTitles } from './leaderboard/UserTitles';
import { UserStats } from './leaderboard/UserStats';
import { UserCardHeader } from './leaderboard/UserCardHeader';
import { LevelProgress } from './leaderboard/LevelProgress';
import { User, UserTitle } from '@/types/run';
import { AuthDebugInfo } from '@/shared/components/AuthDebugInfo';
import { log } from '@/shared/utils/logger';

interface LeaderboardProps {
  users: User[];
  currentUser: User;
}

export const Leaderboard: React.FC<LeaderboardProps> = ({ users, currentUser }) => {
  const [userTitles, setUserTitles] = useState<Record<string, UserTitle[]>>({});

  const fetchUserTitles = async () => {
    try {
      const titlesByUser: Record<string, UserTitle[]> = {};
      
      for (const user of users) {
        const titleResponse = await backendApi.getUserTitles(user.id);
        const userTitleData = titleResponse.success ? titleResponse.data : null;
        
        // Ensure userTitleData is an array
        if (Array.isArray(userTitleData)) {
          const currentHolderTitles = userTitleData.filter(title => title.is_current_holder);
          titlesByUser[user.id] = currentHolderTitles;
        } else {
          logger.error('User title data is not an array', { userId: user.id, data: userTitleData });
          titlesByUser[user.id] = [];
        }
      }

      setUserTitles(titlesByUser);
    } catch (error) {
      console.error('Error fetching user titles:', error);
    }
  };

  useEffect(() => {
    if (users.length > 0) {
      fetchUserTitles();
    }
  }, [users]);

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
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {sortedUsers.map((user) => {
          const isCurrentUser = user.id === currentUser.id;
          const stats = leaderboardUtils.calculateUserStats(user);
          const position = leaderboardUtils.getUserPosition(user, sortedUsers);
          const isPodium = position <= 3;
          const titles = userTitles[user.id] || [];
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

                <UserTitles titles={titles} />

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

