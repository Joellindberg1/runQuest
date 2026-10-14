/**
 * The decision function of the Strava webhook worker (ADR 010 decisions 1, 7.1 and 7.6): Strava state + database state -> action.
 * Pure: no database, no network, no clock. The first describe holds the acceptance tests; the second is the ADR 7.1 table, one
 * case per row and per paused/aspect variant, so a changed row in the ADR shows up as a changed case here.
 *
 * Existing runs are built the way the database returns them: distance rounded to numeric(6,2), start_time as timestamptz.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(() => {
    throw new Error('decideAction must not touch the database');
  }),
}));

import { getSupabaseClient } from '../../config/database.js';
import { buildStravaRunRow, extractExtendedFields } from '../stravaImport.js';
import { stravaActivity } from '../../test-utils/fakeStrava.js';
import { WEBHOOK_BACKOFF_MINUTES, WEBHOOK_OUTCOMES } from '../stravaWebhook/constants.js';
import {
  decideAction,
  decideBeforeFetch,
  type DecideInput,
  type ExistingRun,
  type StravaResponse,
} from '../stravaWebhook/decideAction.js';

type Activity = ReturnType<typeof stravaActivity>;

const ok = (activity: Activity): StravaResponse => ({ kind: 'http', status: 200, activity });
const http = (status: number): StravaResponse => ({ kind: 'http', status });
const NETWORK_ERROR: StravaResponse = { kind: 'network_error' };

/**
 * The run row as the database returns it for this activity: every extended column the import writes (so a new column in
 * extractExtendedFields is part of the fixture without an edit here), distance rounded, start_time as timestamptz.
 */
function runFor(activity: Activity, overrides: Partial<ExistingRun> = {}): ExistingRun {
  const row = buildStravaRunRow('user-1', activity);
  return {
    ...extractExtendedFields(activity),
    source: 'strava',
    date: row.date,
    distance: Math.round(row.distance * 100) / 100,
    start_time: row.start_time ? new Date(row.start_time).toISOString().replace('Z', '+00:00') : null,
    ...overrides,
  };
}

function decide(overrides: Partial<DecideInput> & { response: StravaResponse }) {
  return decideAction({
    aspect_type: 'update',
    paused: false,
    existingRun: null,
    attempts: 0,
    tokenRefreshed: false,
    ...overrides,
  });
}

