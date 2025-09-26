
import React from 'react';
import { User, getLongestRun, calculateWeekendAverage } from './titleSystemUtils';

interface UserTitleStatusProps {
  user: User;
}

export const UserTitleStatus: React.FC<UserTitleStatusProps> = ({ user }) => {
  const longestRun = getLongestRun(user.runs);
  const weekendAvg = calculateWeekendAverage(user.runs);
  
  return (
    <div className="p-3 border rounded-lg">
      <div className="font-semibold mb-2">{user.name}</div>
      <div className="text-sm space-y-1 text-muted-foreground">
        <div>Longest Run: {longestRun.toFixed(1)}km {longestRun >= 12 ? '✅' : '❌'}</div>
        <div>Longest Streak: {user.longest_streak} days {user.longest_streak >= 20 ? '✅' : '❌'}</div>
        <div>Total KM: {user.total_km.toFixed(1)}km {user.total_km >= 100 ? '✅' : '❌'}</div>
        <div>Weekend Avg: {weekendAvg.toFixed(1)}km {weekendAvg >= 9 ? '✅' : '❌'}</div>
      </div>
    </div>
  );
};
