import { describe, expect, it } from 'vitest';
import { paceSecPerKm, summariseRunTime } from '../pace.js';
import * as shared from '../index.js';

describe('paceSecPerKm', () => {
  it('rounds time over distance to whole seconds per kilometre', () => {
    expect(paceSecPerKm(3130, 10)).toBe(313);
    expect(paceSecPerKm(1800, 5)).toBe(360);
    expect(paceSecPerKm(1799, 5)).toBe(360);
  });

  it('returns null for missing or non-positive input', () => {
    for (const time of [null, undefined, 0, -1, -3130]) {
      expect(paceSecPerKm(time, 10)).toBeNull();
    }
    for (const distance of [null, undefined, 0, -1, -5]) {
      expect(paceSecPerKm(1800, distance)).toBeNull();
    }
  });

  it('never returns NaN or Infinity', () => {
    const bad = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    const invalid = [
      ...bad.map((time) => paceSecPerKm(time, 10)),
      ...bad.map((distance) => paceSecPerKm(1800, distance)),
      paceSecPerKm(0, 0),
      paceSecPerKm(Number.NaN, Number.NaN),
    ];
    expect(invalid.every((outcome) => outcome === null)).toBe(true);

    // Giltiga men extrema tal får inte heller bli Infinity (stor tid delat med mycket liten distans).
    const extreme = paceSecPerKm(Number.MAX_VALUE, Number.MIN_VALUE);
    expect(extreme === null || Number.isFinite(extreme)).toBe(true);
  });
});

describe('summariseRunTime', () => {
  it('excludes runs without time from the distance denominator', () => {
    const summary = summariseRunTime([
      { moving_time: 1800, distance_km: 5 },
      { moving_time: null, distance_km: 100 },
      { moving_time: 0, distance_km: 50 },
    ]);
    expect(summary.total_seconds).toBe(1800);
    expect(summary.distance_km).toBe(5);
    expect(summary.pace_sec_per_km).toBe(360);
  });

  it('counts runs_with_time of runs_total', () => {
    const summary = summariseRunTime([
      { moving_time: 1800, distance_km: 5 },
      { moving_time: 3130, distance_km: 10 },
      { moving_time: null, distance_km: 8 },
      { moving_time: 1200, distance_km: 0 },
    ]);
    expect(summary.runs_with_time).toBe(2);
    expect(summary.runs_total).toBe(4);
  });

  it('pace uses the summed time and distance, not the mean of rounded paces', () => {
    // 100 s / 0,3 km = 333,33 -> 333 och 1000 s / 4 km = 250: snittet av de avrundade tempona är 291,5 (292),
    // medan summorna ger 1100 / 4,3 = 255,81 -> 256.
    const runs = [
      { moving_time: 100, distance_km: 0.3 },
      { moving_time: 1000, distance_km: 4 },
    ];
    const meanOfRounded = Math.round(((paceSecPerKm(100, 0.3) as number) + (paceSecPerKm(1000, 4) as number)) / 2);
    const summary = summariseRunTime(runs);
    expect(meanOfRounded).toBe(292);
    expect(summary.pace_sec_per_km).toBe(256);
    expect(summary.pace_sec_per_km).not.toBe(meanOfRounded);
    expect(summary.total_seconds).toBe(1100);
    expect(summary.distance_km).toBeCloseTo(4.3, 10);
  });

  it('returns no pace when no run has a time', () => {
    const treadmillAndManual = [
      { moving_time: null, distance_km: 5 },
      { moving_time: null, distance_km: 3.2 },
    ];
    expect(summariseRunTime(treadmillAndManual)).toEqual({
      total_seconds: 0,
      distance_km: 0,
      pace_sec_per_km: null,
      runs_with_time: 0,
      runs_total: 2,
    });
    expect(summariseRunTime([])).toEqual({
      total_seconds: 0,
      distance_km: 0,
      pace_sec_per_km: null,
      runs_with_time: 0,
      runs_total: 0,
    });
  });

  it('ignores runs whose time or distance is not a finite positive number', () => {
    const summary = summariseRunTime([
      { moving_time: Number.NaN, distance_km: 5 },
      { moving_time: Number.POSITIVE_INFINITY, distance_km: 5 },
      { moving_time: 600, distance_km: Number.NaN },
      { moving_time: -600, distance_km: 2 },
      { moving_time: 600, distance_km: 2 },
    ]);
    expect(summary.runs_with_time).toBe(1);
    expect(summary.runs_total).toBe(5);
    expect(summary.pace_sec_per_km).toBe(300);
  });
});

describe('shared package entry', () => {
  it('exports the pace functions from the package index', () => {
    expect(shared.paceSecPerKm).toBe(paceSecPerKm);
    expect(shared.summariseRunTime).toBe(summariseRunTime);
  });
});
