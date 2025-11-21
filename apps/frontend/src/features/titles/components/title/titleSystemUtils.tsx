
import React from 'react';
import { Trophy, Calendar, Target } from 'lucide-react';

export interface Run {
  id: string;
  date: string;
  distance: number;
}

export interface User {
  id: string;
  name: string;
  total_xp: number;
  current_level: number;
  total_km: number;
  current_streak: number;
  longest_streak: number;
  runs: Run[];
}

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

export const calculateWeekendAverage = (runs: Run[]) => {
  const weekendTotals = new Map<string, number>();
  
  runs.forEach(run => {
    const date = new Date(run.date);
    const day = date.getDay();
    
    if (day === 0 || day === 6) { // Sunday or Saturday
      // Get the Monday of the week containing this weekend day
      const monday = new Date(date);
      monday.setDate(date.getDate() - (date.getDay() === 0 ? 6 : date.getDay() - 1));
      const weekKey = monday.toISOString().split('T')[0];
      
      weekendTotals.set(weekKey, (weekendTotals.get(weekKey) || 0) + run.distance);
    }
  });

  const weekends = Array.from(weekendTotals.values());
  return weekends.length > 0 ? weekends.reduce((sum, total) => sum + total, 0) / weekends.length : 0;
};

export const getLongestRun = (runs: Run[]) => {
  return runs.length > 0 ? Math.max(...runs.map(run => run.distance)) : 0;
};

