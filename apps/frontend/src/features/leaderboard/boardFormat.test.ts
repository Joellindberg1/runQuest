import { describe, expect, it } from 'vitest';
import {
  deltaLabel, deltaView, latestRunOf, formatCountdown, formatHoursMinutes, formatInt, formatRunAge, isoWeekNumber, preciseRunTime,
} from './boardFormat';
import { daysBetween } from '@runquest/shared';

// Fast klocka: 2026-10-04 12:00 Stockholm (CEST, UTC+2) = 10:00 UTC.
const NOW = new Date('2026-10-04T10:00:00Z');

describe('isoWeekNumber', () => {
  it.each([
    ['2026-01-01', 1], ['2025-12-29', 1], ['2026-10-04', 40], ['2026-10-05', 41],
    ['2024-12-30', 1], ['2021-01-03', 53], ['2020-12-31', 53],
  ])('%s → vecka %i', (date, week) => {
    expect(isoWeekNumber(date)).toBe(week);
  });
});

describe('daysBetween', () => {
  it('räknar kalenderdagar över månads- och årsskiften', () => {
    expect(daysBetween('2026-09-30', '2026-10-04')).toBe(4);
    expect(daysBetween('2025-12-31', '2026-01-01')).toBe(1);
  });
});

describe('formatRunAge — "X h ago" med start_time, created_at, annars datum', () => {
  it('start_time (lokal väggklocka med falskt Z) ger timmar/minuter från Stockholm-ögonblicket', () => {
    // NOW = 12:00 Stockholm. 05:00 väggklocka = 7 h sedan; 11:28 = 32 m; 11:59:40 = just now.
    expect(formatRunAge({ date: '2026-10-04', start_time: '2026-10-04T05:00:00Z' }, NOW)).toBe('7 h ago');
    expect(formatRunAge({ date: '2026-10-04', start_time: '2026-10-04T11:28:00Z' }, NOW)).toBe('32 m ago');
    expect(formatRunAge({ date: '2026-10-04', start_time: '2026-10-04T11:59:40Z' }, NOW)).toBe('just now');
  });

  it('sommar: 06:00 väggklocka räknas som 04:00Z, inte 06:00Z', () => {
    const run = { date: '2026-07-04', start_time: '2026-07-04T06:00:00Z' };
    expect(formatRunAge(run, new Date('2026-07-04T05:00:00Z'))).toBe('1 h ago'); // 07:00 svensk tid
    expect(formatRunAge(run, new Date('2026-07-04T08:30:00Z'))).toBe('4 h ago'); // 10:30 svensk tid
  });

  it('vinter: 06:00 väggklocka räknas som 05:00Z', () => {
    const run = { date: '2026-01-10', start_time: '2026-01-10T06:00:00Z' };
    expect(formatRunAge(run, new Date('2026-01-10T06:30:00Z'))).toBe('1 h ago'); // 07:30 svensk tid
    expect(formatRunAge(run, new Date('2026-01-10T05:30:00Z'))).toBe('30 m ago'); // 06:30 svensk tid
  });

  it('väggklocka efter nu (rundor utomlands, klockskevhet) ger "just now", aldrig negativ ålder', () => {
    // 15:00 väggklocka mot NOW = 12:00 Stockholm.
    expect(formatRunAge({ date: '2026-10-04', start_time: '2026-10-04T15:00:00Z' }, NOW)).toBe('just now');
  });

  it('äldre än ett dygn → dagar efter kalenderdag, även med start_time', () => {
    expect(formatRunAge({ date: '2026-09-30', start_time: '2026-09-30T06:00:00Z' }, NOW)).toBe('4 d ago');
  });

  it('dygnsgränsen räknas i Stockholm-tid: exakt 24 h → dagar, 23 h 59 m → timmar', () => {
    expect(formatRunAge({ date: '2026-10-03', start_time: '2026-10-03T12:00:00Z' }, NOW)).toBe('1 d ago');
    expect(formatRunAge({ date: '2026-10-03', start_time: '2026-10-03T12:01:00Z' }, NOW)).toBe('23 h ago');
  });

  it('created_at används när raden skapades samma Stockholm-dag som rundan (manuell loggning)', () => {
    expect(formatRunAge({ date: '2026-10-04', start_time: null, created_at: '2026-10-04T08:00:00Z' }, NOW)).toBe('2 h ago');
  });

  it('en runda som loggats i efterhand ger inte "h ago": datumet avgör', () => {
    const backfilled = { date: '2026-10-01', start_time: null, created_at: '2026-10-04T09:00:00Z' };
    expect(preciseRunTime(backfilled)).toBeNull();
    expect(formatRunAge(backfilled, NOW)).toBe('3 d ago');
  });

  it('bara datum: today och N d ago (Stockholm-dag, inte UTC)', () => {
    expect(formatRunAge({ date: '2026-10-04' }, NOW)).toBe('today');
    expect(formatRunAge({ date: '2026-10-02' }, NOW)).toBe('2 d ago');
    // 23:30 UTC den 3:e är redan 01:30 den 4:e i Stockholm.
    expect(formatRunAge({ date: '2026-10-04' }, new Date('2026-10-03T23:30:00Z'))).toBe('today');
  });

  it('ogiltig tidsstämpel faller tillbaka på datumet', () => {
    expect(formatRunAge({ date: '2026-10-03', start_time: 'inte-ett-datum' }, NOW)).toBe('1 d ago');
  });
});

