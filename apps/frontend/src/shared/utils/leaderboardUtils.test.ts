import { describe, expect, it } from 'vitest';
import type { Run, User } from '@runquest/types';
import { groupTimeZone } from '@runquest/shared';
import { leaderboardUtils } from './leaderboardUtils';

const userWithRuns = (runs: Array<Pick<Run, 'date' | 'xp_gained'>>): User => ({ runs } as unknown as User);

describe('calculateLast14DaysXP — kalenderdagar, inte ögonblick', () => {
  const now = new Date('2026-10-20T15:00:00Z'); // 17:00 svensk tid, tisdag

  it('counts the run 13 days ago whatever the hour, so the window is 14 calendar days with today', () => {
    const user = userWithRuns([
      { date: '2026-10-06', xp_gained: 1000 }, // 14 dagar sedan: utanför
      { date: '2026-10-07', xp_gained: 140 },  // 13 dagar sedan: första dagen i fönstret
      { date: '2026-10-20', xp_gained: 140 },
    ]);
    expect(leaderboardUtils.calculateLast14DaysXP(user, now)).toBe(20);
  });

  it('counts a run of today at 00:30 Stockholm time, when the UTC date is still yesterday', () => {
    const justAfterMidnight = new Date('2026-10-19T22:30:00Z');
    const user = userWithRuns([{ date: '2026-10-20', xp_gained: 140 }]);
    expect(leaderboardUtils.calculateLast14DaysXP(user, justAfterMidnight)).toBe(10);
  });

  it('does not count runs dated after today', () => {
    const user = userWithRuns([{ date: '2026-10-21', xp_gained: 140 }, { date: '2026-10-20', xp_gained: 14 }]);
    expect(leaderboardUtils.calculateLast14DaysXP(user, now)).toBe(1);
  });

  it('rounds the average down and is 0 without runs', () => {
    expect(leaderboardUtils.calculateLast14DaysXP(userWithRuns([{ date: '2026-10-20', xp_gained: 27 }]), now)).toBe(1);
    expect(leaderboardUtils.calculateLast14DaysXP(userWithRuns([]), now)).toBe(0);
    expect(leaderboardUtils.calculateLast14DaysXP({} as User, now)).toBe(0);
  });

  it('another time zone through the group resolver moves today and so the window', () => {
    const user = userWithRuns([{ date: '2026-10-20', xp_gained: 140 }]);
    const lateEvening = new Date('2026-10-20T02:30:00Z'); // 04:30 den 20:e i Stockholm, 22:30 den 19:e i New York
    expect(leaderboardUtils.calculateLast14DaysXP(user, lateEvening)).toBe(10);
    expect(leaderboardUtils.calculateLast14DaysXP(user, lateEvening, groupTimeZone('g1', () => 'America/New_York'))).toBe(0);
  });
});
