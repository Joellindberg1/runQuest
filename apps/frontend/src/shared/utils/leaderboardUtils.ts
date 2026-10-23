
import type { Run, User } from '@runquest/types';
import { STOCKHOLM_TZ, addDays, compareXpStandings, rankOf, weekendAverageKm, zoneDay, type XpStanding } from '@runquest/shared';
import { getLevelProgress } from '@/shared/services/levelService';
import { MAX_LEVEL } from '@/constants/appConstants';
export { getInitials } from '@/shared/utils/formatters';

const standingOf = (user: User): XpStanding => ({ id: user.id, name: user.name, xp: user.total_xp });

export const leaderboardUtils = {
  /** All-time-ordningen: samma som backendens användarlista och rank_passed (XP, namn, id). Ingen filtreras bort. */
  rankedUsers<T extends User>(users: readonly T[]): T[] {
    return [...users].sort((a, b) => compareXpStandings(standingOf(a), standingOf(b)));
  },

  /** Placeringen (1-baserad, aldrig delad) i `users`, eller null om användaren inte finns där. */
  rankOfUser(user: User, users: readonly User[]): number | null {
    return rankOf(user.id, users.map(standingOf));
  },

  calculateUserStats(user: User) {
    const progress = getLevelProgress(user.total_xp);
    const level = progress.currentLevel;
    const atMax = level >= MAX_LEVEL;
    const xpLeftForNextLevel = progress.xpToNext;

    const numberOfRuns = user.runs?.length || 0;
    const longestRun = numberOfRuns > 0 ? Math.max(...(user.runs?.map(run => run.distance) || [0])) : 0;
    const averageKmPerRun = numberOfRuns > 0 ? (user.total_km / numberOfRuns) : 0;
    const weekendAverage = this.calculateWeekendAverage(user.runs || []);
    const last14DaysXP = this.calculateLast14DaysXP(user);
    const daysToNextLevel = last14DaysXP > 0 && !atMax ? Math.ceil(xpLeftForNextLevel / last14DaysXP) : 0;

    // Get latest run
    const latestRun = user.runs && user.runs.length > 0 
      ? user.runs.reduce((latest, run) => 
          new Date(run.date) > new Date(latest.date) ? run : latest
        )
      : null;

    return {
      level,
      xpProgress: progress.progress,
      xpLeftForNextLevel,
      xpInLevel: atMax ? 0 : Math.round(user.total_xp - progress.currentLevelXP),
      xpLevelRange: atMax ? 0 : Math.round(progress.nextLevelXP - progress.currentLevelXP),
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

  /** XP-snittet per dag över 14 kalenderdagar: idag och de 13 dagarna före, dagen i gruppens tidszon. Rundornas datum är kalenderdagar. */
  calculateLast14DaysXP(user: User, now: Date = new Date(), timeZone: string = STOCKHOLM_TZ): number {
    const today = zoneDay(now, timeZone);
    const firstDay = addDays(today, -13); // 13 days ago + today = 14 days

    const last14DaysRuns = (user.runs || []).filter(run => {
      const runDay = run.date.slice(0, 10);
      return runDay >= firstDay && runDay <= today;
    });

    const totalXP = last14DaysRuns.reduce((sum, run) => sum + (run.xp_gained || 0), 0);
    return Math.floor(totalXP / 14);
  },

}
