
import { streakCalculationService } from '../streakCalculationService'

export const titleValidationService = {
  calculateAchievementValue(titleName: string, runs: any[], cutoffDate: Date): number {
    const earnedAtDate = new Date(cutoffDate)
    const runsUpToEarnedAt = runs.filter(run => new Date(run.created_at) <= earnedAtDate)
    
    if (titleName.includes('Eliud Kipchoge')) {
      // Longest single run
      return runsUpToEarnedAt.length > 0 ? Math.max(...runsUpToEarnedAt.map(run => run.distance)) : 0
    } else if (titleName.includes('GOGGINGS')) {
      // Longest streak - calculate based on runs up to earned_at
      return streakCalculationService.calculateLongestStreakUpToDate(runsUpToEarnedAt, earnedAtDate)
    } else if (titleName.includes('Ultra Man')) {
      // Total kilometers
      return runsUpToEarnedAt.reduce((sum, run) => sum + run.distance, 0)
    } else if (titleName.includes('Weekend Destroyer')) {
      // Weekend average
      return streakCalculationService.calculateWeekendAverageUpToDate(runsUpToEarnedAt, earnedAtDate)
    }
    
    return 0
  },

  getUserCurrentValues(runs: any[], totalKm: number, longestStreak: number) {
    const longestRun = runs.length > 0 ? Math.max(...runs.map(run => run.distance)) : 0
    const weekendAvg = streakCalculationService.calculateWeekendAverage(runs)

    return {
      longestRun,
      longestStreak,
      totalKm,
      weekendAvg
    }
  },

  checkUserMeetsRequirement(titleName: string, userValue: number, minRequirement: number): boolean {
    return userValue >= minRequirement
  }
}
