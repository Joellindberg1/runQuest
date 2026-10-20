import { describe, expect, it } from 'vitest';
import type { Run, User } from '@runquest/types';
import { groupTimeZone, levelProgress } from '@runquest/shared';
import { leaderboardUtils } from './leaderboardUtils';

const userWithRuns = (runs: Array<Pick<Run, 'date' | 'xp_gained'>>): User => ({ runs } as unknown as User);
const person = (id: string, name: string, total_xp: number): User => ({ id, name, total_xp, runs: [], total_km: 0 } as unknown as User);

describe('all-time ranking — one order, the same as rank_passed', () => {
  it('ranks a user named Joel Lindberg (is_admin) in the standings like everyone else', () => {
    const users = [person('a', 'Anna Berg', 4000), person('j', 'Joel Lindberg', 5000), person('b', 'Bo Ek', 3000)];
    expect(leaderboardUtils.rankedUsers(users).map((user) => user.name)).toEqual(['Joel Lindberg', 'Anna Berg', 'Bo Ek']);
    expect(leaderboardUtils.rankOfUser(users[1], users)).toBe(1);
  });

  it('keeps a user who is simply named Admin in the standings too, since no name is special', () => {
    const users = [person('a', 'Admin', 100), person('b', 'Bo Ek', 50)];
    expect(leaderboardUtils.rankedUsers(users).map((user) => user.name)).toEqual(['Admin', 'Bo Ek']);
  });

  it('places two users with equal XP in name order, then id, never sharing a place', () => {
    const users = [person('z-2', 'Cleo', 1000), person('z-1', 'cleo', 1000), person('a-1', 'Adam', 1000), person('top', 'Zed', 2000)];
    expect(leaderboardUtils.rankedUsers(users).map((user) => user.id)).toEqual(['top', 'a-1', 'z-1', 'z-2']);
    expect(users.map((user) => leaderboardUtils.rankOfUser(user, users))).toEqual([4, 3, 2, 1]);
  });

  it('does not reorder by level first: more XP is always ahead', () => {
    const users = [person('a', 'Anna', 5242), person('b', 'Bea', 5243)];
    expect(leaderboardUtils.rankedUsers(users).map((user) => user.id)).toEqual(['b', 'a']);
  });

  it('gives no place to a user who is not in the list', () => {
    expect(leaderboardUtils.rankOfUser(person('x', 'Xena', 1), [person('a', 'Anna', 5)])).toBeNull();
  });
});

describe('calculateUserStats — level progress from the shared levelProgress', () => {
  it('takes percent and XP left as shared computes them, with no rounding of its own', () => {
    const totalXp = 5243.45;
    const shared = levelProgress(totalXp);
    const stats = leaderboardUtils.calculateUserStats(person('a', 'Anna', totalXp));
    expect(stats.level).toBe(shared.currentLevel);
    expect(stats.xpProgress).toBe(shared.progress);
    expect(stats.xpLeftForNextLevel).toBe(shared.xpToNext);
    expect(stats.xpInLevel).toBe(Math.round(totalXp - shared.currentLevelXP));
    expect(stats.xpLevelRange).toBe(Math.round(shared.nextLevelXP - shared.currentLevelXP));
  });

  it('is full with nothing left on the max level, and never has negative XP left', () => {
    const max = leaderboardUtils.calculateUserStats(person('a', 'Anna', 9_999_999));
    expect(max).toMatchObject({ xpProgress: 100, xpLeftForNextLevel: 0, xpInLevel: 0, xpLevelRange: 0 });
    expect(leaderboardUtils.calculateUserStats(person('b', 'Bo', -50)).xpLeftForNextLevel).toBeGreaterThanOrEqual(0);
  });
});

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