describe('tidsformat', () => {
  it('formatHoursMinutes', () => {
    expect(formatHoursMinutes(6 * 3_600_000 + 12 * 60_000)).toBe('6h 12m');
    expect(formatHoursMinutes(2 * 3_600_000 + 40 * 60_000)).toBe('2h 40m');
    expect(formatHoursMinutes(25 * 60_000)).toBe('25m');
    expect(formatHoursMinutes(-5)).toBe('0m');
  });

  it('formatCountdown', () => {
    expect(formatCountdown(6 * 3_600_000 + 12 * 60_000 + 5_000)).toBe('6h 12m 05s');
    expect(formatCountdown(0)).toBe('0h 00m 00s');
  });

  it('formatInt grupperar tusental', () => {
    expect(formatInt(1126.4).replace(/\s/g, ' ')).toBe('1 126');
    expect(formatInt(988)).toBe('988');
  });
});

describe('deltaView — rank_delta positivt = klättrat (ADR 007)', () => {
  it('upp, ner och ingen förändring', () => {
    expect(deltaView(2)).toEqual({ direction: 'up', places: 2, text: '▲ 2' });
    expect(deltaView(-1)).toEqual({ direction: 'down', places: 1, text: '▼ 1' });
    expect(deltaView(0)).toEqual({ direction: 'flat', places: 0, text: '—' });
    expect(deltaView(null)).toEqual({ direction: 'flat', places: 0, text: '—' });
    expect(deltaView(undefined)).toEqual({ direction: 'flat', places: 0, text: '—' });
  });
  it('deltaLabel för skärmläsare', () => {
    expect(deltaLabel(deltaView(2))).toBe('Up 2 places');
    expect(deltaLabel(deltaView(-1))).toBe('Down 1 place');
    expect(deltaLabel(deltaView(0))).toBe('No change');
  });
});

describe('latestRunOf', () => {
  it('senaste datum vinner; tom/saknad lista → null', () => {
    expect(latestRunOf([{ date: '2026-10-01' }, { date: '2026-10-03' }, { date: '2026-10-02' }])).toEqual({ date: '2026-10-03' });
    expect(latestRunOf([])).toBeNull();
    expect(latestRunOf(undefined)).toBeNull();
  });

  it('samma dag: senaste exakta tidpunkt vinner, numeriskt', () => {
    const early = { date: '2026-10-04', start_time: '2026-10-04T05:00:00Z' };
    const later = { date: '2026-10-04', start_time: '2026-10-04T09:00:00Z' };
    expect(latestRunOf([early, later])).toBe(later);
    expect(latestRunOf([later, early])).toBe(later);
  });

  it('en start_time med riktig offset är inte väggklocka och räknas som utan tidpunkt', () => {
    const offset = { date: '2026-10-04', start_time: '2026-10-04T06:30:00+02:00' };
    const timed = { date: '2026-10-04', start_time: '2026-10-04T05:00:00Z' };
    expect(preciseRunTime(offset)).toBeNull();
    expect(latestRunOf([offset, timed])).toBe(timed);
  });

  it('blandar inte tidsbaser: Strava-väggklocka 09:00 (= 07:00Z) är tidigare än manuell created_at 08:00Z (= 10:00 lokal)', () => {
    const strava = { date: '2026-07-04', start_time: '2026-07-04T09:00:00Z', created_at: '2026-07-04T20:00:00Z' };
    const manual = { date: '2026-07-04', start_time: null, created_at: '2026-07-04T08:00:00Z' };
    expect(latestRunOf([strava, manual])).toBe(manual);
    expect(latestRunOf([manual, strava])).toBe(manual);
  });

  it('en tidsatt runda slår en utan tidpunkt samma dag; lika → den första', () => {
    const timed = { date: '2026-10-04', start_time: '2026-10-04T05:00:00Z' };
    const plain = { date: '2026-10-04' };
    expect(latestRunOf([plain, timed])).toBe(timed);
    const other = { date: '2026-10-04' };
    expect(latestRunOf([plain, other])).toBe(plain);
  });
});
