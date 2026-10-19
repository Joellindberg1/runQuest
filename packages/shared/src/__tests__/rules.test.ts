import { describe, expect, it } from 'vitest';
import {
  LEGENDARY_AUTO_START_DAYS,
  MANUAL_RUN_MIN_DISTANCE_KM,
  MAX_DISPLAYED_TITLES,
  MIN_RUN_DATE,
  MIN_RUN_DATE_LABEL,
  MULTIPLIER_MAX,
  MULTIPLIER_MIN,
  PASSWORD_MIN_LENGTH,
  PROFILE_PICTURE_EXTENSIONS,
  PROFILE_PICTURE_MAX_BYTES,
  PROFILE_PICTURE_MIME_TYPES,
  STORM_EVENT_GUST_MS,
  STORM_GUST_MS,
  UNANSWERED_CHALLENGE_LAPSE_DAYS,
  isValidMultiplier,
  multiplierProblem,
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

describe('limits and thresholds with one home', () => {
  it('no run is logged from before 2025-06-01, and the long form used in texts names the same day', () => {
    expect(MIN_RUN_DATE).toBe('2025-06-01');
    const longForm = new Date(`${MIN_RUN_DATE}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' });
    expect(MIN_RUN_DATE_LABEL).toBe(longForm);
  });

  it('a user shows at most three titles on the leaderboard card', () => {
    expect(MAX_DISPLAYED_TITLES).toBe(3);
  });

  it('a password needs at least six characters', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(6);
  });

  it('a profile picture is at most 5 MB and JPEG, PNG, WebP or GIF, each with its file extension', () => {
    expect(PROFILE_PICTURE_MAX_BYTES).toBe(5 * 1024 * 1024);
    expect(PROFILE_PICTURE_EXTENSIONS).toEqual({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' });
    expect([...PROFILE_PICTURE_MIME_TYPES]).toEqual(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
  });

  it('the title counts a run as a storm from 12 m/s gusts and the Storm Chaser event counts a gusty hour from 15 m/s', () => {
    expect(STORM_GUST_MS).toBe(12);
    expect(STORM_EVENT_GUST_MS).toBe(15);
  });

  it('a legendary challenge starts on its own after four days and an unanswered minor or major lapses after three', () => {
    expect(LEGENDARY_AUTO_START_DAYS).toBe(4);
    expect(UNANSWERED_CHALLENGE_LAPSE_DAYS).toBe(3);
  });
});

describe('multiplier validation', () => {
  it('the range is 1 to 9.99', () => {
    expect([MULTIPLIER_MIN, MULTIPLIER_MAX]).toEqual([1, 9.99]);
  });

  it('accepts the ends of the range and values with at most two decimals', () => {
    for (const ok of [1, 1.1, 1.25, 2, 9.99, 5.05, 1.01]) {
      expect(multiplierProblem(ok), String(ok)).toBeNull();
      expect(isValidMultiplier(ok), String(ok)).toBe(true);
    }
  });

  it('names a value outside 1 to 9.99, or one that is not a finite number, as a range problem', () => {
    for (const bad of [0.99, 0, -1, 10, 9.991, Number.NaN, Number.POSITIVE_INFINITY, '2', null, undefined]) {
      expect(multiplierProblem(bad), String(bad)).toBe('range');
      expect(isValidMultiplier(bad), String(bad)).toBe(false);
    }
  });

  it('names a value in range with more than two decimals as a decimals problem', () => {
    for (const bad of [1.005, 2.345, 1.001, 9.989]) {
      expect(multiplierProblem(bad), String(bad)).toBe('decimals');
      expect(isValidMultiplier(bad), String(bad)).toBe(false);
    }
  });
});
