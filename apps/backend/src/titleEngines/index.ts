import { longestRunEngine } from './longestRun';
import { totalKmEngine } from './totalKm';
import { longestStreakEngine } from './longestStreak';
import { weekendAvgEngine } from './weekendAvg';
import type { TitleEngine } from './types';

// Registry: add one line here when adding a new title engine
const engines: TitleEngine[] = [
  longestRunEngine,
  totalKmEngine,
  longestStreakEngine,
  weekendAvgEngine,
];

export const titleEngineRegistry = new Map(
  engines.map(e => [e.metricKey, e])
);
