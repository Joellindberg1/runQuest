
export const streakCalculationService = {
  calculateStreak(existingRuns: any[], newRunDate: string): { streakDay: number, streakBonus: number } {
    const runs = [...existingRuns]
    const newDate = new Date(newRunDate)
    
    runs.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    
    let streakDay = 1
    let lastDate = newDate
    
    for (let i = runs.length - 1; i >= 0; i--) {
      const runDate = new Date(runs[i].date)
      const daysDiff = Math.floor((lastDate.getTime() - runDate.getTime()) / (1000 * 60 * 60 * 24))
      
      if (daysDiff === 1) {
        streakDay++
        lastDate = runDate
      } else if (daysDiff > 1) {
        break
      }
    }
    
    let streakBonus = 0
    if (streakDay === 10 || (streakDay >= 30 && (streakDay - 30) % 30 === 0 && streakDay <= 330)) {
      streakBonus = 50
    }
    
    return { streakDay, streakBonus }
  },

  calculateCurrentStreak(runs: any[]): number {
    if (runs.length === 0) return 0;

    // Normalisera och extrahera unika datumsträngar (YYYY-MM-DD)
    const uniqueDates = new Set(
      runs.map(run => {
        const date = new Date(run.date);
        date.setHours(0, 0, 0, 0);
        return date.toISOString().split('T')[0];
      })
    );

    // Konvertera tillbaka till Date-objekt och sortera fallande
    const sortedDates = Array.from(uniqueDates)
      .map(dateStr => new Date(dateStr))
      .sort((a, b) => b.getTime() - a.getTime());

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    const firstRunDate = sortedDates[0];

    // Streak måste börja idag eller igår
    if (firstRunDate.getTime() < yesterday.getTime()) {
      return 0;
    }

    let currentStreak = 1;
    for (let i = 1; i < sortedDates.length; i++) {
      const daysDiff = Math.floor(
        (sortedDates[i - 1].getTime() - sortedDates[i].getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysDiff === 1) {
        currentStreak++;
      } else {
        break;
      }
    }

    return currentStreak;
  },

  calculateLongestStreak(runs: any[]): number {
    if (runs.length === 0) return 0;

    // Skapa en Set med unika datum (YYYY-MM-DD)
    const uniqueDates = new Set(
      runs.map(run => {
        const date = new Date(run.date);
        date.setHours(0, 0, 0, 0); // Normalisera till midnatt
        return date.toISOString().split('T')[0]; // Endast datumsträng
      })
    );

    // Konvertera tillbaka till array av Date-objekt och sortera
    const sortedDates = Array.from(uniqueDates)
      .map(dateStr => new Date(dateStr))
      .sort((a, b) => a.getTime() - b.getTime());

    let longestStreak = 1;
    let currentStreak = 1;

    for (let i = 1; i < sortedDates.length; i++) {
      const daysDiff = Math.floor(
        (sortedDates[i].getTime() - sortedDates[i - 1].getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysDiff === 1) {
        currentStreak++;
      } else {
        longestStreak = Math.max(longestStreak, currentStreak);
        currentStreak = 1;
      }
    }

    return Math.max(longestStreak, currentStreak);
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
