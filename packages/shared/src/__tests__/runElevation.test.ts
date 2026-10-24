import { describe, it, expect } from 'vitest';
import { countedElevationGain } from '../runElevation.js';

describe('countedElevationGain', () => {
  it('counts the elevation of an outdoor run', () => {
    expect(countedElevationGain({ total_elevation_gain: 120, is_treadmill: false })).toBe(120);
  });

  it('counts 0 elevation for a treadmill run, whatever the stored elevation is', () => {
    expect(countedElevationGain({ total_elevation_gain: 120, is_treadmill: true })).toBe(0);
  });

  it('treats is_treadmill null or missing as outdoors', () => {
    expect(countedElevationGain({ total_elevation_gain: 80, is_treadmill: null })).toBe(80);
    expect(countedElevationGain({ total_elevation_gain: 80 })).toBe(80);
  });

  it('counts 0 when the elevation is unknown', () => {
    expect(countedElevationGain({ total_elevation_gain: null, is_treadmill: false })).toBe(0);
    expect(countedElevationGain({})).toBe(0);
  });
});
