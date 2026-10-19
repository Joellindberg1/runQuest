
import type { Run, User } from '@runquest/types'
import { MS_DAY, weekendAverageKm } from '@runquest/shared';
import { getLevelFromXP, getXPForLevel } from '@/shared/services/levelService';
import { MAX_LEVEL } from '@/constants/appConstants';
export { getInitials } from '@/shared/utils/formatters';

export const leaderboardUtils = {
  filterAndSortUsers(users: User[]): User[] {
    const filteredUsers = users.filter(user => user.name.toLowerCase() !== 'admin');
    return [...filteredUsers].sort((a, b) => {
      const aLevel = getLevelFromXP(a.total_xp);
      const bLevel = getLevelFromXP(b.total_xp);
      if (aLevel !== bLevel) {
        return bLevel - aLevel; // Higher level first
      }
      return b.total_xp - a.total_xp; // Higher XP first if same level
    });
  },

  getUserPosition(user: User, sortedUsers: User[]): number {
    let position = 1;
    const userLevel = getLevelFromXP(user.total_xp);
    
    for (const sortedUser of sortedUsers) {
      if (sortedUser.id === user.id) break;
      
      const sortedUserLevel = getLevelFromXP(sortedUser.total_xp);
      if (sortedUserLevel > userLevel || 
          (sortedUserLevel === userLevel && sortedUser.total_xp > user.total_xp)) {
        position++;
      }
    }
    return position;
  },

  calculateUserStats(user: User) {
    const level = getLevelFromXP(user.total_xp);
    const currentLevelXP = getXPForLevel(level);
    const nextLevelXP = getXPForLevel(level + 1);
    const xpProgress = level < MAX_LEVEL ? ((user.total_xp - currentLevelXP) / (nextLevelXP - currentLevelXP)) * 100 : 100;
    const xpLeftForNextLevel = level < MAX_LEVEL ? Math.round((nextLevelXP - user.total_xp) * 10) / 10 : 0;

    const numberOfRuns = user.runs?.length || 0;
    const longestRun = numberOfRuns > 0 ? Math.max(...(user.runs?.map(run => run.distance) || [0])) : 0;
    const averageKmPerRun = numberOfRuns > 0 ? (user.total_km / numberOfRuns) : 0;
    const weekendAverage = this.calculateWeekendAverage(user.runs || []);
    const last14DaysXP = this.calculateLast14DaysXP(user);
    const daysToNextLevel = last14DaysXP > 0 && level < MAX_LEVEL ? Math.ceil(xpLeftForNextLevel / last14DaysXP) : 0;

    // Get latest run
    const latestRun = user.runs && user.runs.length > 0 
      ? user.runs.reduce((latest, run) => 
          new Date(run.date) > new Date(latest.date) ? run : latest
        )
      : null;

    return {
      level,
      xpProgress: Math.max(0, Math.min(100, xpProgress)),
      xpLeftForNextLevel,
      xpInLevel: level < MAX_LEVEL ? Math.round(user.total_xp - currentLevelXP) : 0,
      xpLevelRange: level < MAX_LEVEL ? Math.round(nextLevelXP - currentLevelXP) : 0,
      numberOfRuns,
      longestRun,
      averageKmPerRun,
      weekendAverage,
      avgXpPer14Days: last14DaysXP,
      daysToNextLevel,
      latestRun: latestRun ? { date: latestRun.date, distance: latestRun.distance } : null
    };
  },

  calculateWeekendAverage(runs: Run[]): number {
    return weekendAverageKm(runs.map(run => ({ day: run.date.slice(0, 10), km: run.distance })));
  },

  calculateLast14DaysXP(user: User): number {
    const today = new Date();
    const fourteenDaysAgo = new Date(today.getTime() - (13 * MS_DAY)); // 13 days ago + today = 14 days
    
    const last14DaysRuns = (user.runs || []).filter(run => {
      const runDate = new Date(run.date);
      return runDate >= fourteenDaysAgo && runDate <= today;
    });

    const totalXP = last14DaysRuns.reduce((sum, run) => sum + (run.xp_gained || 0), 0);
    return Math.floor(totalXP / 14);
  },

}
