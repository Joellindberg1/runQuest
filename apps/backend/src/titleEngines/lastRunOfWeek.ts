import type { TitleEngine, RunData, UserStats } from './types';
import { dayOfWeek } from './_utils';

// Value = latest start_time (Unix seconds) among Sunday runs.
// The user who most recently ran on a Sunday holds the title.
export const lastRunOfWeekEngine: TitleEngine = {
  metricKey: 'lastRunOfWeek',
  calculate(runs: RunData[], _: UserStats): number {
    const sundayRuns = runs.filter(r => dayOfWeek(r.date) === 0);
    if (sundayRuns.length === 0) return 0;

    let latest = 0;
    for (const run of sundayRuns) {
      const ts = run.start_time
        ? new Date(run.start_time).getTime() / 1000
        : new Date(run.date + 'T23:00:00Z').getTime() / 1000;
      if (ts > latest) latest = ts;
    }
    return latest;
  }
};