const run = stravaActivity();

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('decideAction', () => {
  it('decide inserts a visible running activity when no run exists', () => {
    for (const sport_type of ['Run', 'TrailRun', 'VirtualRun']) {
      const activity = stravaActivity({ sport_type });
      const decision = decide({ aspect_type: 'create', response: ok(activity) });
      expect(decision).toMatchObject({ action: 'insert', outcome: 'imported', recalculateFrom: '2026-10-12', clearWeather: false });
    }
  });

  it('decide updates a changed run and reports the earliest affected date', () => {
    // Distance changed: same day, recalculation from that day.
    const longer = stravaActivity({ distance: 8000 });
    const sameDay = decide({ response: ok(longer), existingRun: runFor(run) });
    expect(sameDay).toMatchObject({
      action: 'update',
      outcome: 'updated',
      recalculateFrom: '2026-10-12',
      changes: { distance: 8 },
    });
    // Only the columns that differ are written; the fake splits follow the distance, so the pace spread moves with it.
    expect(Object.keys((sameDay as { changes: object }).changes).sort()).toEqual(['distance', 'pace_std_dev']);

    // Date moved later: the old date is the earliest. Date moved earlier: the new date is.
    const movedLater = stravaActivity({ start_date_local: '2026-10-14T07:30:00Z' });
    expect(decide({ response: ok(movedLater), existingRun: runFor(run) })).toMatchObject({
      action: 'update',
      recalculateFrom: '2026-10-12',
      changes: { date: '2026-10-14' },
    });
    const movedEarlier = stravaActivity({ start_date_local: '2026-10-09T07:30:00Z' });
    expect(decide({ response: ok(movedEarlier), existingRun: runFor(run) })).toMatchObject({
      action: 'update',
      recalculateFrom: '2026-10-09',
      changes: { date: '2026-10-09' },
    });

    // An extended field alone (heart rate) is an update too.
    const withHeart = stravaActivity({ average_heartrate: 151 } as Partial<Activity>);
    expect(decide({ response: ok(withHeart), existingRun: runFor(run) })).toMatchObject({
      action: 'update',
      outcome: 'updated',
      changes: { avg_heartrate: 151 },
    });
  });

  it('decide returns noop when nothing differs including a title only change', () => {
    const existing = runFor(run);
    expect(decide({ response: ok(run), existingRun: existing })).toMatchObject({
      action: 'none',
      outcome: 'noop',
      recalculateFrom: null,
      clearWeather: false,
    });

    const renamed = stravaActivity({ name: 'A completely new title' });
    expect(decide({ response: ok(renamed), existingRun: existing })).toMatchObject({ action: 'none', outcome: 'noop' });
  });

  it('decide returns noop for a distance the database has rounded to two decimals', () => {
    const odd = stravaActivity({ distance: 5234.5 });
    expect(runFor(odd).distance).toBe(5.23);
    expect(decide({ response: ok(odd), existingRun: runFor(odd) })).toMatchObject({ action: 'none', outcome: 'noop' });
  });

  it('decide returns noop when the database returns the start time in another timestamp notation', () => {
    const existing = runFor(run, { start_time: '2026-10-12T07:30:00.000Z' });
    expect(decide({ response: ok(run), existingRun: existing })).toMatchObject({ action: 'none', outcome: 'noop' });
  });

  it('decide removes the run when the type changed to a non-running type', () => {
    const ride = stravaActivity({ sport_type: 'Ride' });
    expect(decide({ response: ok(ride), existingRun: runFor(run) })).toMatchObject({
      action: 'remove',
      outcome: 'removed_not_running',
      recalculateFrom: '2026-10-12',
    });
  });

  it('decide removes the run when the activity is private', () => {
    const hidden = stravaActivity({ private: true });
    expect(decide({ response: ok(hidden), existingRun: runFor(run) })).toMatchObject({
      action: 'remove',
      outcome: 'removed_private',
      recalculateFrom: '2026-10-12',
    });
  });

  it('decide removes the run when Strava answers 404 and a strava run exists', () => {
    expect(decide({ response: http(404), existingRun: runFor(run) })).toMatchObject({
      action: 'remove',
      outcome: 'deleted',
      recalculateFrom: '2026-10-12',
    });
  });

  it('decide reports not_a_run when Strava answers 404 and no run exists', () => {
    expect(decide({ response: http(404), existingRun: null })).toMatchObject({ action: 'none', outcome: 'not_a_run' });
    expect(decide({ aspect_type: 'delete', response: http(404), existingRun: null })).toMatchObject({
      action: 'none',
      outcome: 'not_a_run',
    });
  });

  it('decide reports not_a_run for a non-running or private activity when no run exists', () => {
    expect(decide({ response: ok(stravaActivity({ sport_type: 'Ride' })) })).toMatchObject({ action: 'none', outcome: 'not_a_run' });
    expect(decide({ response: ok(stravaActivity({ private: true })) })).toMatchObject({ action: 'none', outcome: 'not_a_run' });
  });

  it('decide ignores a delete event when Strava still shows a visible run', () => {
    // With and without a run in the database: nothing is deleted or written on the word of the event.
    for (const existingRun of [runFor(run), null]) {
      expect(decide({ aspect_type: 'delete', response: ok(run), existingRun })).toMatchObject({
        action: 'none',
        outcome: 'ignored_not_confirmed',
        recalculateFrom: null,
        clearWeather: false,
      });
    }
  });

  it('decide ignores activities with zero distance', () => {
    const empty = stravaActivity({ distance: 0 });
    expect(decide({ aspect_type: 'create', response: ok(empty) })).toMatchObject({ action: 'none', outcome: 'not_a_run' });
    // The database follows Strava: a strava run that now has zero distance is no longer importable and goes.
    expect(decide({ response: ok(empty), existingRun: runFor(run) })).toMatchObject({
      action: 'remove',
      outcome: 'removed_not_running',
    });
  });

  it('decide never removes a run whose source is not strava', () => {
    const manual = runFor(run, { source: 'manual' });
    const responses: StravaResponse[] = [http(404), ok(stravaActivity({ sport_type: 'Ride' })), ok(stravaActivity({ private: true })), ok(stravaActivity({ distance: 0 }))];
    for (const aspect_type of ['create', 'update', 'delete'] as const) {
      for (const paused of [false, true]) {
        for (const response of responses) {
          const decision = decide({ aspect_type, paused, response, existingRun: manual });
          const label = `${aspect_type} paused=${paused} ${JSON.stringify(response)}`;
          // The manual run is left alone and the event ends as "not a Strava run"; a paused create never looks at Strava.
          const outcome = paused && aspect_type === 'create' ? 'ignored_paused' : 'not_a_run';
          expect(decision, label).toMatchObject({ action: 'none', outcome, recalculateFrom: null, clearWeather: false });
        }
      }
    }
    // A visible run matching a non-strava row is not updated either.
    expect(decide({ response: ok(stravaActivity({ distance: 9000 })), existingRun: manual })).toMatchObject({ action: 'none', outcome: 'noop' });
  });

  it('decide asks for one token refresh on 401 and fails on the second 401', () => {
    expect(decide({ response: http(401), tokenRefreshed: false })).toMatchObject({
      action: 'refresh_token',
      outcome: null,
      countsAsFailedAttempt: false,
    });
    expect(decide({ response: http(401), tokenRefreshed: true, attempts: 0 })).toMatchObject({
      action: 'retry',
      outcome: null,
      reason: 'unauthorized',
      countsAsFailedAttempt: true,
    });
  });

  it('decide waits without a failed attempt on 429', () => {
    for (const attempts of [0, 3]) {
      expect(decide({ response: http(429), attempts })).toMatchObject({
        action: 'wait',
        outcome: null,
        countsAsFailedAttempt: false,
      });
    }
  });

  it('decide retries on 5xx and network errors', () => {
    for (const status of [500, 502, 503, 599]) {
      expect(decide({ response: http(status) })).toMatchObject({ action: 'retry', outcome: null, countsAsFailedAttempt: true });
    }
    expect(decide({ response: NETWORK_ERROR })).toMatchObject({ action: 'retry', reason: 'network_error', countsAsFailedAttempt: true });
  });

  it('decide spaces retries with the backoff list from the attempts so far', () => {
    const delays = [0, 1, 2, 3, 4, 10].map(
      (attempts) => (decide({ response: http(503), attempts }) as { retryAfterMinutes: number }).retryAfterMinutes,
    );
    expect(delays).toEqual([
      WEBHOOK_BACKOFF_MINUTES[0],
      WEBHOOK_BACKOFF_MINUTES[1],
      WEBHOOK_BACKOFF_MINUTES[2],
      WEBHOOK_BACKOFF_MINUTES[3],
      WEBHOOK_BACKOFF_MINUTES[3],
      WEBHOOK_BACKOFF_MINUTES[3],
    ]);
  });

  it('decide retries a status it does not know and a 200 without an activity', () => {
    expect(decide({ response: http(403) })).toMatchObject({ action: 'retry', reason: 'unexpected_status' });
    expect(decide({ response: http(200) })).toMatchObject({ action: 'retry', reason: 'invalid_response' });
    expect(decide({ response: ok({ ...run, distance: undefined } as unknown as Activity) })).toMatchObject({
      action: 'retry',
      reason: 'invalid_response',
    });
  });

  it('decide clears weather when start time or start coordinates change', () => {
    const existing = runFor(run);
    const cases: Array<[string, Partial<Activity>]> = [
      ['start time', { start_date_local: '2026-10-12T08:15:00Z' }],
      ['start latitude and longitude', { start_latlng: [60.1, 18.0686] }],
      ['start longitude only', { start_latlng: [59.3293, 19.5] }],
    ];
    for (const [label, change] of cases) {
      const decision = decide({ response: ok(stravaActivity(change)), existingRun: existing });
      expect(decision, label).toMatchObject({ action: 'update', clearWeather: true });
    }
    // Distance and heart rate do not move the weather.
    const distanceOnly = decide({ response: ok(stravaActivity({ distance: 7000 })), existingRun: existing });
    expect(distanceOnly).toMatchObject({ action: 'update', clearWeather: false });
    // A run that is removed or inserted has no weather row to clear.
    expect(decide({ response: http(404), existingRun: existing })).toMatchObject({ clearWeather: false });
    expect(decide({ aspect_type: 'create', response: ok(run) })).toMatchObject({ clearWeather: false });
  });

  it('decide ignores create for a paused user without any Strava call', () => {
    expect(decideBeforeFetch({ aspect_type: 'create', paused: true })).toEqual({ action: 'skip', outcome: 'ignored_paused' });
    // And if a caller asks decideAction anyway, nothing is written whatever Strava said.
    expect(decide({ aspect_type: 'create', paused: true, response: ok(run) })).toMatchObject({
      action: 'none',
      outcome: 'ignored_paused',
    });
  });

  it('decide asks for the Strava state before every case except create for a paused user', () => {
    for (const aspect_type of ['create', 'update', 'delete'] as const) {
      expect(decideBeforeFetch({ aspect_type, paused: false })).toEqual({ action: 'fetch' });
    }
    expect(decideBeforeFetch({ aspect_type: 'update', paused: true })).toEqual({ action: 'fetch' });
    expect(decideBeforeFetch({ aspect_type: 'delete', paused: true })).toEqual({ action: 'fetch' });
  });

  it('decide ignores an update with a visible run for a paused user', () => {
    const changed = stravaActivity({ distance: 9000 });
    for (const existingRun of [runFor(run), null]) {
      expect(decide({ paused: true, response: ok(changed), existingRun })).toMatchObject({
        action: 'none',
        outcome: 'ignored_paused',
        recalculateFrom: null,
        clearWeather: false,
      });
    }
  });

  it('decide removes the run on update to private, other sport or 404 for a paused user', () => {
    const existing = runFor(run);
    expect(decide({ paused: true, response: ok(stravaActivity({ private: true })), existingRun: existing })).toMatchObject({
      action: 'remove',
      outcome: 'removed_private',
    });
    expect(decide({ paused: true, response: ok(stravaActivity({ sport_type: 'Ride' })), existingRun: existing })).toMatchObject({
      action: 'remove',
      outcome: 'removed_not_running',
    });
    expect(decide({ paused: true, response: http(404), existingRun: existing })).toMatchObject({
      action: 'remove',
      outcome: 'deleted',
    });
  });

  it('decide processes delete as usual for a paused user', () => {
    const existing = runFor(run);
    expect(decide({ aspect_type: 'delete', paused: true, response: http(404), existingRun: existing })).toMatchObject({
      action: 'remove',
      outcome: 'deleted',
    });
    expect(decide({ aspect_type: 'delete', paused: true, response: ok(run), existingRun: existing })).toMatchObject({
      action: 'none',
      outcome: 'ignored_not_confirmed',
    });
    expect(decide({ aspect_type: 'delete', paused: true, response: ok(stravaActivity({ private: true })), existingRun: existing })).toMatchObject({
      action: 'remove',
      outcome: 'removed_private',
    });
  });

  it('decide recalculates on a retry even when the run already matches Strava', () => {
    // An earlier attempt may have written the run and died before the recalculation (ADR 010 decision 6).
    const existing = runFor(run);
    expect(decide({ response: ok(run), existingRun: existing, attempts: 1 })).toMatchObject({
      action: 'none',
      outcome: 'noop',
      recalculateFrom: '2026-10-12',
    });
    expect(decide({ response: ok(stravaActivity({ sport_type: 'Ride' })), attempts: 2 })).toMatchObject({
      action: 'none',
      outcome: 'not_a_run',
      recalculateFrom: '2026-10-12',
    });
    // First attempt: nothing to recalculate.
    expect(decide({ response: ok(run), existingRun: existing, attempts: 0 })).toMatchObject({ recalculateFrom: null });
  });

  it('decide only ever answers with an outcome from the list or none', () => {
    const responses: StravaResponse[] = [ok(run), ok(stravaActivity({ private: true })), ok(stravaActivity({ sport_type: 'Ride' })), http(401), http(404), http(429), http(500), NETWORK_ERROR];
    const seen = new Set<string>();
    for (const aspect_type of ['create', 'update', 'delete'] as const) {
      for (const paused of [false, true]) {
        for (const response of responses) {
          for (const existingRun of [null, runFor(run)]) {
            const { outcome } = decide({ aspect_type, paused, response, existingRun });
            if (outcome !== null) seen.add(outcome);
            expect(outcome === null || (WEBHOOK_OUTCOMES as readonly string[]).includes(outcome)).toBe(true);
          }
        }
      }
    }
    expect(seen.size).toBeGreaterThan(0);
  });

  it('decide does not touch the database or the network', () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('decideAction must not call fetch');
    });
    vi.stubGlobal('fetch', fetchSpy);
    const responses: StravaResponse[] = [ok(run), http(404), http(401), http(429), http(500), NETWORK_ERROR];
    for (const response of responses) {
      for (const aspect_type of ['create', 'update', 'delete'] as const) {
        decide({ aspect_type, response, existingRun: runFor(run) });
      }
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getSupabaseClient).not.toHaveBeenCalled();
  });

  it('decide returns the same answer for the same input', () => {
    const input: DecideInput = {
      aspect_type: 'update',
      paused: false,
      response: ok(stravaActivity({ distance: 9000 })),
      existingRun: runFor(run),
      attempts: 1,
      tokenRefreshed: false,
    };
    expect(decideAction(input)).toEqual(decideAction(structuredClone(input)));
    // The inputs are not changed.
    expect(input.existingRun).toEqual(runFor(run));
  });
});

