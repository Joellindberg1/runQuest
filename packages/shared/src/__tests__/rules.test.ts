import { describe, expect, it } from 'vitest';
import {
  MANUAL_RUN_MIN_DISTANCE_KM,
  STRAVA_DISTANCE_MUST_EXCEED_KM,
  STRAVA_LEGACY_RUN_TYPE,
  STRAVA_LOOKBACK_BUFFER_DAYS,
  STRAVA_POLL_INTERVAL_MINUTES,
  STRAVA_RUN_SPORT_TYPES,
  STRAVA_TREADMILL_FLAG,
  WEBHOOK_RETENTION_DONE_DAYS,
  WEBHOOK_RETENTION_FAILED_DAYS,
  getDataPolicySection,
  stravaPollCron,
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

  it('the sync runs every 30 minutes', () => {
    expect(STRAVA_POLL_INTERVAL_MINUTES).toBe(30);
  });

  it('the cron expression follows the polling interval', () => {
    expect(stravaPollCron()).toBe('*/30 * * * *');
    expect(stravaPollCron(15)).toBe('*/15 * * * *');
  });
});

describe('the privacy text agrees with the Strava constants', () => {
  it('names the same running types', () => {
    expect(strava()).toContain(`(${listOf(STRAVA_RUN_SPORT_TYPES)})`);
  });

  // The text promises a backup check "at least every 12 hours": true for 30 minutes and for 12 hours, false for anything slower.
  it('the backup check is at least every 12 hours, as the privacy text says', () => {
    expect(strava()).toContain('at least every 12 hours');
    expect(STRAVA_POLL_INTERVAL_MINUTES).toBeLessThanOrEqual(12 * 60);
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
