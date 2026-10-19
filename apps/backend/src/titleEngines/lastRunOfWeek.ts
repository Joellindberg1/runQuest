import type { TitleEngine, RunData, UserStats } from './types';
import { dayOfWeek, encodeTitleMetric, noValueFor } from '@runquest/shared';

// Value = latest start_time among Sunday runs, encoded as wall-clock seconds (shared/titleMetrics).
// The user who most recently ran on a Sunday holds the title.
export const lastRunOfWeekEngine: TitleEngine = {
  metricKey: 'lastRunOfWeek',
  calculate(runs: RunData[], _: UserStats): number {
    const sundayRuns = runs.filter(r => dayOfWeek(r.date) === 0);
    if (sundayRuns.length === 0) return noValueFor('lastRunOfWeek');

    let latest = noValueFor('lastRunOfWeek');
    for (const run of sundayRuns) {
      const wallClockMs = run.start_time
        ? new Date(run.start_time).getTime()
        : new Date(run.date + 'T23:00:00Z').getTime();
      const ts = encodeTitleMetric('lastRunOfWeek', wallClockMs);
      if (ts > latest) latest = ts;
    }
    return latest;
  }
};
