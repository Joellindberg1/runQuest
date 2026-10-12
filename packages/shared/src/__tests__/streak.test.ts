import { describe, expect, it } from 'vitest';
import {
  advanceStreakDay, currentStreak, isNextDay, longestStreak, streakDayForRun, streakStatus,
} from '../streak.js';
import { daysBetween, stockholmDay } from '../calendar.js';

describe('stockholmDay', () => {
  it('ger Stockholm-dagen, inte UTC-dagen: 22:30 UTC i sommartid är 00:30 nästa dag', () => {
    expect(stockholmDay(new Date('2026-10-04T22:30:00Z'))).toBe('2026-10-05');
  });

  it('vintertid (UTC+1): 23:30 UTC är 00:30 nästa dag, 22:30 UTC är fortfarande samma dag', () => {
    expect(stockholmDay(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01');
    expect(stockholmDay(new Date('2026-12-31T22:30:00Z'))).toBe('2026-12-31');
  });

  it('sommartidsgränserna: dygnsskiftet följer offseten före/efter skiftet', () => {
    // 2026-03-29 02:00 -> 03:00 (UTC+1 -> +2); 2026-10-25 03:00 -> 02:00 (UTC+2 -> +1)
    expect(stockholmDay(new Date('2026-03-28T22:59:59Z'))).toBe('2026-03-28');
    expect(stockholmDay(new Date('2026-03-28T23:00:00Z'))).toBe('2026-03-29');
    expect(stockholmDay(new Date('2026-10-24T21:59:59Z'))).toBe('2026-10-24');
    expect(stockholmDay(new Date('2026-10-24T22:00:00Z'))).toBe('2026-10-25');
    expect(stockholmDay(new Date('2026-10-25T22:59:59Z'))).toBe('2026-10-25');
    expect(stockholmDay(new Date('2026-10-25T23:00:00Z'))).toBe('2026-10-26');
  });
});

describe('daysBetween / isNextDay', () => {
  it('räknar kalenderdagar över månads-, års- och sommartidsskiften', () => {
    expect(daysBetween('2026-09-30', '2026-10-01')).toBe(1);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2026-10-25', '2026-10-26')).toBe(1);
    expect(daysBetween('2026-03-29', '2026-03-28')).toBe(-1);
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2); // skottår
  });

  it('isNextDay', () => {
    expect(isNextDay('2026-10-04', '2026-10-05')).toBe(true);
    expect(isNextDay('2026-10-04', '2026-10-04')).toBe(false);
    expect(isNextDay('2026-10-04', '2026-10-06')).toBe(false);
  });
});

describe('longestStreak', () => {
  it('0 för tom lista, 1 för en ensam dag', () => {
    expect(longestStreak([])).toBe(0);
    expect(longestStreak(['2025-09-30'])).toBe(1);
  });

  it('hittar den längsta följden när det finns glapp, oavsett ordning och dubbletter', () => {
    expect(longestStreak(['2025-09-11', '2025-09-01', '2025-09-02', '2025-09-03', '2025-09-10', '2025-09-02'])).toBe(3);
  });

  it('ett glapp på två dagar bryter; separerade dagar ger 1', () => {
    expect(longestStreak(['2025-09-01', '2025-09-03'])).toBe(1);
    expect(longestStreak(['2025-09-01', '2025-09-05', '2025-09-10'])).toBe(1);
  });

  it('en lång obruten följd över månadsskifte', () => {
    const days = Array.from({ length: 40 }, (_, i) => new Date(Date.UTC(2025, 8, 1 + i)).toISOString().slice(0, 10));
    expect(longestStreak(days)).toBe(40);
  });
});

describe('streakStatus / currentStreak', () => {
  const TODAY = '2026-10-05';

  it('streakStatus: idag, igår, annars bruten (också framtida dagar och ingen runda)', () => {
    expect(streakStatus('2026-10-05', TODAY)).toBe('ran_today');
    expect(streakStatus('2026-10-04', TODAY)).toBe('ran_yesterday');
    expect(streakStatus('2026-10-03', TODAY)).toBe('broken');
    expect(streakStatus('2026-10-06', TODAY)).toBe('broken');
    expect(streakStatus(null, TODAY)).toBe('broken');
  });

  it('igår över månadsskifte', () => {
    expect(streakStatus('2026-09-30', '2026-10-01')).toBe('ran_yesterday');
    expect(streakStatus('2026-12-31', '2027-01-01')).toBe('ran_yesterday');
  });

  it('0 för tom lista och för en streak vars senaste dag är äldre än igår', () => {
    expect(currentStreak([], TODAY)).toBe(0);
    expect(currentStreak(['2020-01-01'], TODAY)).toBe(0);
    expect(currentStreak(['2026-10-02', '2026-10-03'], TODAY)).toBe(0);
  });

  it('räknar följden som slutar idag eller igår', () => {
    expect(currentStreak(['2026-10-03', '2026-10-04', '2026-10-05'], TODAY)).toBe(3);
    expect(currentStreak(['2026-10-02', '2026-10-03', '2026-10-04'], TODAY)).toBe(3);
  });

  it('glapp före idag bryter följden: bara dagens del räknas', () => {
    expect(currentStreak(['2026-10-02', '2026-10-05'], TODAY)).toBe(1);
  });

  it('en runda 00:30 Stockholm (dagen = Stockholm-dagen) räknas när "idag" är Stockholm-dagen', () => {
    const today = stockholmDay(new Date('2026-10-04T22:30:00Z'));
    expect(currentStreak(['2026-10-03', '2026-10-04', '2026-10-05'], today)).toBe(3);
  });
});

describe('streakDayForRun', () => {
  it('1 för en ensam dag och för en dag som inte finns bland dagarna', () => {
    expect(streakDayForRun(['2025-09-30'], '2025-09-30')).toBe(1);
    expect(streakDayForRun(['2025-09-28', '2025-09-29'], '2025-10-01')).toBe(1);
  });

  it('antalet dagar i följden till och med målet', () => {
    const days = ['2025-09-28', '2025-09-29', '2025-09-30'];
    expect(streakDayForRun(days, '2025-09-30')).toBe(3);
    expect(streakDayForRun(days, '2025-09-29')).toBe(2);
  });

  it('en tidigare följd före ett glapp räknas inte med', () => {
    expect(streakDayForRun(['2025-09-25', '2025-09-27', '2025-09-28'], '2025-09-28')).toBe(2);
    expect(streakDayForRun(['2025-09-25', '2025-09-27'], '2025-09-27')).toBe(1);
  });
});

describe('advanceStreakDay (multiplikatortrappan)', () => {
  it('ingen föregående runda → 1', () => {
    expect(advanceStreakDay(null, '2026-10-05')).toBe(1);
  });

  it('dagen efter → +1, samma dag → oförändrad, glapp över en dag → 1', () => {
    expect(advanceStreakDay({ day: '2026-10-04', streakDay: 6 }, '2026-10-05')).toBe(7);
    expect(advanceStreakDay({ day: '2026-10-05', streakDay: 6 }, '2026-10-05')).toBe(6);
    expect(advanceStreakDay({ day: '2026-10-03', streakDay: 6 }, '2026-10-05')).toBe(1);
  });

  it('en föregående runda utan lagrad streakdag (0) ger 1 dagen efter', () => {
    expect(advanceStreakDay({ day: '2026-10-04', streakDay: 0 }, '2026-10-05')).toBe(1);
  });

  it('över månads-, års- och sommartidsskifte', () => {
    expect(advanceStreakDay({ day: '2026-09-30', streakDay: 2 }, '2026-10-01')).toBe(3);
    expect(advanceStreakDay({ day: '2026-12-31', streakDay: 2 }, '2027-01-01')).toBe(3);
    expect(advanceStreakDay({ day: '2026-10-25', streakDay: 2 }, '2026-10-26')).toBe(3);
  });
});

// ─── Differentialtest mot den gamla räkningen ────────────────────────────────────────────────────
// De gamla loopparna (StreakService + reprocess) kopierade ordagrant men med "idag" som parameter. De ska ge exakt
// samma värden som den nya implementationen på godtyckliga historiker — det enda som får skilja är hur "idag" tas fram.

const DAY_MS = 1000 * 60 * 60 * 24;
const diff = (a: string, b: string) => Math.floor((new Date(b).getTime() - new Date(a).getTime()) / DAY_MS);

function oldLongest(sortedDays: string[]): number {
  if (sortedDays.length === 0) return 0;
  let longest = 1;
  let current = 1;
  for (let i = 1; i < sortedDays.length; i++) {
    if (diff(sortedDays[i - 1], sortedDays[i]) === 1) current++;
    else { longest = Math.max(longest, current); current = 1; }
  }
  return Math.max(longest, current);
}

function oldCurrent(sortedDays: string[], today: string, yesterday: string): number {
  if (sortedDays.length === 0) return 0;
  const latest = sortedDays[sortedDays.length - 1];
  if (latest !== today && latest !== yesterday) return 0;
  let streak = 1;
  for (let i = sortedDays.length - 2; i >= 0; i--) {
    if (diff(sortedDays[i], sortedDays[i + 1]) === 1) streak++;
    else break;
  }
  return streak;
}

function oldStreakDay(sortedDays: string[], target: string): number {
  const index = sortedDays.indexOf(target);
  if (index === -1) return 1;
  let streakDay = 1;
  for (let i = index - 1; i >= 0; i--) {
    if (diff(sortedDays[i], sortedDays[i + 1]) === 1) streakDay++;
    else break;
  }
  return streakDay;
}

/** Reprocess-trappan som den såg ut: seedad från (datum, streak_day) före fromDate, runorna i datumordning. */
function oldLadder(seed: { date: string; streak_day: number } | null, dates: string[]): number[] {
  let count = seed?.streak_day ?? 0;
  let last: Date | null = seed ? new Date(seed.date) : null;
  return dates.map((date) => {
    const current = new Date(date);
    const daysDiff = last ? Math.floor((current.getTime() - last.getTime()) / DAY_MS) : -1;
    if (!last || daysDiff > 1) count = 1;
    else if (daysDiff === 1) count++;
    last = current;
    return count;
  });
}

function newLadder(seed: { date: string; streak_day: number } | null, dates: string[]): number[] {
  let previous = seed ? { day: seed.date, streakDay: seed.streak_day ?? 0 } : null;
  return dates.map((date) => {
    const streakDay = advanceStreakDay(previous, date);
    previous = { day: date, streakDay };
    return streakDay;
  });
}

function lcg(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

describe('differentialtest: ny räkning = gammal räkning för samma "idag"', () => {
  const histories = (seed: number) => {
    const rand = lcg(seed);
    return Array.from({ length: 300 }, () => {
      const start = addDays('2025-12-01', Math.floor(rand() * 400)); // spänner över årsskifte och båda sommartidsskiftena
      const length = Math.floor(rand() * 40);
      const days: string[] = [];
      let cursor = start;
      for (let i = 0; i < length; i++) {
        cursor = addDays(cursor, rand() < 0.75 ? 1 : 1 + Math.floor(rand() * 4)); // mest dag-efter-dag, ibland glapp
        days.push(cursor);
        if (rand() < 0.15) days.push(cursor); // flera rundor samma dag
      }
      return days;
    });
  };

  it('longest, current och streakDayForRun matchar på 300 slumpade historiker', () => {
    for (const days of histories(42)) {
      const sorted = [...new Set(days)].sort();
      expect(longestStreak(days)).toBe(oldLongest(sorted));
      const lastDay = sorted[sorted.length - 1] ?? '2026-01-01';
      for (const today of [lastDay, addDays(lastDay, 1), addDays(lastDay, 2), addDays(lastDay, -1), '2026-06-15']) {
        expect(currentStreak(days, today)).toBe(oldCurrent(sorted, today, addDays(today, -1)));
      }
      for (const target of sorted) expect(streakDayForRun(days, target)).toBe(oldStreakDay(sorted, target));
    }
  });

  it('trappan matchar med och utan seed på 300 slumpade historiker', () => {
    const rand = lcg(7);
    for (const days of histories(99)) {
      const ordered = [...days].sort();
      expect(newLadder(null, ordered)).toEqual(oldLadder(null, ordered));
      const seed = { date: addDays(ordered[0] ?? '2026-01-01', -(1 + Math.floor(rand() * 3))), streak_day: 1 + Math.floor(rand() * 20) };
      expect(newLadder(seed, ordered)).toEqual(oldLadder(seed, ordered));
    }
  });
});