/**
 * ADR 010 7.1 as a table: Strava's answer x event x paused x whether a strava run exists.
 * "-" = no run in the database. Every row of the ADR's table is at least one case; the paused and delete variants are the
 * italic parts of the ADR rows.
 */
describe('ADR 010 decision table', () => {
  const visible = ok(run);
  const changed = ok(stravaActivity({ distance: 9000 }));
  const ride = ok(stravaActivity({ sport_type: 'Ride' }));
  const hidden = ok(stravaActivity({ private: true }));
  const have = runFor(run);

  /** The date of the fixture run: every recalculation in the table starts here. */
  const DAY = '2026-10-12';

  type Expected = {
    action: string;
    outcome: string | null;
    recalculateFrom: string | null;
    clearWeather: boolean;
    recalculateUnknown: boolean;
  };
  /** Every row states all effects, so a row that starts recalculating or clearing weather by mistake is caught. */
  const X = (action: string, outcome: string | null, recalculateFrom: string | null = null): Expected => ({
    action,
    outcome,
    recalculateFrom,
    clearWeather: false,
    recalculateUnknown: false,
  });

  type Row = {
    label: string;
    aspect_type: 'create' | 'update' | 'delete';
    paused: boolean;
    response: StravaResponse;
    existing: ExistingRun | null;
    expected: Expected;
  };

  const rows: Row[] = [
    // 200, running, public, distance > 0
    { label: '200 running, no run: create inserts', aspect_type: 'create', paused: false, response: visible, existing: null, expected: X('insert', 'imported', DAY) },
    { label: '200 running, no run: update inserts (create was missed)', aspect_type: 'update', paused: false, response: visible, existing: null, expected: X('insert', 'imported', DAY) },
    { label: '200 running, run exists and differs: update updates', aspect_type: 'update', paused: false, response: changed, existing: have, expected: X('update', 'updated', DAY) },
    { label: '200 running, run exists and differs: create (race with polling) updates', aspect_type: 'create', paused: false, response: changed, existing: have, expected: X('update', 'updated', DAY) },
    { label: '200 running, run exists and matches: noop', aspect_type: 'update', paused: false, response: visible, existing: have, expected: X('none', 'noop') },
    { label: '200 running, delete event: not confirmed (run exists)', aspect_type: 'delete', paused: false, response: visible, existing: have, expected: X('none', 'ignored_not_confirmed') },
    { label: '200 running, delete event: not confirmed (no run)', aspect_type: 'delete', paused: false, response: visible, existing: null, expected: X('none', 'ignored_not_confirmed') },
    { label: '200 running, paused update with run: ignored', aspect_type: 'update', paused: true, response: changed, existing: have, expected: X('none', 'ignored_paused') },
    { label: '200 running, paused update without run: ignored', aspect_type: 'update', paused: true, response: visible, existing: null, expected: X('none', 'ignored_paused') },
    { label: '200 running, paused delete: not confirmed as usual', aspect_type: 'delete', paused: true, response: visible, existing: have, expected: X('none', 'ignored_not_confirmed') },
    // 200, not a run or private
    { label: '200 type changed, strava run exists: removed_not_running', aspect_type: 'update', paused: false, response: ride, existing: have, expected: X('remove', 'removed_not_running', DAY) },
    { label: '200 private, strava run exists: removed_private', aspect_type: 'update', paused: false, response: hidden, existing: have, expected: X('remove', 'removed_private', DAY) },
    { label: '200 type changed, no run: not_a_run', aspect_type: 'update', paused: false, response: ride, existing: null, expected: X('none', 'not_a_run') },
    { label: '200 private, no run: not_a_run', aspect_type: 'update', paused: false, response: hidden, existing: null, expected: X('none', 'not_a_run') },
    { label: '200 type changed, delete event: removed_not_running', aspect_type: 'delete', paused: false, response: ride, existing: have, expected: X('remove', 'removed_not_running', DAY) },
    { label: '200 type changed, paused: still removed', aspect_type: 'update', paused: true, response: ride, existing: have, expected: X('remove', 'removed_not_running', DAY) },
    { label: '200 private, paused: still removed', aspect_type: 'update', paused: true, response: hidden, existing: have, expected: X('remove', 'removed_private', DAY) },
    { label: '200 not a run, paused, no run: not_a_run', aspect_type: 'update', paused: true, response: ride, existing: null, expected: X('none', 'not_a_run') },
    // 404
    { label: '404, strava run exists: deleted', aspect_type: 'update', paused: false, response: http(404), existing: have, expected: X('remove', 'deleted', DAY) },
    { label: '404, delete event, strava run exists: deleted', aspect_type: 'delete', paused: false, response: http(404), existing: have, expected: X('remove', 'deleted', DAY) },
    { label: '404, no run: not_a_run', aspect_type: 'update', paused: false, response: http(404), existing: null, expected: X('none', 'not_a_run') },
    { label: '404, delete event, no run: not_a_run', aspect_type: 'delete', paused: false, response: http(404), existing: null, expected: X('none', 'not_a_run') },
    { label: '404, paused update, strava run exists: deleted', aspect_type: 'update', paused: true, response: http(404), existing: have, expected: X('remove', 'deleted', DAY) },
    { label: '404, paused delete, strava run exists: deleted', aspect_type: 'delete', paused: true, response: http(404), existing: have, expected: X('remove', 'deleted', DAY) },
    // 401, 429, 5xx, network (the same for every aspect and for a paused user)
    { label: '401 before a refresh: refresh_token', aspect_type: 'update', paused: false, response: http(401), existing: have, expected: X('refresh_token', null) },
    { label: '401 before a refresh, paused: refresh_token', aspect_type: 'delete', paused: true, response: http(401), existing: have, expected: X('refresh_token', null) },
    { label: '429: wait', aspect_type: 'update', paused: false, response: http(429), existing: have, expected: X('wait', null) },
    { label: '429, paused: wait', aspect_type: 'delete', paused: true, response: http(429), existing: null, expected: X('wait', null) },
    { label: '500: retry', aspect_type: 'update', paused: false, response: http(500), existing: have, expected: X('retry', null) },
    { label: '503, delete event: retry', aspect_type: 'delete', paused: false, response: http(503), existing: have, expected: X('retry', null) },
    { label: 'network error: retry', aspect_type: 'create', paused: false, response: NETWORK_ERROR, existing: null, expected: X('retry', null) },
    { label: 'network error, paused: retry', aspect_type: 'update', paused: true, response: NETWORK_ERROR, existing: have, expected: X('retry', null) },
    // A paused create is never a reason to delete, whatever Strava would say and whatever the database holds
    { label: 'paused create, 404, strava run exists: ignored, not removed', aspect_type: 'create', paused: true, response: http(404), existing: have, expected: X('none', 'ignored_paused') },
    { label: 'paused create, not a run, strava run exists: ignored, not removed', aspect_type: 'create', paused: true, response: ride, existing: have, expected: X('none', 'ignored_paused') },
    { label: 'paused create, private, strava run exists: ignored, not removed', aspect_type: 'create', paused: true, response: hidden, existing: have, expected: X('none', 'ignored_paused') },
    { label: 'paused create, visible run: ignored', aspect_type: 'create', paused: true, response: visible, existing: null, expected: X('none', 'ignored_paused') },
  ];

  it.each(rows)('$label', ({ aspect_type, paused, response, existing, expected }) => {
    expect(decide({ aspect_type, paused, response, existingRun: existing })).toMatchObject(expected);
  });

  it('answers a second 401 after a refresh as a retry for every aspect', () => {
    for (const aspect_type of ['create', 'update', 'delete'] as const) {
      expect(decide({ aspect_type, response: http(401), tokenRefreshed: true })).toMatchObject({ action: 'retry', reason: 'unauthorized' });
    }
  });
});

