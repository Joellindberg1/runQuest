import { longestRunEngine }            from './longestRun';
import { fastest5kmEngine }            from './fastest5km';
import { avgPaceStdDevEngine }         from './avgPaceStdDev';
import { totalKmEngine }               from './totalKm';
import { longestStreakEngine }          from './longestStreak';
import { weekendAvgEngine }            from './weekendAvg';
import { nightRunCountEngine }         from './nightRunCount';
import { earlyRunCountEngine }         from './earlyRunCount';
import { lunchRunCountEngine }         from './lunchRunCount';
import { maxRunsOneWeekEngine }        from './maxRunsOneWeek';
import { longestRunAfterBreak14Engine } from './longestRunAfterBreak14';
import { longestRunAfterBreak30Engine } from './longestRunAfterBreak30';
import { lowestPaceStdDevEngine }      from './lowestPaceStdDev';
import { maxWeekdayStreakEngine }       from './maxWeekdayStreak';
import { bestDoubleDayKmEngine }       from './bestDoubleDayKm';
import { fastestMarathonEngine }       from './fastestMarathon';
import { fastestHalfMarathonEngine }   from './fastestHalfMarathon';
import { lastRunOfWeekEngine }         from './lastRunOfWeek';
import { maxKmRolling30Engine }        from './maxKmRolling30';
import { totalElevationGainEngine }    from './totalElevationGain';
import { bestSingleRunElevationEngine } from './bestSingleRunElevation';
import type { TitleEngine }            from './types';

// Registry: add one line here when adding a new title engine
const engines: TitleEngine[] = [
  longestRunEngine,
  totalKmEngine,
  longestStreakEngine,
  weekendAvgEngine,
  nightRunCountEngine,
  earlyRunCountEngine,
  lunchRunCountEngine,
  maxRunsOneWeekEngine,
  longestRunAfterBreak14Engine,
  longestRunAfterBreak30Engine,
  lowestPaceStdDevEngine,
  maxWeekdayStreakEngine,
  bestDoubleDayKmEngine,
  fastestMarathonEngine,
  fastestHalfMarathonEngine,
  lastRunOfWeekEngine,
  maxKmRolling30Engine,
  totalElevationGainEngine,
  bestSingleRunElevationEngine,
  fastest5kmEngine,
  avgPaceStdDevEngine,
];

export const titleEngineRegistry = new Map(
  engines.map(e => [e.metricKey, e])
);
