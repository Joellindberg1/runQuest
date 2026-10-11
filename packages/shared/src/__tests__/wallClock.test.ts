import { describe, it, expect, afterEach } from 'vitest';
import { wallClockToInstantMs } from '../wallClock.js';

const utc = (y: number, m: number, d: number, h = 0, min = 0, s = 0) => Date.UTC(y, m - 1, d, h, min, s);

describe('wallClockToInstantMs — start_time är lokal väggklocka med falskt Z', () => {
  it('sommar: 06:00 väggklocka i Stockholm är 04:00 UTC', () => {
    expect(wallClockToInstantMs('2026-07-04T06:00:00Z')).toBe(utc(2026, 7, 4, 4));
  });

  it('vinter: 06:00 väggklocka i Stockholm är 05:00 UTC', () => {
    expect(wallClockToInstantMs('2026-01-10T06:00:00Z')).toBe(utc(2026, 1, 10, 5));
  });

  it('samma resultat för +00:00-formen som Supabase returnerar', () => {
    expect(wallClockToInstantMs('2026-07-04T06:00:00+00:00')).toBe(utc(2026, 7, 4, 4));
    expect(wallClockToInstantMs('2026-01-10T06:00:00+00:00')).toBe(utc(2026, 1, 10, 5));
  });

  it('bevarar millisekunder', () => {
    expect(wallClockToInstantMs('2026-07-04T06:00:00.250Z')).toBe(utc(2026, 7, 4, 4) + 250);
  });

  it('en annan tidszon kan anges (New York, sommar: UTC-4)', () => {
    expect(wallClockToInstantMs('2026-07-04T06:00:00Z', 'America/New_York')).toBe(utc(2026, 7, 4, 10));
  });

  it('ogiltigt värde ger NaN', () => {
    expect(wallClockToInstantMs('inte-ett-datum')).toBeNaN();
    expect(wallClockToInstantMs('')).toBeNaN();
    expect(wallClockToInstantMs('2026-13-45T25:00:00Z')).toBeNaN();
  });

  it('ett verkligt UTC-offset utöver noll är inte väggklocka och ger NaN', () => {
    expect(wallClockToInstantMs('2026-07-04T06:00:00+02:00')).toBeNaN();
  });
});

describe('wallClockToInstantMs — sommartidsgränser (Europe/Stockholm)', () => {
  it('våren 2026-03-29: 01:59 är fortfarande vintertid, 03:00 är redan sommartid', () => {
    expect(wallClockToInstantMs('2026-03-29T01:59:00Z')).toBe(utc(2026, 3, 29, 0, 59));
    expect(wallClockToInstantMs('2026-03-29T03:00:00Z')).toBe(utc(2026, 3, 29, 1, 0));
  });

  it('våren: klockslag som inte finns (02:30) tolkas med vintertidsoffset, som Date gör', () => {
    expect(wallClockToInstantMs('2026-03-29T02:30:00Z')).toBe(utc(2026, 3, 29, 1, 30));
  });

  it('hösten 2026-10-25: 02:30 är dubbeltydigt och ger första förekomsten (sommartid, 00:30 UTC)', () => {
    expect(wallClockToInstantMs('2026-10-25T02:30:00Z')).toBe(utc(2026, 10, 25, 0, 30));
  });

  it('hösten: 01:59 är sommartid och 03:00 är vintertid', () => {
    expect(wallClockToInstantMs('2026-10-25T01:59:00Z')).toBe(utc(2026, 10, 24, 23, 59));
    expect(wallClockToInstantMs('2026-10-25T03:00:00Z')).toBe(utc(2026, 10, 25, 2, 0));
  });
});

describe('wallClockToInstantMs — oberoende av processens tidszon', () => {
  const original = process.env.TZ;
  afterEach(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });

  const samples: Array<[string, number]> = [
    ['2026-07-04T06:00:00Z', utc(2026, 7, 4, 4)],
    ['2026-01-10T06:00:00+00:00', utc(2026, 1, 10, 5)],
    ['2026-03-29T01:59:00Z', utc(2026, 3, 29, 0, 59)],
    ['2026-03-29T03:00:00Z', utc(2026, 3, 29, 1, 0)],
    ['2026-10-25T02:30:00Z', utc(2026, 10, 25, 0, 30)],
  ];

  const winterOffsetMin: Record<string, number> = {
    'America/Los_Angeles': 480,
    'Europe/Stockholm': -60,
    'Asia/Tokyo': -540,
  };

  for (const tz of Object.keys(winterOffsetMin)) {
    it(`TZ=${tz}`, () => {
      process.env.TZ = tz;
      // Vaktar att TZ-bytet faktiskt slog igenom — annars bevisar testet ingenting.
      expect(new Date(Date.UTC(2026, 0, 10, 12)).getTimezoneOffset()).toBe(winterOffsetMin[tz]);
      for (const [input, want] of samples) {
        expect(wallClockToInstantMs(input)).toBe(want);
      }
    });
  }
});
