
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { runService } from '@/services/runService';
import { leaderboardUtils } from '@/utils/leaderboardUtils';
import { getLevelFromXP } from '@/utils/xpCalculation';
import { UserTitles } from './leaderboard/UserTitles';
import { UserStats } from './leaderboard/UserStats';
import { UserCardHeader } from './leaderboard/UserCardHeader';
import { LevelProgress } from './leaderboard/LevelProgress';
import { User, UserTitle } from '@/types/run';

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
        const userTitleData = await runService.getUserTitles(user.id);
        titlesByUser[user.id] = userTitleData.filter(title => title.is_current_holder);
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
          <p className="text-muted-foreground">Compete with your fellow runners</p>
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
        <p className="text-muted-foreground">Compete with your fellow runners</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {sortedUsers.map((user) => {
          const isCurrentUser = user.id === currentUser.id;
          const stats = leaderboardUtils.calculateUserStats(user);
          const position = leaderboardUtils.getUserPosition(user, sortedUsers);
          const isPodium = position <= 3;
          const titles = userTitles[user.id] || [];
          const initials = leaderboardUtils.getInitials(user.name);
          
          return (
            <Card 
              key={user.id} 
              className={`relative ${
                isCurrentUser ? 'ring-2 ring-green-500 bg-green-50/50' : ''
              } ${isPodium ? 'border-2 border-yellow-400 bg-gradient-to-br from-yellow-50 to-amber-50' : ''}`}
            >
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
