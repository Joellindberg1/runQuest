import { describe, it, expect, afterEach } from 'vitest';
import {
  MS_DAY, MS_HOUR, MS_MINUTE, addDays, dayOfWeek, daysBetween, groupNextMidnight, mondayOf, stockholmClock, stockholmDay, stockholmMidnightIso, stockholmWallClockToInstant,
  wallClockMinutes, wallClockMsAt, wallClockToInstantMs, zoneOffsetMs,
} from '../calendar.js';

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

describe('MS_DAY', () => {
  it('är ett dygn i millisekunder', () => {
    expect(MS_DAY).toBe(24 * 60 * 60 * 1000);
  });
});

describe('MS_MINUTE och MS_HOUR', () => {
  it('är en minut och en timme i millisekunder, och ett dygn är 24 timmar', () => {
    expect(MS_MINUTE).toBe(60_000);
    expect(MS_HOUR).toBe(60 * MS_MINUTE);
    expect(MS_DAY).toBe(24 * MS_HOUR);
  });
});

describe('dayOfWeek — 0 = söndag', () => {
  it.each([
    ['2026-10-04', 0], ['2026-10-05', 1], ['2026-10-06', 2], ['2026-10-07', 3], ['2026-10-08', 4], ['2026-10-09', 5], ['2026-10-10', 6],
    ['2026-03-29', 0], ['2026-10-25', 0], ['2024-02-29', 4], ['2027-01-01', 5], ['1999-12-31', 5], ['2000-01-01', 6],
  ])('%s -> %i', (day, expected) => {
    expect(dayOfWeek(day)).toBe(expected);
  });

  it('NaN för ogiltigt datum', () => {
    expect(dayOfWeek('inte-ett-datum')).toBeNaN();
  });
});

describe('mondayOf / addDays / daysBetween hänger ihop över hela kalendern', () => {
  it('varje dag 2024–2029: måndagen är en måndag 0–6 dagar före, och daysBetween är motsatsen till addDays', () => {
    let day = '2024-01-01';
    while (day < '2030-01-01') {
      const monday = mondayOf(day);
      expect(dayOfWeek(monday)).toBe(1);
      const back = daysBetween(monday, day);
      expect(back).toBeGreaterThanOrEqual(0);
      expect(back).toBeLessThanOrEqual(6);
      expect(addDays(monday, back)).toBe(day);
      expect(daysBetween(day, addDays(day, 37))).toBe(37);
      day = addDays(day, 1);
    }
  });
});

describe('stockholmClock', () => {
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

  it('datumet är detsamma som stockholmDay', () => {
    for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += 37 * 60_000) {
      expect(stockholmClock(new Date(t)).date).toBe(stockholmDay(new Date(t)));
    }
  });
});

describe('zoneOffsetMs / wallClockMsAt', () => {
  it('Stockholm är standard: +1 h vinter, +2 h sommar', () => {
    expect(zoneOffsetMs(Date.UTC(2026, 0, 10, 12))).toBe(3_600_000);
    expect(zoneOffsetMs(Date.UTC(2026, 6, 10, 12))).toBe(7_200_000);
  });

  it('en annan tidszon kan anges (New York sommar -4 h, Tokyo +9 h)', () => {
    expect(zoneOffsetMs(Date.UTC(2026, 6, 10, 12), 'America/New_York')).toBe(-4 * 3_600_000);
    expect(zoneOffsetMs(Date.UTC(2026, 6, 10, 12), 'Asia/Tokyo')).toBe(9 * 3_600_000);
  });

  it('wallClockMsAt är väggklockan som om den vore UTC', () => {
    expect(wallClockMsAt(Date.UTC(2026, 6, 4, 4, 0, 0))).toBe(Date.UTC(2026, 6, 4, 6, 0, 0));
  });

  it('kastar RangeError för ogiltigt ögonblick', () => {
    expect(() => wallClockMsAt(NaN)).toThrow(RangeError);
  });
});

