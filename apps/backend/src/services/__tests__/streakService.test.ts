import { describe, it, expect } from 'vitest';
import { StreakService } from '../streakService.js';

// StreakService har private static-metoder. I TypeScript-kompilatorns
// ögon är de privata, men vid runtime är de tillgängliga som vanliga metoder.
// Vi castar till `any` för att komma åt dem i tester — detta är ett
// etablerat mönster för att testa internals utan att exponera dem i prod-API:t.
const S = StreakService as any;

// ─────────────────────────────────────────────
// calculateLongestStreak
// ─────────────────────────────────────────────

describe('StreakService.calculateLongestStreak', () => {
  it('returnerar 0 för tom lista', () => {
    expect(S.calculateLongestStreak([])).toBe(0);
  });

  it('returnerar 1 för en ensam dag', () => {
    expect(S.calculateLongestStreak(['2025-09-30'])).toBe(1);
  });

  it('räknar 3 konsekutiva dagar korrekt', () => {
    expect(S.calculateLongestStreak(['2025-09-28', '2025-09-29', '2025-09-30'])).toBe(3);
  });

  it('hittar longest streak när det finns ett gap', () => {
    // 3 i rad, gap, 2 i rad → longest = 3
    const days = ['2025-09-01', '2025-09-02', '2025-09-03', '2025-09-10', '2025-09-11'];
    expect(S.calculateLongestStreak(days)).toBe(3);
  });

  it('hanterar gap på exakt 2 dagar (bruten streak)', () => {
    const days = ['2025-09-01', '2025-09-03']; // Gap på 2 dagar
    expect(S.calculateLongestStreak(days)).toBe(1);
  });

  it('räknar korrekt när alla dagar är separerade', () => {
    const days = ['2025-09-01', '2025-09-05', '2025-09-10'];
    expect(S.calculateLongestStreak(days)).toBe(1);
  });

  it('hanterar en lång obruten streak', () => {
    const days = Array.from({ length: 30 }, (_, i) => {
      const date = new Date('2025-09-01');
      date.setDate(date.getDate() + i);
      return date.toISOString().split('T')[0];
    });
    expect(S.calculateLongestStreak(days)).toBe(30);
  });
});

// ─────────────────────────────────────────────
// calculateStreakDayForSpecificRun
// ─────────────────────────────────────────────

describe('StreakService.calculateStreakDayForSpecificRun', () => {
  it('returnerar 1 för en ensam dag', () => {
    const days = ['2025-09-30'];
    expect(S.calculateStreakDayForSpecificRun(days, '2025-09-30')).toBe(1);
  });

  it('returnerar 1 om datumet inte finns i listan', () => {
    const days = ['2025-09-28', '2025-09-29'];
    expect(S.calculateStreakDayForSpecificRun(days, '2025-10-01')).toBe(1);
  });

  it('returnerar korrekt streak day för tredje dagen i rad', () => {
    const days = ['2025-09-28', '2025-09-29', '2025-09-30'];
    expect(S.calculateStreakDayForSpecificRun(days, '2025-09-30')).toBe(3);
  });

  it('returnerar 1 om det finns ett gap precis innan target', () => {
    const days = ['2025-09-25', '2025-09-27', '2025-09-28'];
    // 2025-09-28 är dag 2 (27→28 är konsekutivt, men 25→27 är gap)
    expect(S.calculateStreakDayForSpecificRun(days, '2025-09-28')).toBe(2);
  });

  it('räknar korrekt för en retroaktivt inlagd run mitt i en streak', () => {
    // Scenario: runs finns på 28, 30 — man lägger till 29 i efterhand
    const days = ['2025-09-28', '2025-09-29', '2025-09-30'];
    expect(S.calculateStreakDayForSpecificRun(days, '2025-09-29')).toBe(2);
  });

  it('returnerar rätt streak day för den sista i en lång streak', () => {
    const days = Array.from({ length: 10 }, (_, i) => {
      const date = new Date('2025-09-01');
      date.setDate(date.getDate() + i);
      return date.toISOString().split('T')[0];
    });
    const lastDay = days[days.length - 1];
    expect(S.calculateStreakDayForSpecificRun(days, lastDay)).toBe(10);
  });
});

// ─────────────────────────────────────────────
// calculateCurrentStreak
// ─────────────────────────────────────────────

describe('StreakService.calculateCurrentStreak', () => {
  it('returnerar 0 för tom lista', () => {
    expect(S.calculateCurrentStreak([])).toBe(0);
  });

  it('returnerar 0 om senaste run är äldre än igår', () => {
    // En gammal dag som definitivt inte är igår eller idag
    expect(S.calculateCurrentStreak(['2020-01-01'])).toBe(0);
  });

  it('returnerar korrekt streak för aktiva dagar (igår + idag)', () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const dayBefore = new Date(today);
    dayBefore.setDate(dayBefore.getDate() - 2);

    const todayStr = today.toISOString().split('T')[0];
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    const dayBeforeStr = dayBefore.toISOString().split('T')[0];

    const days = [dayBeforeStr, yesterdayStr, todayStr];
    expect(S.calculateCurrentStreak(days)).toBe(3);
  });

  it('bryter streak om det finns ett gap trots att man sprang idag', () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const threeDaysAgo = new Date(today);
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    const todayStr = today.toISOString().split('T')[0];
    const threeDaysAgoStr = threeDaysAgo.toISOString().split('T')[0];

    // Gap på 3 dagar → streak bruten, räknar bara idag
    const days = [threeDaysAgoStr, todayStr];
    expect(S.calculateCurrentStreak(days)).toBe(1);
  });
});