describe('decideAction comparison with the stored run', () => {
  it('decide returns noop when PostgreSQL rounds the distance half up where JavaScript rounds it down', () => {
    // 8575 m = 8.575 km is stored as 8.58 (JS rounds the binary double to 8.57); 1005 m = 1.005 km is stored as 1.01 (JS: 1.00).
    for (const [metres, stored] of [[8575, 8.58], [1005, 1.01]] as const) {
      const activity = stravaActivity({ distance: metres });
      const existing = runFor(activity, { distance: stored });
      expect(decide({ response: ok(activity), existingRun: existing }), `${metres} m`).toMatchObject({ action: 'none', outcome: 'noop' });
    }
  });

  it('decide updates when the distance differs by more than the rounding of the column', () => {
    const activity = stravaActivity({ distance: 8575 });
    // 8.60 and 8.56 are 0.025 and 0.015 km from 8.575: real changes, not rounding.
    for (const stored of [8.6, 8.56]) {
      const decision = decide({ response: ok(activity), existingRun: runFor(activity, { distance: stored }) });
      expect(decision, `stored ${stored}`).toMatchObject({ action: 'update', changes: { distance: 8.575 } });
    }
  });

  // One changed field per extended column. The changed activity is spread after the factory, so the splits do not follow
  // moving_time or distance and exactly the named column moves.
  const oneChange: Record<string, { patch: Record<string, unknown>; expectedValue: unknown }> = {
    start_time: { patch: { start_date_local: '2026-10-12T08:15:00Z' }, expectedValue: '2026-10-12T08:15:00Z' },
    moving_time: { patch: { moving_time: 1600 }, expectedValue: 1600 },
    total_elevation_gain: { patch: { total_elevation_gain: 50 }, expectedValue: 50 },
    sport_type: { patch: { sport_type: 'TrailRun' }, expectedValue: 'TrailRun' },
    avg_heartrate: { patch: { average_heartrate: 150 }, expectedValue: 150 },
    max_heartrate: { patch: { max_heartrate: 180 }, expectedValue: 180 },
    suffer_score: { patch: { suffer_score: 42 }, expectedValue: 42 },
    start_lat: { patch: { start_latlng: [60.1, 18.0686] }, expectedValue: 60.1 },
    start_lng: { patch: { start_latlng: [59.3293, 19.5] }, expectedValue: 19.5 },
    pace_std_dev: {
      patch: { splits_metric: [{ distance: 1000, moving_time: 300 }, { distance: 1000, moving_time: 330 }] },
      expectedValue: 15,
    },
    is_treadmill: { patch: { trainer: true }, expectedValue: true },
  };

  it('decide compares every extended column that the import writes', () => {
    // A column added to extractExtendedFields must get a row here, or this fails until it does.
    expect(Object.keys(oneChange).sort()).toEqual(Object.keys(extractExtendedFields(run)).sort());
  });

  it.each(Object.entries(oneChange))('decide updates exactly the %s column when only that field changed', (column, { patch, expectedValue }) => {
    const changedActivity = { ...run, ...patch } as Activity;
    const decision = decide({ response: ok(changedActivity), existingRun: runFor(run) });
    expect(decision.action).toBe('update');
    const changes = (decision as { changes: Record<string, unknown> }).changes;
    expect(Object.keys(changes)).toEqual([column]);
    expect(changes[column]).toBe(expectedValue);
  });

  it('decide updates a column that Strava no longer reports to null', () => {
    const withHeart = { ...run, average_heartrate: 150 } as Activity;
    const decision = decide({ response: ok(run), existingRun: runFor(withHeart) });
    expect(decision).toMatchObject({ action: 'update', changes: { avg_heartrate: null } });
  });

  it('decide treats a null is_treadmill in the database as false', () => {
    expect(decide({ response: ok(run), existingRun: runFor(run, { is_treadmill: null }) })).toMatchObject({ action: 'none', outcome: 'noop' });
  });
});

