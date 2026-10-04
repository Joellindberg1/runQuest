import { describe, expect, it } from 'vitest';
import {
  buildSubmission, confirmationText, initialForm, parseKm, streakOutlook, todayOf, validateDate, validateDistance, validateForm,
} from './logModel';

describe('todayOf / initialForm', () => {
  it('idag är Stockholm-dagen, inte UTC-dagen', () => {
    // 22:30 UTC den 4 okt = 00:30 CEST den 5 okt.
    expect(todayOf(new Date('2026-10-04T22:30:00Z'))).toBe('2026-10-05');
    expect(todayOf(new Date('2026-10-04T10:00:00Z'))).toBe('2026-10-04');
  });

  it('startar tomt, utomhus och med dagens datum', () => {
    expect(initialForm(new Date('2026-10-04T10:00:00Z'))).toEqual({ date: '2026-10-04', distance: '', surface: 'outdoor' });
  });
});

describe('parseKm', () => {
  it('läser punkt och decimalkomma', () => {
    expect(parseKm('8.4')).toBe(8.4);
    expect(parseKm('8,4')).toBe(8.4);
    expect(parseKm(' 10 ')).toBe(10);
    expect(parseKm('21.1')).toBe(21.1);
    expect(parseKm('.5')).toBe(0.5);
    expect(parseKm('8.')).toBe(8);
  });

  it('tomt och icke-tal blir null', () => {
    for (const raw of ['', '  ', 'abc', '8.4.1', '1e3', '-5', '8 km']) expect(parseKm(raw)).toBeNull();
  });
});

describe('validateDistance', () => {
  it('minst 1.0 km — samma gräns som backend', () => {
    expect(validateDistance('0.9')).toBe('A run needs at least 1.0 km to count');
    expect(validateDistance('1')).toBeUndefined();
    expect(validateDistance('1.0')).toBeUndefined();
    expect(validateDistance('0')).toBe('A run needs at least 1.0 km to count');
  });

  it('tomt är ett fel vid inlämning men tillåtet medan man skriver', () => {
    expect(validateDistance('')).toBe('Enter a distance in km');
    expect(validateDistance('', { allowEmpty: true })).toBeUndefined();
  });

  it('text som inte är ett tal får ett vänligt fel', () => {
    expect(validateDistance('abc')).toBe('Distance must be a number, like 8.4');
  });
});

describe('validateDate', () => {
  const today = '2026-10-04';

  it('idag och datum från 2025-06-01 är giltiga', () => {
    expect(validateDate('2026-10-04', today)).toBeUndefined();
    expect(validateDate('2025-06-01', today)).toBeUndefined();
  });

  it('före projektstart nekas', () => {
    expect(validateDate('2025-05-31', today)).toBe('Runs can only be logged from 1 June 2025');
  });

  it('framtiden nekas', () => {
    expect(validateDate('2026-10-05', today)).toBe('You cannot log a run for a future date');
  });

  it('tomt och omöjliga datum nekas', () => {
    expect(validateDate('', today)).toBe('Pick a date');
    expect(validateDate('2026-02-30', today)).toBe('Pick a date');
    expect(validateDate('04/10/2026', today)).toBe('Pick a date');
  });
});

describe('validateForm / buildSubmission', () => {
  const today = '2026-10-04';

  it('samlar fel per fält', () => {
    expect(validateForm({ date: '2026-12-01', distance: '0.5', surface: 'outdoor' }, today)).toEqual({
      date: 'You cannot log a run for a future date',
      distance: 'A run needs at least 1.0 km to count',
    });
    expect(validateForm({ date: today, distance: '', surface: 'outdoor' }, today, { allowEmptyDistance: true })).toEqual({});
  });

  it('en giltig inlämning bär alltid en bool för is_treadmill', () => {
    expect(buildSubmission({ date: today, distance: '8,4', surface: 'outdoor' }, today)).toEqual({
      ok: true, submission: { date: today, distance: 8.4, isTreadmill: false },
    });
    expect(buildSubmission({ date: today, distance: '5', surface: 'treadmill' }, today)).toEqual({
      ok: true, submission: { date: today, distance: 5, isTreadmill: true },
    });
  });

  it('en ogiltig inlämning skickar felen, inte en submission', () => {
    const result = buildSubmission({ date: today, distance: '', surface: 'outdoor' }, today);
    expect(result).toEqual({ ok: false, errors: { distance: 'Enter a distance in km' } });
  });
});

describe('streakOutlook', () => {
  const run = (date: string, streak_day: number) => ({ date, streak_day });

  it('ingen tidigare runda → ny streak, dag 1', () => {
    expect(streakOutlook([], '2026-10-04')).toEqual({ day: 1, kind: 'start' });
  });

  it('dagen efter min senaste runda förlänger streaken', () => {
    expect(streakOutlook([run('2026-10-02', 4), run('2026-10-03', 5)], '2026-10-04')).toEqual({ day: 6, kind: 'continue' });
  });

  it('en lucka på två dagar eller mer börjar om', () => {
    expect(streakOutlook([run('2026-10-02', 7)], '2026-10-04')).toEqual({ day: 1, kind: 'start' });
  });

  it('en runda samma dag räknas redan — samma streakdag, ingen förlängning', () => {
    expect(streakOutlook([run('2026-10-03', 5), run('2026-10-04', 6)], '2026-10-04')).toEqual({ day: 6, kind: 'counted' });
  });

  it('bara rundor före datumet avgör (en bakdaterad runda)', () => {
    expect(streakOutlook([run('2026-10-01', 2), run('2026-10-05', 9)], '2026-10-02')).toEqual({ day: 3, kind: 'continue' });
  });

  it('klarar datum med klockslag och oordnade rundor', () => {
    expect(streakOutlook([run('2026-10-03T00:00:00.000Z', 5), run('2026-09-20', 1)], '2026-10-04')).toEqual({ day: 6, kind: 'continue' });
  });
});

describe('confirmationText', () => {
  it('visar serverns siffror, och streak bara när den är över en dag', () => {
    expect(confirmationText({ distance: 8, xp_gained: 44, multiplier: 1.4, streak_day: 5 })).toBe('Run logged: 8.0 km for 44 XP · streak day 5 at 1.4×');
    expect(confirmationText({ distance: 3, xp_gained: 21, multiplier: 1, streak_day: 1 })).toBe('Run logged: 3.0 km for 21 XP');
  });
});
