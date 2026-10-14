import { describe, it, expect } from 'vitest';
import {
  STRAVA_READ_LIMIT_15_MIN,
  STRAVA_READ_LIMIT_DAILY,
  WEBHOOK_SOFT_LIMIT_15_MIN,
  WEBHOOK_SOFT_LIMIT_DAILY,
} from '../stravaLimits.js';

describe('Strava limits', () => {
  it('limit constants are 300 and 3000 for reads and the soft limits are 210 and 2100', () => {
    expect([STRAVA_READ_LIMIT_15_MIN, STRAVA_READ_LIMIT_DAILY]).toEqual([300, 3000]);
    expect([WEBHOOK_SOFT_LIMIT_15_MIN, WEBHOOK_SOFT_LIMIT_DAILY]).toEqual([210, 2100]);
  });
});
