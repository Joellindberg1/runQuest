/**
 * The pure part of the nightly Strava reconcile (services/stravaReconcile/plan.ts): which stored runs the list of Strava activities
 * says are missing or different, which fall outside the list window, and which of those the night's rotation looks at.
 */
import { describe, expect, it } from 'vitest';
import { STOCKHOLM_TZ } from '@runquest/shared';
import {
  nightIndex,
  planUser,
  reconcileWindow,
  rotationSlice,
  type ListedActivity,
  type StoredRun,
} from '../stravaReconcile/plan.js';

const run = (externalId: string, date: string, distance = 5): StoredRun => ({ externalId, date, distance });
const listed = (id: number, over: Partial<ListedActivity> = {}): ListedActivity => ({
  id,
  sport_type: 'Run',
  type: 'Run',
  distance: 5000,
  start_date_local: '2026-10-12T07:30:00Z',
  ...over,
});

describe('reconcile window', () => {
  it('starts at Stockholm midnight, window days before today', () => {
    // 04:15 in Stockholm on 17 October (CEST, UTC+2) is 02:15 UTC.
    const { afterSeconds, startDay } = reconcileWindow(new Date('2026-10-17T02:15:00Z'), 30);

    expect(startDay).toBe('2026-09-17');
    // Stockholm midnight on 17 September is 22:00 UTC the day before.
    expect(new Date(afterSeconds * 1000).toISOString()).toBe('2026-09-16T22:00:00.000Z');
    expect(STOCKHOLM_TZ).toBe('Europe/Stockholm');
  });

  it('uses the Stockholm day, not the UTC day, just after midnight', () => {
    // 23:30 UTC on 16 October is 01:30 on 17 October in Stockholm.
    expect(reconcileWindow(new Date('2026-10-16T23:30:00Z'), 30).startDay).toBe('2026-09-17');
  });

  it('counts the night by Stockholm day', () => {
    expect(nightIndex(new Date('2026-10-17T02:15:00Z')) - nightIndex(new Date('2026-10-16T02:15:00Z'))).toBe(1);
    expect(nightIndex(new Date('2026-10-17T02:15:00Z'))).toBe(nightIndex(new Date('2026-10-17T18:00:00Z')));
  });
});

describe('plan for one user', () => {
  const startDay = '2026-09-17';

  it('a stored run that the list shows unchanged needs no check', () => {
    const plan = planUser([run('1', '2026-10-12')], [listed(1)], startDay);

    expect(plan).toEqual({ changed: [], missing: [], older: [] });
  });

  it('a stored run inside the window that the list lacks is missing', () => {
    const plan = planUser([run('1', '2026-10-12'), run('2', '2026-10-13')], [listed(1)], startDay);

    expect(plan.missing).toEqual(['2']);
    expect(plan.changed).toEqual([]);
  });

  it('a run on the first day of the window is not judged by the list, a day of margin is kept', () => {
    // An activity started abroad can fall on the window's first calendar day yet start before Stockholm midnight in UTC terms.
    const plan = planUser([run('1', startDay), run('2', '2026-09-18')], [], startDay);

    expect(plan.missing).toEqual(['2']);
    expect(plan.older.map((r) => r.externalId)).toEqual(['1']);
  });

  it('a run older than the window the list lacks goes to the older pool, not to missing', () => {
    const plan = planUser([run('1', '2026-08-01')], [], startDay);

    expect(plan.missing).toEqual([]);
    expect(plan.older).toEqual([run('1', '2026-08-01')]);
  });

  it('a listed run with another distance or another date is changed', () => {
    const plan = planUser(
      [run('1', '2026-10-12', 5), run('2', '2026-10-12', 5), run('3', '2026-10-12', 5)],
      [listed(1, { distance: 8000 }), listed(2, { start_date_local: '2026-10-13T07:30:00Z' }), listed(3)],
      startDay,
    );

    expect(plan.changed).toEqual(['1', '2']);
  });

  it('a distance that the column rounds to the same value is not a change', () => {
    // numeric(6,2): 5.2345 km is stored as 5.23.
    const plan = planUser([run('1', '2026-10-12', 5.23)], [listed(1, { distance: 5234.5 })], startDay);

    expect(plan.changed).toEqual([]);
  });

  it('a listed activity that is no longer a run, or has no distance left, is changed', () => {
    const plan = planUser(
      [run('1', '2026-10-12'), run('2', '2026-10-12'), run('3', '2026-10-12')],
      [listed(1, { sport_type: 'Ride', type: 'Ride' }), listed(2, { distance: 0 }), listed(3)],
      startDay,
    );

    expect(plan.changed).toEqual(['1', '2']);
  });

  it('a listed activity the plan cannot read is checked, never trusted', () => {
    const plan = planUser(
      [run('1', '2026-10-12'), run('2', '2026-10-12')],
      [listed(1, { distance: undefined }), listed(2, { start_date_local: 'soon' })],
      startDay,
    );

    expect(plan.changed).toEqual(['1', '2']);
  });

  it('a listed activity the user has no run for is ignored, importing is the polling job', () => {
    const plan = planUser([run('1', '2026-10-12')], [listed(1), listed(99)], startDay);

    expect(plan).toEqual({ changed: [], missing: [], older: [] });
  });

  it('a listed run found by a string id or a number id alike', () => {
    expect(planUser([run('12345678901', '2026-10-12')], [listed(12345678901)], startDay).missing).toEqual([]);
    expect(planUser([run('12345678901', '2026-10-12')], [{ ...listed(0), id: '12345678901' }], startDay).missing).toEqual([]);
  });

  it('a listed run older than the window is verified by the list too', () => {
    const plan = planUser([run('1', '2026-08-01')], [listed(1, { start_date_local: '2026-08-01T07:30:00Z' })], startDay);

    expect(plan).toEqual({ changed: [], missing: [], older: [] });
  });
});

describe('rotation through the older runs', () => {
  const pool = Array.from({ length: 10 }, (_, i) => run(String(100 + i), `2026-0${(i % 9) + 1}-10`));

  it('takes everything when the pool is no bigger than the night count', () => {
    expect(rotationSlice(pool.slice(0, 3), 7, 5)).toHaveLength(3);
    expect(rotationSlice(pool, 7, 10)).toHaveLength(10);
  });

  it('takes nothing for a count of zero or an empty pool', () => {
    expect(rotationSlice(pool, 7, 0)).toEqual([]);
    expect(rotationSlice([], 7, 5)).toEqual([]);
  });

  it('takes the same slice on the same night, whatever order the pool arrives in', () => {
    const shuffled = [...pool].reverse();

    expect(rotationSlice(shuffled, 3, 4)).toEqual(rotationSlice(pool, 3, 4));
  });

  it('gives every run a turn within ceil(pool / count) nights, wrapping around the end', () => {
    const seen = new Set<string>();
    const nights = Math.ceil(pool.length / 4);
    for (let night = 20; night < 20 + nights; night += 1) {
      for (const r of rotationSlice(pool, night, 4)) seen.add(r.externalId);
    }

    expect(seen.size).toBe(pool.length);
  });

  it('never takes the same run twice in one night, also when it wraps', () => {
    for (let night = 0; night < 12; night += 1) {
      const ids = rotationSlice(pool, night, 4).map((r) => r.externalId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
