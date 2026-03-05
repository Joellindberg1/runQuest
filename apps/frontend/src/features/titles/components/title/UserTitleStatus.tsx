
import React from 'react';

export interface UserEligibility {
  userId: string;
  name: string;
  longestRun: number;
  weekendAvg: number;
  longestStreak: number;
  totalKm: number;
}

interface UserTitleStatusProps {
  eligibility: UserEligibility;
}

export const UserTitleStatus: React.FC<UserTitleStatusProps> = ({ eligibility }) => {
  const { name, longestRun, weekendAvg, longestStreak, totalKm } = eligibility;

  return (
    <div className="p-3 border border-foreground/50 rounded-lg bg-background">
      <div className="font-semibold mb-2">{name}</div>
      <div className="text-sm space-y-1 text-muted-foreground">
        <div>Longest Run: {longestRun.toFixed(1)}km {longestRun >= 12 ? '✅' : '❌'}</div>
        <div>Longest Streak: {longestStreak} days {longestStreak >= 20 ? '✅' : '❌'}</div>
        <div>Total KM: {totalKm.toFixed(1)}km {totalKm >= 100 ? '✅' : '❌'}</div>
        <div>Weekend Avg: {weekendAvg.toFixed(1)}km {weekendAvg >= 9 ? '✅' : '❌'}</div>
      </div>
    </div>
  );
};