describe('stockholmWallClockToInstant — klockslag på en Stockholm-dag', () => {
  it.each([
    ['2026-01-15', 5, 0, '2026-01-15T04:00:00.000Z'], // vinter
    ['2026-07-01', 5, 0, '2026-07-01T03:00:00.000Z'], // sommar
    ['2026-07-04', 23, 59, '2026-07-04T21:59:00.000Z'],
    ['2026-03-29', 0, 0, '2026-03-28T23:00:00.000Z'], // vårens skiftesdag: 00:00 ligger FÖRE växlingen (+1)
    ['2026-03-29', 1, 0, '2026-03-29T00:00:00.000Z'],
    ['2026-03-29', 3, 0, '2026-03-29T01:00:00.000Z'], // 03:00 ligger efter (+2)
    ['2026-03-29', 5, 0, '2026-03-29T03:00:00.000Z'],
    ['2026-03-29', 23, 59, '2026-03-29T21:59:00.000Z'],
    ['2026-10-25', 0, 0, '2026-10-24T22:00:00.000Z'], // höstens skiftesdag: 00:00 ligger FÖRE växlingen (+2)
    ['2026-10-25', 1, 0, '2026-10-24T23:00:00.000Z'],
    ['2026-10-25', 2, 30, '2026-10-25T00:30:00.000Z'], // dubbeltydigt -> första förekomsten (sommartid)
    ['2026-10-25', 3, 0, '2026-10-25T02:00:00.000Z'], // 03:00 ligger efter (+1)
    ['2026-10-25', 23, 59, '2026-10-25T22:59:00.000Z'],
    ['2026-12-31', 23, 59, '2026-12-31T22:59:00.000Z'], // årsskifte
  ])('%s %i:%i -> %s', (day, hour, minute, expected) => {
    expect(stockholmWallClockToInstant(day, hour, minute).toISOString()).toBe(expected);
  });

  it('minut utelämnad = 00', () => {
    expect(stockholmWallClockToInstant('2026-07-01', 5).toISOString()).toBe('2026-07-01T03:00:00.000Z');
  });

  it('ogiltig dag eller ogiltigt klockslag kastar RangeError', () => {
    expect(() => stockholmWallClockToInstant('inte-ett-datum', 5)).toThrow(RangeError);
    expect(() => stockholmWallClockToInstant('2026-02-30', 5)).toThrow(RangeError);
    expect(() => stockholmWallClockToInstant('2026-07-01', 24)).toThrow(RangeError);
    expect(() => stockholmWallClockToInstant('2026-07-01', 5, 60)).toThrow(RangeError);
  });

  it('är oberoende av processens tidszon', () => {
    const original = process.env.TZ;
    try {
      for (const tz of ['America/Los_Angeles', 'Europe/Stockholm', 'Asia/Tokyo', 'UTC']) {
        process.env.TZ = tz;
        expect(stockholmWallClockToInstant('2026-03-29', 0).toISOString()).toBe('2026-03-28T23:00:00.000Z');
        expect(stockholmWallClockToInstant('2026-07-01', 3).toISOString()).toBe('2026-07-01T01:00:00.000Z');
        expect(stockholmDay(new Date('2026-10-04T22:30:00Z'))).toBe('2026-10-05');
        expect(stockholmClock(new Date('2026-10-04T22:30:00Z'))).toEqual({ date: '2026-10-05', msIntoDay: 1_800_000 });
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});

describe('stockholmMidnightIso', () => {
  it('är stockholmWallClockToInstant(dag, 0) som ISO', () => {
    for (const day of ['2026-01-15', '2026-03-29', '2026-07-01', '2026-10-25', '2027-01-01']) {
      expect(stockholmMidnightIso(day)).toBe(stockholmWallClockToInstant(day, 0).toISOString());
    }
  });
});

describe('groupNextMidnight — gruppens nästa midnatt (en duell startar aldrig i samma ögonblick som den accepteras)', () => {
  const at = (iso: string) => groupNextMidnight(new Date(iso));
  const instantOf = (iso: string) => at(iso).instant.toISOString();

  it('23:59 Stockholm: startdagen är nästa dag och fönstret börjar 00:00 Stockholm, en minut senare', () => {
    const next = at('2026-07-04T21:59:00Z'); // 23:59 sommartid
    expect(next.day).toBe('2026-07-05');
    expect(next.instant.toISOString()).toBe('2026-07-04T22:00:00.000Z');
  });

  it('00:01 Stockholm: startar vid nästa midnatt, inte samma dag', () => {
    const next = at('2026-07-03T22:01:00Z'); // 2026-07-04 00:01 sommartid
    expect(next.day).toBe('2026-07-05');
    expect(next.instant.toISOString()).toBe('2026-07-04T22:00:00.000Z');
  });

  it('exakt 00:00:00 räknas som redan passerad midnatt: nästa midnatt är dagen efter', () => {
    const next = at('2026-07-03T22:00:00Z');
    expect(next.day).toBe('2026-07-05');
    expect(next.instant.toISOString()).toBe('2026-07-04T22:00:00.000Z');
  });

  it('vintertid: 23:59 Stockholm (22:59 UTC) ger midnatt 23:00 UTC', () => {
    expect(at('2026-01-10T22:59:00Z').day).toBe('2026-01-11');
    expect(instantOf('2026-01-10T22:59:00Z')).toBe('2026-01-10T23:00:00.000Z');
  });

  it('sommartidsbyten flyttar midnatten rätt: dygnet är 23 respektive 25 timmar långt', () => {
    expect(instantOf('2026-03-28T22:30:00Z')).toBe('2026-03-28T23:00:00.000Z'); // 23:30 vintertid, midnatten är ännu vintertid
    expect(instantOf('2026-03-28T23:30:00Z')).toBe('2026-03-29T22:00:00.000Z'); // 00:30 på omställningsdygnet; nästa midnatt är sommartid
    expect(instantOf('2026-10-24T21:30:00Z')).toBe('2026-10-24T22:00:00.000Z'); // 23:30 sommartid
    expect(instantOf('2026-10-24T22:30:00Z')).toBe('2026-10-25T23:00:00.000Z'); // 00:30 på det 25 timmar långa dygnet; nästa midnatt är vintertid
    expect(at('2026-10-24T22:30:00Z').day).toBe('2026-10-26');
  });

  it('årsskifte: 23:59 på nyårsafton startar 1 januari', () => {
    expect(at('2026-12-31T22:59:00Z').day).toBe('2027-01-01');
  });

  it('en annan tidszon räknar dagen och midnatten i den zonen, inte i Stockholm', () => {
    // 2026-07-04 23:30 i New York (EDT, UTC-4) = 2026-07-05 03:30 UTC. I Stockholm är det redan 05:30 den 5:e.
    const next = groupNextMidnight(new Date('2026-07-05T03:30:00Z'), 'America/New_York');
    expect(next.day).toBe('2026-07-05');
    expect(next.instant.toISOString()).toBe('2026-07-05T04:00:00.000Z');
  });

  describe('oberoende av processens tidszon', () => {
    const original = process.env.TZ;
    afterEach(() => {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    });

    for (const tz of ['America/New_York', 'Asia/Tokyo', 'Europe/Stockholm']) {
      it(`TZ=${tz}`, () => {
        process.env.TZ = tz;
        const next = at('2026-07-04T21:59:00Z');
        expect(next.day).toBe('2026-07-05');
        expect(next.instant.toISOString()).toBe('2026-07-04T22:00:00.000Z');
      });
    }
  });
});

describe('wallClockMinutes — väggklockan läses rakt ur strängen', () => {
  it.each([
    ['2026-07-04T05:30:00Z', 330],
    ['2026-01-10T04:00:00+00:00', 240],
    ['2026-07-04T00:00:00Z', 0],
    ['2026-07-04T23:59:00Z', 1439],
    ['2026-07-04T21:30:00.000Z', 1290],
    ['2026-03-29T02:30:00Z', 150], // vårens "hoppade" timme: ingen konvertering
    ['2026-07-04T08:00:00+02:00', 480], // en angiven offset ändrar inte siffrorna
  ])('%s -> %i', (startTime, expected) => {
    expect(wallClockMinutes(startTime)).toBe(expected);
  });

  it.each([null, '', '2026-07-04', 'inte-ett-datum', '2026-07-04T24:00:00Z', '2026-07-04T10:60:00Z'])('%j -> null (ingen räkning)', (startTime) => {
    expect(wallClockMinutes(startTime)).toBeNull();
  });
});
