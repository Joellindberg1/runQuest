import { describe, expect, it } from 'vitest';
import type { Run } from '@runquest/types';
import { daysBetween, stockholmClock } from '@runquest/shared';
import { formatCountdown } from '@/shared/utils/format';
import { formatAgo } from '@/features/news/newsModel';
import { leaderboardUtils } from '@/shared/utils/leaderboardUtils';

// RUN-218 T2 — karaktärisering av frontendens datumkopior (boardFormat, newsModel, rightNowItems, leaderboardUtils) INNAN
// de ersattes av packages/shared/src/calendar.ts. Samma tabeller som i shared/backend ska ge samma svar här.

describe('daysBetween (boardFormat)', () => {
  it.each([
    ['2026-10-04', '2026-10-04', 0],
    ['2026-10-04', '2026-10-05', 1],
    ['2026-10-05', '2026-10-04', -1],
    ['2026-09-30', '2026-10-01', 1],
    ['2025-12-31', '2026-01-01', 1],
    ['2028-02-28', '2028-03-01', 2],
    ['2027-02-28', '2027-03-01', 1],
    ['2026-03-28', '2026-03-30', 2],
    ['2026-10-24', '2026-10-26', 2],
    ['2026-01-01', '2027-01-01', 365],
    ['2028-01-01', '2029-01-01', 366],
  ])('%s -> %s = %i', (from, to, expected) => {
    expect(daysBetween(from, to)).toBe(expected);
  });

  it('ogiltig indata ger NaN', () => {
    expect(daysBetween('x', 'y')).toBeNaN();
  });
});

describe('stockholmClock (rightNowItems)', () => {
  it.each([
    ['2026-07-04T22:30:15Z', '2026-07-05', 1_815_000], // sommar: 00:30:15
    ['2026-07-04T22:00:00Z', '2026-07-05', 0], // midnatt blir 0, inte 24:00
    ['2026-07-04T21:59:59Z', '2026-07-04', 86_399_000],
    ['2026-12-31T23:00:00Z', '2027-01-01', 0],
    ['2026-03-29T00:59:59Z', '2026-03-29', 7_199_000], // 01:59:59 vintertid
    ['2026-03-29T01:00:00Z', '2026-03-29', 10_800_000], // 03:00:00 sommartid (02:xx finns inte)
    ['2026-10-25T00:59:59Z', '2026-10-25', 10_799_000], // 02:59:59 sommartid
    ['2026-10-25T01:00:00Z', '2026-10-25', 7_200_000], // 02:00:00 vintertid (andra gången)
    ['2026-07-04T10:00:15.999Z', '2026-07-04', 43_215_000], // millisekunder avrundas bort
  ])('%s -> %s, %i ms in i dygnet', (iso, date, msIntoDay) => {
    expect(stockholmClock(new Date(iso))).toEqual({ date, msIntoDay });
  });
});

describe('formatAgo (newsModel) — dagräkning och dygnsgränser i Stockholm-tid', () => {
  const NOW = new Date('2026-10-26T12:00:00Z');
  it.each([
    ['2026-10-24T22:30:00Z', 'Yesterday'], // 00:30 den 25:e Stockholm, 37,5 h sedan
    ['2026-10-23T12:00:00Z', '3 days ago'],
    ['2026-10-26T11:00:00Z', '1h ago'],
    ['2026-10-25T12:00:00Z', 'Yesterday'], // exakt 24 h
    ['2026-10-19T12:00:00Z', '19 Oct'], // sju dagar -> datum
  ])('%s -> %s', (iso, text) => {
    expect(formatAgo(iso, NOW, true)).toBe(text);
  });

  it('över vårens skifte: 3 dygn sedan', () => {
    expect(formatAgo('2026-03-27T12:00:00Z', new Date('2026-03-30T12:00:00Z'), true)).toBe('3 days ago');
    expect(formatAgo('2026-03-22T12:00:00Z', new Date('2026-03-30T12:00:00Z'), true)).toBe('22 Mar');
  });
});

describe('formatCountdown (coarse) — dygnsgränsen', () => {
  it.each([
    [86_399_999, '23h 59m'],
    [86_400_000, '1d 0h'],
    [90_000_000, '1d 1h'],
    [3 * 86_400_000 + 4 * 3_600_000, '3d 4h'],
  ])('%d ms -> %s', (ms, text) => {
    expect(formatCountdown(ms, 'coarse')).toBe(text);
  });
});

describe('leaderboardUtils.calculateWeekendAverage — veckans lör+sön grupperas på måndagen', () => {
  const run = (date: string, distance: number) => ({ date, distance }) as Run;

  it('söndagen hör till lördagen före (samma måndag)', () => {
    const runs = [
      run('2026-10-03', 10), // lör, vecka 28 sep
      run('2026-10-04', 5), //  sön, samma vecka
      run('2026-10-07', 20), // ons räknas inte
      run('2026-10-10', 8), //  lör, vecka 5 okt
      run('2026-10-11', 3), //  sön, samma vecka
    ];
    expect(leaderboardUtils.calculateWeekendAverage(runs)).toBe((15 + 11) / 2);
  });

  it('årsskifte och sommartidsskifte: sön 2026-03-29 och lör 2026-03-28 är samma helg, 2027-01-02/03 också', () => {
    const runs = [run('2026-03-28', 4), run('2026-03-29', 6), run('2027-01-02', 2), run('2027-01-03', 1)];
    expect(leaderboardUtils.calculateWeekendAverage(runs)).toBe((10 + 3) / 2);
  });

  it('inga helgrundor ger 0', () => {
    expect(leaderboardUtils.calculateWeekendAverage([run('2026-10-07', 20)])).toBe(0);
  });
});