describe('decideAction input edges', () => {
  it('decide answers retry/invalid_response for a running activity without start_date_local', () => {
    const noDate = { ...run, start_date_local: undefined } as unknown as Activity;
    for (const existingRun of [null, runFor(run)]) {
      expect(decide({ response: ok(noDate), existingRun })).toMatchObject({ action: 'retry', reason: 'invalid_response' });
    }
  });

  it('decide treats attempts that is NaN, negative or infinite as 0', () => {
    for (const attempts of [Number.NaN, -1, -50, Number.POSITIVE_INFINITY]) {
      expect(decide({ response: http(503), attempts }), String(attempts)).toMatchObject({
        action: 'retry',
        retryAfterMinutes: WEBHOOK_BACKOFF_MINUTES[0],
      });
      // Attempts counted as 0 means a first try: no retry recalculation.
      expect(decide({ response: ok(run), existingRun: runFor(run), attempts }), String(attempts)).toMatchObject({
        outcome: 'noop',
        recalculateFrom: null,
      });
    }
  });

  it('decide handles a legacy type without sport_type', () => {
    const legacyRun = { ...run, sport_type: undefined, type: 'Run' } as unknown as Activity;
    const legacyRide = { ...run, sport_type: undefined, type: 'Ride' } as unknown as Activity;
    expect(decide({ aspect_type: 'create', response: ok(legacyRun) })).toMatchObject({ action: 'insert', outcome: 'imported' });
    expect(decide({ response: ok(legacyRide), existingRun: runFor(run) })).toMatchObject({ action: 'remove', outcome: 'removed_not_running' });
    expect(decide({ response: ok(legacyRide) })).toMatchObject({ action: 'none', outcome: 'not_a_run' });
  });
});

