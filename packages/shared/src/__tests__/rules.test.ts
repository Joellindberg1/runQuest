import { describe, expect, it } from 'vitest';
import {
  MANUAL_RUN_MIN_DISTANCE_KM,
  STRAVA_DISTANCE_MUST_EXCEED_KM,
  STRAVA_LEGACY_RUN_TYPE,
  STRAVA_LOOKBACK_BUFFER_DAYS,
  STRAVA_POLL_INTERVAL_HOURS,
  STRAVA_RUN_SPORT_TYPES,
  STRAVA_TREADMILL_FLAG,
  WEBHOOK_RETENTION_DONE_DAYS,
  WEBHOOK_RETENTION_FAILED_DAYS,
  getDataPolicySection,
  stravaPollCron,
  stravaPollIntervalLabel,
} from '../index.js';

// Playbook (frontend) and the privacy text state these facts; the backend imports the same constants. Changing a value here is a
// product decision: the tests below name every place that has to follow.

const strava = (): string => getDataPolicySection('strava')!.paragraphs.join('\n');
const listOf = (items: readonly string[]): string => `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

describe('Strava import rules', () => {
  it('the running types are Run, TrailRun and VirtualRun', () => {
    expect([...STRAVA_RUN_SPORT_TYPES]).toEqual(['Run', 'TrailRun', 'VirtualRun']);
  });

  it('an activity without sport_type counts as a run only when its type is Run', () => {
    expect(STRAVA_LEGACY_RUN_TYPE).toBe('Run');
    expect(STRAVA_RUN_SPORT_TYPES).toContain(STRAVA_LEGACY_RUN_TYPE);
  });

  it('a Strava run must be longer than zero kilometres and has no other distance limit', () => {
    expect(STRAVA_DISTANCE_MUST_EXCEED_KM).toBe(0);
  });

  it('a manual run needs at least 1.0 km', () => {
    expect(MANUAL_RUN_MIN_DISTANCE_KM).toBe(1);
  });

  it('a treadmill run is recognised by the trainer flag', () => {
    expect(STRAVA_TREADMILL_FLAG).toBe('trainer');
  });

  it('each sync looks back seven days before the most recent imported run', () => {
    expect(STRAVA_LOOKBACK_BUFFER_DAYS).toBe(7);
  });

  it('strava poll interval is one shared constant and divides 24 hours', () => {
    expect(STRAVA_POLL_INTERVAL_HOURS).toBe(12);
    expect(Number.isInteger(STRAVA_POLL_INTERVAL_HOURS)).toBe(true);
    expect(24 % STRAVA_POLL_INTERVAL_HOURS).toBe(0);
    expect(stravaPollIntervalLabel()).toBe('12 hours');
  });

  it('the cron expression fires at minute 0 of every polling interval', () => {
    expect(stravaPollCron()).toBe('0 */12 * * *');
    expect(stravaPollCron(6)).toBe('0 */6 * * *');
    expect(stravaPollCron(24)).toBe('0 0 * * *');
  });

  it('an interval that does not divide 24 hours evenly is rejected, because the cron slots would drift between days', () => {
    for (const hours of [0, -12, 5, 7, 13, 25, 1.5, NaN]) {
      expect(() => stravaPollCron(hours), `stravaPollCron(${hours})`).toThrow(RangeError);
      expect(() => stravaPollIntervalLabel(hours), `stravaPollIntervalLabel(${hours})`).toThrow(RangeError);
    }
  });

  it('an interval shorter than three hours is rejected, because the cron and the slot computation differ on daylight saving nights', () => {
    for (const hours of [1, 2]) {
      expect(() => stravaPollCron(hours), `stravaPollCron(${hours})`).toThrow(RangeError);
      expect(() => stravaPollIntervalLabel(hours), `stravaPollIntervalLabel(${hours})`).toThrow(RangeError);
    }
  });

  it('every accepted interval has a label with its hours', () => {
    expect([3, 4, 6, 8, 12, 24].map((hours) => stravaPollIntervalLabel(hours))).toEqual(['3 hours', '4 hours', '6 hours', '8 hours', '12 hours', '24 hours']);
  });
});

describe('the privacy text agrees with the Strava constants', () => {
  it('names the same running types', () => {
    expect(strava()).toContain(`(${listOf(STRAVA_RUN_SPORT_TYPES)})`);
  });

  it('the strava section of the privacy text states the same poll interval as the shared constant', () => {
    expect(strava()).toContain(`at least every ${stravaPollIntervalLabel()}`);
  });
});

describe('Strava webhook journal retention', () => {
  it('handled events are kept 30 days and failed events 90 days, and the privacy text says so', () => {
    expect(WEBHOOK_RETENTION_DONE_DAYS).toBe(30);
    expect(WEBHOOK_RETENTION_FAILED_DAYS).toBe(90);
    expect(WEBHOOK_RETENTION_FAILED_DAYS).toBeGreaterThan(WEBHOOK_RETENTION_DONE_DAYS);
    const retention = getDataPolicySection('retention')!.paragraphs.join('\n');
    expect(retention).toContain(`${WEBHOOK_RETENTION_DONE_DAYS} days`);
    expect(retention).toContain(`${WEBHOOK_RETENTION_FAILED_DAYS} days`);
  });
});
