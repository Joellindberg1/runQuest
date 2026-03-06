
import React from 'react';
import { Trophy, Calendar, Target } from 'lucide-react';
import type { Run, User } from '@runquest/types';
import { leaderboardUtils } from '@/shared/utils/leaderboardUtils';

export type { Run, User };

export interface Title {
  id: string;
  name: string;
  description: string;
  unlock_requirement: number;
  current_holder_id: string | null;
  current_value: number | null;
  holder_name?: string;
  runners_up?: Array<{
    user_id: string;
    user_name: string;
    value: number;
  }>;
}

export const getTitleIcon = (titleName: string) => {
  if (titleName.includes('Eliud Kipchoge')) return <Trophy className="w-6 h-6 text-blue-500" />;
  if (titleName.includes('Daaaaaviiiiiid GOGGINGS')) return <Calendar className="w-6 h-6 text-orange-500" />;
  if (titleName.includes('Ultra Man')) return <Trophy className="w-6 h-6 text-purple-500" />;
  if (titleName.includes('Weekend Destroyer')) return <Target className="w-6 h-6 text-green-500" />;
  return <Trophy className="w-6 h-6 text-gray-500" />;
};

export const getValueSuffix = (titleName: string) => {
  if (titleName.includes('Daaaaaviiiiiid GOGGINGS')) return ' days';
  if (titleName.includes('Weekend Destroyer')) return 'km avg';
  return 'km';
};

export const calculateWeekendAverage = (runs: Run[]) =>
  leaderboardUtils.calculateWeekendAverage(runs);

export const getLongestRun = (runs: Run[]) => {
  return runs.length > 0 ? Math.max(...runs.map(run => run.distance)) : 0;
};

