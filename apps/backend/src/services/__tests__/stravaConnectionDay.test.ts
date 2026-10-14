/**
 * The connection-day rule (owner decision 2026-10-14, privacy text): an activity that started before the day the user connected
 * Strava is never imported through a webhook. The day is the Stockholm calendar day of strava_tokens.connection_date, the same
 * conversion the polling window uses (stravaLookback); the activity's day is its local start date (the same day as runs.date).
 *
 * The rule is tested here once, as a pure function and as an input to decideAction. The handlers get it for free.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(() => {
    throw new Error('decideAction must not touch the database');
  }),
}));

import { stravaActivity } from '../../test-utils/fakeStrava.js';
import { connectionDay, stravaLookback } from '../../utils/stravaLookback.js';
import { decideAction, isBeforeConnectionDay, type DecideInput, type StravaResponse } from '../stravaWebhook/decideAction.js';

describe('isBeforeConnectionDay', () => {
  // Autumn 2026: Stockholm is UTC+2 until 03:00 on 25 October, then UTC+1.
  it('an activity on the connection day itself is not before it', () => {
    expect(isBeforeConnectionDay('2026-10-12', '2026-10-12T09:00:00Z')).toBe(false);
    expect(isBeforeConnectionDay('2026-10-12T00:00:00Z', '2026-10-12T21:59:59Z')).toBe(false);
  });

  it('an activity on the day before the connection day is before it', () => {
    expect(isBeforeConnectionDay('2026-10-11', '2026-10-12T09:00:00Z')).toBe(true);
    expect(isBeforeConnectionDay('2026-10-11T23:59:59Z', '2026-10-12T09:00:00Z')).toBe(true);
  });

  it('an activity after the connection day is not before it', () => {
    expect(isBeforeConnectionDay('2026-10-13', '2026-10-12T09:00:00Z')).toBe(false);
  });

  it('the connection day is the Stockholm calendar day, not the UTC day', () => {
    // 22:30 UTC on the 11th is 00:30 on the 12th in Stockholm (summer time): connected on the 12th.
    expect(isBeforeConnectionDay('2026-10-11', '2026-10-11T22:30:00Z')).toBe(true);
    expect(isBeforeConnectionDay('2026-10-12', '2026-10-11T22:30:00Z')).toBe(false);
    // 21:59:59 UTC is still 23:59:59 on the 11th.
    expect(isBeforeConnectionDay('2026-10-11', '2026-10-11T21:59:59Z')).toBe(false);
    expect(isBeforeConnectionDay('2026-10-10', '2026-10-11T21:59:59Z')).toBe(true);
  });

  it('holds around the autumn clock change (25 October 2026, 03:00 to 02:00)', () => {
    // 22:30 UTC on the 24th = 00:30 on the 25th (still summer time): connected on the 25th.
    expect(isBeforeConnectionDay('2026-10-24', '2026-10-24T22:30:00Z')).toBe(true);
    expect(isBeforeConnectionDay('2026-10-25', '2026-10-24T22:30:00Z')).toBe(false);
    // 22:30 UTC on the 25th = 23:30 on the 25th (winter time, UTC+1): still the 25th, not the 26th.
    expect(isBeforeConnectionDay('2026-10-25', '2026-10-25T22:30:00Z')).toBe(false);
    expect(isBeforeConnectionDay('2026-10-24', '2026-10-25T22:30:00Z')).toBe(true);
    // 23:00 UTC on the 25th = 00:00 on the 26th: the first instant of the 26th.
    expect(isBeforeConnectionDay('2026-10-25', '2026-10-25T23:00:00Z')).toBe(true);
    expect(isBeforeConnectionDay('2026-10-26', '2026-10-25T23:00:00Z')).toBe(false);
  });

  it('holds around the spring clock change (29 March 2026, 02:00 to 03:00)', () => {
    // 23:30 UTC on the 28th = 00:30 on the 29th (winter time): connected on the 29th.
    expect(isBeforeConnectionDay('2026-03-28', '2026-03-28T23:30:00Z')).toBe(true);
    expect(isBeforeConnectionDay('2026-03-29', '2026-03-28T23:30:00Z')).toBe(false);
    // 21:59 UTC on the 29th = 23:59 on the 29th (summer time, UTC+2); 22:00 UTC is midnight on the 30th.
    expect(isBeforeConnectionDay('2026-03-29', '2026-03-29T21:59:59Z')).toBe(false);
    expect(isBeforeConnectionDay('2026-03-29', '2026-03-29T22:00:00Z')).toBe(true);
  });

  it('no restriction without a usable connection date (old legacy connections)', () => {
    expect(isBeforeConnectionDay('2020-01-01', null)).toBe(false);
    expect(isBeforeConnectionDay('2020-01-01', undefined)).toBe(false);
    expect(isBeforeConnectionDay('2020-01-01', '')).toBe(false);
    expect(isBeforeConnectionDay('2020-01-01', 'not a date')).toBe(false);
  });

  it('no restriction for an activity date it cannot read', () => {
    expect(isBeforeConnectionDay('', '2026-10-12T09:00:00Z')).toBe(false);
    expect(isBeforeConnectionDay('garbage', '2026-10-12T09:00:00Z')).toBe(false);
  });

  it('uses the same connection day as the polling window', () => {
    for (const connectionDate of ['2026-10-11T22:30:00Z', '2026-10-25T22:30:00Z', '2026-03-28T23:30:00Z', '2026-07-01T12:00:00Z']) {
      const lookback = stravaLookback([], connectionDate, new Date('2026-12-01T00:00:00Z'));
      expect(lookback.method).toBe('connection-date');
      expect(connectionDay(connectionDate)).toBe(lookback.anchorDay);
    }
  });
});

const ok = (activity: ReturnType<typeof stravaActivity>): StravaResponse => ({ kind: 'http', status: 200, activity });

function decide(overrides: Partial<DecideInput> & { response: StravaResponse }) {
  return decideAction({ aspect_type: 'create', paused: false, existingRun: null, attempts: 0, tokenRefreshed: false, ...overrides });
}

describe('decideAction with a connection date', () => {
  const connected = '2026-10-12T09:00:00Z';

  it('inserts a run that started on the connection day', () => {
    const activity = stravaActivity({ start_date_local: '2026-10-12T06:30:00Z' });
    expect(decide({ response: ok(activity), connectionDate: connected })).toMatchObject({ action: 'insert', outcome: 'imported', recalculateFrom: '2026-10-12' });
  });

  it('finishes a run from the day before as noop, with no recalculation', () => {
    const activity = stravaActivity({ start_date_local: '2026-10-11T18:30:00Z' });
    expect(decide({ response: ok(activity), connectionDate: connected })).toMatchObject({
      action: 'none',
      outcome: 'noop',
      recalculateFrom: null,
      recalculateUnknown: false,
    });
  });

  it('applies to update events too', () => {
    const activity = stravaActivity({ start_date_local: '2026-10-11T18:30:00Z' });
    expect(decide({ aspect_type: 'update', response: ok(activity), connectionDate: connected })).toMatchObject({ action: 'none', outcome: 'noop' });
  });

  it('a retry that meets an old activity still finishes as noop', () => {
    const activity = stravaActivity({ start_date_local: '2026-10-11T18:30:00Z' });
    expect(decide({ response: ok(activity), connectionDate: connected, attempts: 2 })).toMatchObject({ action: 'none', outcome: 'noop', recalculateUnknown: false });
  });

  it('imports as before without a connection date', () => {
    const activity = stravaActivity({ start_date_local: '2019-01-01T06:30:00Z' });
    expect(decide({ response: ok(activity), connectionDate: null })).toMatchObject({ action: 'insert' });
    expect(decide({ response: ok(activity) })).toMatchObject({ action: 'insert' });
  });

  it('an old activity that is not a run is still not_a_run', () => {
    const ride = stravaActivity({ sport_type: 'Ride', start_date_local: '2026-10-11T18:30:00Z' });
    expect(decide({ response: ok(ride), connectionDate: connected })).toMatchObject({ action: 'none', outcome: 'not_a_run' });
  });

  it('a paused user is still ignored_paused whatever the day', () => {
    const activity = stravaActivity({ start_date_local: '2026-10-11T18:30:00Z' });
    expect(decide({ paused: true, response: ok(activity), connectionDate: connected })).toMatchObject({ action: 'none', outcome: 'ignored_paused' });
  });
});
