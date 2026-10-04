// De 21 måttnycklarna (`metric_key`) som title-motorerna i backend producerar — apps/backend/src/titleEngines/index.ts.
// Fixtur för kategorimappningens tester: den får INTE härledas ur mappningen den testar. Driftvakten i
// titleCategories.test.ts läser motorfilerna och faller om den här listan halkar efter registret.
export const TITLE_ENGINE_METRIC_KEYS = [
  'longestRun',
  'totalKm',
  'longestStreak',
  'weekendAvg',
  'nightRunCount',
  'earlyRunCount',
  'lunchRunCount',
  'maxRunsOneWeek',
  'longestRunAfterBreak14',
  'longestRunAfterBreak30',
  'lowestPaceStdDev',
  'maxWeekdayStreak',
  'bestDoubleDayKm',
  'fastestMarathon',
  'fastestHalfMarathon',
  'lastRunOfWeek',
  'maxKmRolling30',
  'totalElevationGain',
  'bestSingleRunElevation',
  'fastest5km',
  'avgPaceStdDev',
] as const;
