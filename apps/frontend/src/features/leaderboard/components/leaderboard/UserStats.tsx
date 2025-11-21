
import React from 'react';
import { Target, Zap, Calendar, Clock, TrendingUp, Timer, CalendarDays } from 'lucide-react';
import { User } from '@/types/run';

interface UserStatsProps {
  user: User;
  stats: {
    numberOfRuns: number;
    longestRun: number;
    averageKmPerRun: number;
    avgXpPer14Days: number;
    daysToNextLevel: number;
    latestRun?: { date: string; distance: number } | null;
  };
}

export const UserStats: React.FC<UserStatsProps> = ({ user, stats }) => {
  const formatXP = (xp: number): string => {
    if (xp >= 1000000) {
      return `${(xp / 1000000).toFixed(1)}M`;
    } else if (xp >= 1000) {
      return `${(xp / 1000).toFixed(1)}k`;
    }
    return xp.toString();
  };

  return (
    <div className="space-y-3">
      {/* First row: Runs - Longest */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-blue-500" />
          <div>
            <div className="font-semibold">{stats.numberOfRuns}</div>
            <div className="text-muted-foreground text-xs">Runs</div>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-orange-500" />
          <div>
            <div className="font-semibold">{stats.longestRun.toFixed(1)}km</div>
            <div className="text-muted-foreground text-xs">Longest</div>
          </div>
        </div>
      </div>

      {/* Second row: Avg run (length km) - Total KM */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="flex items-center gap-2">
          <Timer className="w-4 h-4 text-purple-500" />
          <div>
            <div className="font-semibold">{stats.averageKmPerRun.toFixed(1)}km</div>
            <div className="text-muted-foreground text-xs">Avg run</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-green-500" />
          <div>
            <div className="font-semibold">{user.total_km.toFixed(1)}km</div>
            <div className="text-muted-foreground text-xs">Total KM</div>
          </div>
        </div>
      </div>

      {/* Third row: Highest streak - Current streak */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-indigo-500" />
          <div>
            <div className="font-semibold">{user.longest_streak}</div>
            <div className="text-muted-foreground text-xs">Highest Streak</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-pink-500" />
          <div>
            <div className="font-semibold">{user.current_streak}</div>
            <div className="text-muted-foreground text-xs">Current Streak</div>
          </div>
        </div>
      </div>

      {/* Stats section */}
      <div className="border-t pt-3 space-y-2">
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Total XP:</span>
          <span className="font-semibold">{user.total_xp.toLocaleString()}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Avg/day (14d):</span>
          <span className="font-semibold">{stats.avgXpPer14Days} XP</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">To next level (avg 14d XP):</span>
          <span className="font-semibold">
            {stats.daysToNextLevel > 0 ? `${stats.daysToNextLevel} days` : 'Max Level'}
          </span>
        </div>
        
        {/* Latest run section */}
        {stats.latestRun && (
          <div className="flex items-center gap-2 pt-2 border-t">
            <CalendarDays className="w-4 h-4 text-blue-500" />
            <div className="flex-1">
              <div className="text-xs text-muted-foreground">Latest run:</div>
              <div className="text-xs font-semibold">
                {new Date(stats.latestRun.date).toLocaleDateString()} - {stats.latestRun.distance.toFixed(1)}km
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

