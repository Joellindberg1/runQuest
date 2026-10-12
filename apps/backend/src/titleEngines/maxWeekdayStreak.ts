import type { TitleEngine, RunData, UserStats } from './types';
import { addDays, dayOfWeek } from '@runquest/shared';

function nextWeekday(dateStr: string): string {
  // Friday (5) → +3 days to Monday; any other weekday → +1 day
  return addDays(dateStr, dayOfWeek(dateStr) === 5 ? 3 : 1);
}

export const maxWeekdayStreakEngine: TitleEngine = {
  metricKey: 'maxWeekdayStreak',
  calculate(runs: RunData[], _: UserStats): number {
    // Collect unique weekday (Mon–Fri) run dates, sorted
    const weekdayDates = [...new Set(
      runs
        .filter(r => { const d = dayOfWeek(r.date); return d >= 1 && d <= 5; })
        .map(r => r.date)
    )].sort();

    if (weekdayDates.length === 0) return 0;

    let maxStreak = 1;
    let currentStreak = 1;

    for (let i = 1; i < weekdayDates.length; i++) {
      if (weekdayDates[i] === nextWeekday(weekdayDates[i - 1])) {
        currentStreak++;
        if (currentStreak > maxStreak) maxStreak = currentStreak;
      } else {
        currentStreak = 1;
      }
    }

    return maxStreak;
  }
};
