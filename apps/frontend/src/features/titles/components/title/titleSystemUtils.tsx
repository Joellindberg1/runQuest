
import React from 'react';
import { Trophy, Calendar, Target, Moon, Sunrise, Coffee, Rabbit, Flame, Ghost, Zap, Mountain, TrendingUp, Clock, Timer, AlarmClock, Footprints } from 'lucide-react';
import type { Run, User } from '@runquest/types';
import { leaderboardUtils } from '@/shared/utils/leaderboardUtils';

export type { Run, User };

export interface Title {
  id: string;
  name: string;
  description: string;
  unlock_requirement: number;
  metric_key?: string;
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
  const n = titleName.toLowerCase();
  if (n.includes('batman'))         return <Moon className="w-6 h-6 text-indigo-500" />;
  if (n.includes('rooster'))        return <Sunrise className="w-6 h-6 text-amber-400" />;
  if (n.includes('lunch'))          return <Coffee className="w-6 h-6 text-yellow-600" />;
  if (n.includes('hamster'))        return <Rabbit className="w-6 h-6 text-pink-400" />;
  if (n.includes('phoenix'))        return <Flame className="w-6 h-6 text-orange-500" />;
  if (n.includes('ghost'))          return <Ghost className="w-6 h-6 text-slate-400" />;
  if (n.includes('consistent'))     return <Zap className="w-6 h-6 text-cyan-500" />;
  if (n.includes('commuter'))       return <Footprints className="w-6 h-6 text-green-500" />;
  if (n.includes('double trouble')) return <Timer className="w-6 h-6 text-rose-500" />;
  if (n.includes('marathoner') && !n.includes('half')) return <Trophy className="w-6 h-6 text-gold-500 text-yellow-500" />;
  if (n.includes('half marathoner')) return <Trophy className="w-6 h-6 text-silver-500 text-gray-400" />;
  if (n.includes('finisher'))       return <AlarmClock className="w-6 h-6 text-violet-500" />;
  if (n.includes('monthly monster')) return <TrendingUp className="w-6 h-6 text-emerald-500" />;
  if (n.includes('mountain goat'))  return <Mountain className="w-6 h-6 text-stone-500" />;
  if (n.includes('vertical'))       return <Mountain className="w-6 h-6 text-teal-500" />;
  if (n.includes('kipchoge'))       return <Trophy className="w-6 h-6 text-blue-500" />;
  if (n.includes('goggings'))       return <Calendar className="w-6 h-6 text-orange-500" />;
  if (n.includes('ultra man'))      return <Trophy className="w-6 h-6 text-purple-500" />;
  if (n.includes('weekend destroyer')) return <Target className="w-6 h-6 text-green-500" />;
  return <Trophy className="w-6 h-6 text-gray-500" />;
};

/** Format a title value for display given its metric_key. */
export function formatTitleValue(metricKey: string | undefined, value: number): string {
  switch (metricKey) {
    case 'nightRunCount':
    case 'earlyRunCount':
    case 'lunchRunCount':
      return `${Math.round(value)} runs`;
    case 'maxRunsOneWeek':
      return `${Math.round(value)} runs/wk`;
    case 'maxWeekdayStreak':
      return `${Math.round(value)} weekdays`;
    case 'longestStreak':
      return `${Math.round(value)} days`;
    case 'totalElevationGain':
    case 'bestSingleRunElevation':
      return `${Math.round(value)}m`;
    case 'fastestMarathon': {
      if (value < -100) return '—';
      const mins = Math.round(720 - value);
      return `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}m`;
    }
    case 'fastestHalfMarathon': {
      if (value < -100) return '—';
      const mins = Math.round(360 - value);
      return `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}m`;
    }
    case 'lowestPaceStdDev': {
      const stdDev = (10000 / value).toFixed(1);
      return `${stdDev}s/km std`;
    }
    case 'lastRunOfWeek': {
      const d = new Date(value * 1000);
      return d.toLocaleDateString('sv-SE', { month: 'short', day: 'numeric' });
    }
    // Distance-based (km)
    default:
      return `${value.toFixed(1)}km`;
  }
}

/** Legacy suffix helper — kept for any remaining call sites. */
export const getValueSuffix = (titleName: string) => {
  if (titleName.includes('Daaaaaviiiiiid GOGGINGS')) return ' days';
  if (titleName.includes('Weekend Destroyer')) return 'km avg';
  return 'km';
};

export const calculateWeekendAverage = (runs: Run[]) =>
  leaderboardUtils.calculateWeekendAverage(runs);

export const getLongestRun = (runs: Run[]) =>
  runs.length > 0 ? Math.max(...runs.map(run => run.distance)) : 0;
