
export const streakCalculationService = {
  /**
   * Beräknar streak för en ny run baserat på befintliga runs
   * Använder samma logik som backend StreakService
   */
  calculateStreak(existingRuns: any[], newRunDate: string): { streakDay: number, streakBonus: number } {
    const runs = [...existingRuns]
    if (newRunDate) {
      runs.push({ date: newRunDate })
    }

    // Skapa set av unika dagar (YYYY-MM-DD format)
    const uniqueDays = new Set(runs.map((run: any) => run.date))
    const sortedDays = Array.from(uniqueDays).sort() as string[]

    if (sortedDays.length === 0) {
      return { streakDay: 1, streakBonus: 0 }
    }

    // Beräkna streak day för den nya runan
    const streakDay = this.calculateStreakDayForSpecificRun(sortedDays, newRunDate)
    
    let streakBonus = 0
    if (streakDay === 10 || (streakDay >= 30 && (streakDay - 30) % 30 === 0 && streakDay <= 330)) {
      streakBonus = 50
    }
    
    return { streakDay, streakBonus }
  },

  /**
   * Beräknar vilken streak-dag en specifik run representerar
   * Matchar backend-logiken exakt
   */
  calculateStreakDayForSpecificRun(sortedDays: string[], targetDate: string): number {
    const targetIndex = sortedDays.indexOf(targetDate)
    if (targetIndex === -1) return 1

    let streakDay = 1
    
    // Räkna bakåt från target datum
    for (let i = targetIndex - 1; i >= 0; i--) {
      const currDate = new Date(sortedDays[i])
      const nextDate = new Date(sortedDays[i + 1])
      
      const daysDiff = Math.floor(
        (nextDate.getTime() - currDate.getTime()) / (1000 * 60 * 60 * 24)
      )

      if (daysDiff === 1) {
        streakDay++
      } else {
        break
      }
    }

    return streakDay
  },

  /**
   * Beräknar nuvarande aktiv streak (från senaste dagen bakåt)
   * Matchar backend-logiken exakt
   */
  calculateCurrentStreak(runs: any[]): number {
    if (runs.length === 0) return 0

    // Skapa set av unika dagar
    const uniqueDays = new Set(runs.map((run: any) => {
      const date = new Date(run.date)
      date.setHours(0, 0, 0, 0)
      return date.toISOString().split('T')[0]
    }))

    const sortedDays = Array.from(uniqueDays).sort() as string[]

    if (sortedDays.length === 0) return 0

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayStr = today.toISOString().split('T')[0]

    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayStr = yesterday.toISOString().split('T')[0]

    // Kontrollera om senaste run är idag eller igår
    const latestDay = sortedDays[sortedDays.length - 1]
    if (latestDay !== todayStr && latestDay !== yesterdayStr) {
      return 0 // Streak är bruten
    }

    // Räkna bakåt från senaste dagen
    let streak = 1
    for (let i = sortedDays.length - 2; i >= 0; i--) {
      const currDate = new Date(sortedDays[i])
      const nextDate = new Date(sortedDays[i + 1])
      
      const daysDiff = Math.floor(
        (nextDate.getTime() - currDate.getTime()) / (1000 * 60 * 60 * 24)
      )

      if (daysDiff === 1) {
        streak++
      } else {
        break
      }
    }

    return streak
  },

  /**
   * Beräknar längsta streak i en lista av runs
   * Matchar backend-logiken exakt
   */
  calculateLongestStreak(runs: any[]): number {
    if (runs.length === 0) return 0

    // Skapa set av unika dagar
    const uniqueDays = new Set(runs.map((run: any) => {
      const date = new Date(run.date)
      date.setHours(0, 0, 0, 0)
      return date.toISOString().split('T')[0]
    }))

    const sortedDays = Array.from(uniqueDays).sort() as string[]

    if (sortedDays.length === 0) return 0

    let longestStreak = 1
    let currentStreak = 1

    for (let i = 1; i < sortedDays.length; i++) {
      const prevDate = new Date(sortedDays[i - 1])
      const currDate = new Date(sortedDays[i])
      
      const daysDiff = Math.floor(
        (currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24)
      )

      if (daysDiff === 1) {
        currentStreak++
      } else {
        longestStreak = Math.max(longestStreak, currentStreak)
        currentStreak = 1
      }
    }

    return Math.max(longestStreak, currentStreak)
  },

  calculateLongestStreakUpToDate(runs: any[], cutoffDate: Date): number {
    if (runs.length === 0) return 0
    
    // Only consider runs up to the cutoff date
    const filteredRuns = runs.filter(run => new Date(run.date) <= cutoffDate)
    
    if (filteredRuns.length === 0) return 0
    
    const sortedRuns = [...filteredRuns].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    let longestStreak = 1
    let currentStreak = 1
    
    for (let i = 1; i < sortedRuns.length; i++) {
      const prevDate = new Date(sortedRuns[i - 1].date)
      const currDate = new Date(sortedRuns[i].date)
      const daysDiff = Math.floor((currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24))
      
      if (daysDiff === 1) {
        currentStreak++
      } else {
        longestStreak = Math.max(longestStreak, currentStreak)
        currentStreak = 1
      }
    }
    
    return Math.max(longestStreak, currentStreak)
  },

  calculateWeekendAverage(runs: any[]) {
    const weekendTotals = new Map<string, number>()
    
    runs.forEach(run => {
      const date = new Date(run.date)
      const day = date.getDay() // 0 = Sunday, 6 = Saturday
      
      if (day === 0 || day === 6) { // Weekend days
        // Get the Monday of the week containing this weekend day
        const monday = new Date(date)
        monday.setDate(date.getDate() - (date.getDay() === 0 ? 6 : date.getDay() - 1))
        const weekKey = monday.toISOString().split('T')[0]
        
        weekendTotals.set(weekKey, (weekendTotals.get(weekKey) || 0) + run.distance)
      }
    })

    const weekends = Array.from(weekendTotals.values())
    return weekends.length > 0 ? weekends.reduce((sum, total) => sum + total, 0) / weekends.length : 0
  },

  calculateWeekendAverageUpToDate(runs: any[], cutoffDate: Date): number {
    // Only consider runs up to the cutoff date
    const filteredRuns = runs.filter(run => new Date(run.date) <= cutoffDate)
    
    const weekendTotals = new Map<string, number>()
    
    filteredRuns.forEach(run => {
      const date = new Date(run.date)
      const day = date.getDay() // 0 = Sunday, 6 = Saturday
      
      if (day === 0 || day === 6) { // Weekend days
        // Get the Monday of the week containing this weekend day
        const monday = new Date(date)
        monday.setDate(date.getDate() - (date.getDay() === 0 ? 6 : date.getDay() - 1))
        const weekKey = monday.toISOString().split('T')[0]
        
        weekendTotals.set(weekKey, (weekendTotals.get(weekKey) || 0) + run.distance)
      }
    })

    const weekends = Array.from(weekendTotals.values())
    return weekends.length > 0 ? weekends.reduce((sum, total) => sum + total, 0) / weekends.length : 0
  }
}