describe('decideAction recalculation after a failed attempt', () => {
  it('decide flags an unknown recalculation date on a retry that gets 404 and finds no run', () => {
    // The earlier attempt may have deleted the run and died before the recalculation; the date went with the run.
    expect(decide({ response: http(404), existingRun: null, attempts: 1 })).toMatchObject({
      action: 'none',
      outcome: 'not_a_run',
      recalculateFrom: null,
      recalculateUnknown: true,
    });
    expect(decide({ aspect_type: 'delete', response: http(404), existingRun: null, attempts: 3 })).toMatchObject({
      recalculateFrom: null,
      recalculateUnknown: true,
    });
  });

  it('decide flags an unknown date when a non-running answer carries no start date and no run exists', () => {
    const noDate = { ...run, sport_type: 'Ride', start_date_local: undefined } as unknown as Activity;
    expect(decide({ response: ok(noDate), existingRun: null, attempts: 2 })).toMatchObject({
      action: 'none',
      outcome: 'not_a_run',
      recalculateFrom: null,
      recalculateUnknown: true,
    });
  });

  it('decide does not flag an unknown date on a first try, when the date is known, or when a run is removed', () => {
    const cases = [
      decide({ response: http(404), existingRun: null, attempts: 0 }),
      decide({ response: ok(stravaActivity({ sport_type: 'Ride' })), existingRun: null, attempts: 1 }),
      decide({ response: http(404), existingRun: runFor(run), attempts: 1 }),
      decide({ response: ok(run), existingRun: runFor(run), attempts: 1 }),
      decide({ response: http(404), existingRun: runFor(run, { source: 'manual' }), attempts: 1 }),
      decide({ response: http(500), attempts: 1 }),
      decide({ aspect_type: 'create', paused: true, response: http(404), existingRun: null, attempts: 1 }),
    ];
    for (const decision of cases) expect(decision.recalculateUnknown).toBe(false);
  });
});
