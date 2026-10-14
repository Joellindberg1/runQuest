import { describe, it, expect } from 'vitest';
import { isTreadmillActivity } from '../stravaActivity.js';

describe('isTreadmillActivity', () => {
  it('is true only when the trainer flag is true', () => {
    expect(isTreadmillActivity({ trainer: true })).toBe(true);
    expect(isTreadmillActivity({ trainer: false })).toBe(false);
    expect(isTreadmillActivity({ trainer: 'true' })).toBe(false);
    expect(isTreadmillActivity({})).toBe(false);
    expect(isTreadmillActivity(null)).toBe(false);
  });
});
