
import React from 'react';
import { Progress } from '@/shared/components/ui/progress';
import { leaderboardUtils } from '@/utils/leaderboardUtils';

interface LevelProgressProps {
  xpProgress: number;
  xpLeftForNextLevel: number;
}

export const LevelProgress: React.FC<LevelProgressProps> = ({ 
  xpProgress, 
  xpLeftForNextLevel 
}) => {
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm">
        <span>Level Progress</span>
        <span className="text-muted-foreground">
          {xpLeftForNextLevel > 0 ? `${leaderboardUtils.formatXPForDisplay(xpLeftForNextLevel)} XP left` : 'Max Level!'}
        </span>
      </div>
      <Progress value={xpProgress} className="h-2 border border-black" />
    </div>
  );
};

