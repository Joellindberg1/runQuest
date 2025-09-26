
import { Run, User } from '@/types/run'

export const leaderboardUtils = {
  // Level system with exact XP requirements
  levelXpRequirements: [
    0, 50, 102.5, 158.15, 217.139, 280.84712, 349.6518896, 423.9610408, 504.9580155, 594.0546878,
    693.8429607, 806.6037091, 934.0233548, 1079.281751, 1244.876322, 1436.966025, 1659.790081, 1920.494226,
    2228.125117, 2591.129568, 3026.73491, 3549.46132, 4181.960276, 4953.609002, 5902.736936, 7089.146852,
    8584.023347, 10482.5165, 12912.58773, 16071.68033
  ],

  getXPForLevel(level: number): number {
    return level <= 30 ? this.levelXpRequirements[level - 1] : this.levelXpRequirements[29];
  },

  filterAndSortUsers(users: User[]): User[] {
    const filteredUsers = users.filter(user => user.name.toLowerCase() !== 'admin');
    return [...filteredUsers].sort((a, b) => {
      if (a.current_level !== b.current_level) {
        return b.current_level - a.current_level; // Higher level first
      }
      return b.total_xp - a.total_xp; // Higher XP first if same level
    });
  },

  getUserPosition(user: User, sortedUsers: User[]): number {
    let position = 1;
    
    for (const sortedUser of sortedUsers) {
      if (sortedUser.id === user.id) break;
      
      if (sortedUser.current_level > user.current_level || 
          (sortedUser.current_level === user.current_level && sortedUser.total_xp > user.total_xp)) {
        position++;
      }
    }
    return position;
  },

  calculateUserStats(user: User) {
    const level = user.current_level;
    const currentLevelXP = this.getXPForLevel(level);
    const nextLevelXP = level < 30 ? this.getXPForLevel(level + 1) : currentLevelXP;
    const xpProgress = level < 30 ? ((user.total_xp - currentLevelXP) / (nextLevelXP - currentLevelXP)) * 100 : 100;
    const xpLeftForNextLevel = level < 30 ? Math.round((nextLevelXP - user.total_xp) * 10) / 10 : 0;

    const numberOfRuns = user.runs?.length || 0;
    const longestRun = numberOfRuns > 0 ? Math.max(...(user.runs?.map(run => run.distance) || [0])) : 0;
    const averageKmPerRun = numberOfRuns > 0 ? (user.total_km / numberOfRuns) : 0;
    const weekendAverage = this.calculateWeekendAverage(user.runs || []);
    const last14DaysXP = this.calculateLast14DaysXP(user);
    const daysToNextLevel = last14DaysXP > 0 && level < 30 ? Math.ceil(xpLeftForNextLevel / last14DaysXP) : 0;

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
  },

  calculateLast14DaysXP(user: User): number {
    const today = new Date();
    const fourteenDaysAgo = new Date(today.getTime() - (13 * 24 * 60 * 60 * 1000)); // 13 days ago + today = 14 days
    
    const last14DaysRuns = (user.runs || []).filter(run => {
      const runDate = new Date(run.date);
      return runDate >= fourteenDaysAgo && runDate <= today;
    });

    const totalXP = last14DaysRuns.reduce((sum, run) => sum + (run.xp_gained || 0), 0);
    return Math.floor(totalXP / 14);
  },

  getInitials(name: string): string {
    return name.split(' ').map(n => n[0]).join('').toUpperCase();
  },

  formatXPForDisplay(xp: number): string {
    // Round to 1 decimal place and format with comma
    const rounded = Math.round(xp * 10) / 10;
    
    if (rounded >= 1000000) {
      return `${(rounded / 1000000).toFixed(1)}M`;
    } else if (rounded >= 1000) {
      return `${(rounded / 1000).toFixed(1)}k`;
    }
    return rounded.toFixed(1);
  }
}
