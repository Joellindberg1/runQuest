import { describe, expect, it } from 'vitest';
import { summariseRunTime } from '@runquest/shared';
import type { User } from '@runquest/types';
import { run, user } from '@/features/profile/profile.fixture';
import { mapApiUser } from './useUsersWithRuns';

const apiUser = (runs: unknown[]): User => user({ id: 'u1', name: 'Joel', total_xp: 100, runs: runs as User['runs'] });

describe('mapApiUser', () => {
  it('distans läses fortfarande som tal ur text, saknad tid blir null och summariseRunTime får tid ur den mappade listan', () => {
    const mapped = mapApiUser(apiUser([
      { ...run({ id: 'a', date: '2026-08-21' }), distance: '10.0', moving_time: 3130 },
      { ...run({ id: 'b', date: '2026-08-20' }), distance: '7.5', moving_time: 2407 },
      { ...run({ id: 'c', date: '2026-08-19' }), distance: '6.0' },
    ]));
    expect(mapped.runs?.[0].distance).toBe(10);
    expect(mapped.runs?.map((r) => r.moving_time)).toEqual([3130, 2407, null]);
    const summary = summariseRunTime(mapped.runs ?? []);
    expect(summary).toMatchObject({ total_seconds: 5537, runs_with_time: 2, runs_total: 3, pace_sec_per_km: 316 });
    expect(summary.distance_km).toBeCloseTo(17.5, 9);
  });
});
