import { describe, expect, it } from 'vitest';
import {
  DOUBLE_RUN_MIN_GAP_MS,
  ENCODED_TITLE_METRICS,
  MARATHON_DISTANCE_KM,
  MARATHON_TITLE_MIN_KM,
  NO_TIME_VALUE,
  decodeTitleMetric,
  encodeTitleMetric,
  hasDoubleRunGap,
  noValueFor,
  weekendAverageKm,
} from '../titleMetrics.js';

// Facit i de här testerna är räknat med formlerna som låg inbäddade i motorerna och titleFormat före samlingen
// (60 - s/60, 360 - s/60, 720 - s/60, 10000 / x, väggklockan som sekunder), inte med den nya koden.

describe('decode(encode(x)) === x för varje kodat mått', () => {
  // Tiderna som respektive mått kan ge: under taket plus "ingen tid"-gränsen (-100) avkodas tillbaka.
  const moveTimes = {
    fastest5km: [1, 59, 60, 1500, 1650, 1680, 2400, 3300, 6900, 9600],
    fastestHalfMarathon: [1, 59, 60, 4500, 6900, 14400, 21600, 27600],
    fastestMarathon: [1, 59, 60, 10800, 14400, 15000, 43200, 49200],
  } as const;

  it.each(['fastest5km', 'fastestHalfMarathon', 'fastestMarathon'] as const)('%s: rörelsetid i sekunder', (key) => {
    for (const seconds of moveTimes[key]) expect(decodeTitleMetric(key, encodeTitleMetric(key, seconds))).toBe(seconds);
  });

  it('avgPaceStdDev: spridning i sekunder per km', () => {
    for (const stdDev of [0.5, 8, 12.5, 16, 22.5, 50, 100, 250]) {
      expect(decodeTitleMetric('avgPaceStdDev', encodeTitleMetric('avgPaceStdDev', stdDev))).toBe(stdDev);
    }
  });

  it('pace-spridning: tur och retur ligger inom flyttalsfel för alla ett-decimalsvärden 0,1–300', () => {
    for (let tenths = 1; tenths <= 3000; tenths++) {
      const stdDev = tenths / 10;
      expect(decodeTitleMetric('avgPaceStdDev', encodeTitleMetric('avgPaceStdDev', stdDev))).toBeCloseTo(stdDev, 9);
    }
  });

  it('lastRunOfWeek: väggklockan som epok-ms (heltalssekunder)', () => {
    for (const wallClockMs of [Date.UTC(2026, 0, 4, 0, 0, 0), Date.UTC(2026, 7, 16, 23, 0, 0), Date.UTC(2026, 9, 4, 23, 59, 59)]) {
      expect(decodeTitleMetric('lastRunOfWeek', encodeTitleMetric('lastRunOfWeek', wallClockMs))).toBe(wallClockMs);
    }
  });

  it('täcker exakt de kodade måtten', () => {
    expect([...ENCODED_TITLE_METRICS].sort()).toEqual([
      'avgPaceStdDev', 'fastest5km', 'fastestHalfMarathon', 'fastestMarathon', 'lastRunOfWeek',
    ]);
  });
});

describe('värdena är bitidentiska med de gamla inbäddade formlerna', () => {
  it('tidsmåtten: referens minus minuter (60 / 360 / 720)', () => {
    expect(encodeTitleMetric('fastest5km', 1500)).toBe(35);
    expect(encodeTitleMetric('fastest5km', 1)).toBe(59.983333333333334);
    expect(encodeTitleMetric('fastest5km', 6900)).toBe(-55);
    expect(encodeTitleMetric('fastestHalfMarathon', 6900)).toBe(245);
    expect(encodeTitleMetric('fastestHalfMarathon', 59)).toBe(359.01666666666665);
    expect(encodeTitleMetric('fastestMarathon', 14400)).toBe(480);
    expect(encodeTitleMetric('fastestMarathon', 1)).toBe(719.9833333333333);
    expect(encodeTitleMetric('fastestMarathon', 59)).toBe(719.0166666666667);
  });

  it('spridningsmåtten: 10000 delat med spridningen', () => {
    expect(encodeTitleMetric('avgPaceStdDev', 14.4)).toBe(10000 / 14.4);
    expect(encodeTitleMetric('avgPaceStdDev', 3.3)).toBe(3030.3030303030305);
    expect(encodeTitleMetric('avgPaceStdDev', 22.5)).toBe(444.44444444444446);
    expect(encodeTitleMetric('avgPaceStdDev', 25.3125)).toBe(10000 / 25.3125);
  });

  it('lastRunOfWeek: ögonblicket i sekunder', () => {
    expect(encodeTitleMetric('lastRunOfWeek', Date.UTC(2026, 7, 16, 23, 0, 0))).toBe(1786921200);
  });
});

describe('avkodning för visning', () => {
  it('tid: avrundade sekunder ur sorteringsvärdet', () => {
    expect(decodeTitleMetric('fastest5km', 40)).toBe(1200);
    expect(decodeTitleMetric('fastestHalfMarathon', 270)).toBe(5400);
    expect(decodeTitleMetric('fastestMarathon', 540)).toBe(10800);
  });

  it('"ingen tid" (värde under -100) och "ingen spridning" (0 eller lägre) avkodas till null', () => {
    expect(decodeTitleMetric('fastest5km', -999)).toBeNull();
    expect(decodeTitleMetric('fastestHalfMarathon', -9999)).toBeNull();
    expect(decodeTitleMetric('fastestMarathon', -100.5)).toBeNull();
    expect(decodeTitleMetric('avgPaceStdDev', 0)).toBeNull();
    expect(decodeTitleMetric('avgPaceStdDev', -3)).toBeNull();
  });

  it('en riktig men långsam tid (värde -100 eller högre) är fortfarande en tid', () => {
    expect(decodeTitleMetric('fastest5km', -100)).toBe(9600);
    expect(decodeTitleMetric('fastestMarathon', -55)).toBe(46500);
  });

  it('lastRunOfWeek avkodas alltid (värdet 0 är epoken, som förr)', () => {
    expect(decodeTitleMetric('lastRunOfWeek', 0)).toBe(0);
    expect(decodeTitleMetric('lastRunOfWeek', 1786921200)).toBe(Date.UTC(2026, 7, 16, 23, 0, 0));
  });
});

describe('"inget värde" per mått', () => {
  it('tiderna har sentinelvärdet -9999, spridning och lastRunOfWeek 0', () => {
    expect(NO_TIME_VALUE).toBe(-9999);
    expect(noValueFor('fastest5km')).toBe(-9999);
    expect(noValueFor('fastestHalfMarathon')).toBe(-9999);
    expect(noValueFor('fastestMarathon')).toBe(-9999);
    expect(noValueFor('avgPaceStdDev')).toBe(0);
    expect(noValueFor('lastRunOfWeek')).toBe(0);
  });

  it('sentinelvärdet avkodas som "ingen tid"', () => {
    expect(decodeTitleMetric('fastest5km', noValueFor('fastest5km'))).toBeNull();
    expect(decodeTitleMetric('avgPaceStdDev', noValueFor('avgPaceStdDev'))).toBeNull();
  });
});

describe('maratongränserna är två namngivna konstanter med oförändrade värden', () => {
  it('distansen för maraton-ekvivalenter är 42,195 och titelns undre gräns är 42,2', () => {
    expect(MARATHON_DISTANCE_KM).toBe(42.195);
    expect(MARATHON_TITLE_MIN_KM).toBe(42.2);
  });
});

describe('dubbelpassfönstret', () => {
  it('är fyra timmar', () => {
    expect(DOUBLE_RUN_MIN_GAP_MS).toBe(14_400_000);
  });

  const at = (hour: number, minute = 0) => Date.UTC(2026, 7, 15, hour, minute);

  it('minst fyra timmar mellan första och sista start räknas, tre timmar och 59 minuter inte', () => {
    expect(hasDoubleRunGap([at(6), at(10)])).toBe(true);
    expect(hasDoubleRunGap([at(6), at(9, 59)])).toBe(false);
  });

  it('en enda start eller inga starter är aldrig ett dubbelpass', () => {
    expect(hasDoubleRunGap([at(6)])).toBe(false);
    expect(hasDoubleRunGap([])).toBe(false);
  });

  it('ordningen spelar ingen roll och ogiltiga starter hoppas över', () => {
    expect(hasDoubleRunGap([at(18), at(6), at(12)])).toBe(true);
    expect(hasDoubleRunGap([at(6), Number.NaN, at(7)])).toBe(false);
    expect(hasDoubleRunGap([at(6), Number.NaN, at(10)])).toBe(true);
  });

  it('samma svar som en jämförelse av alla par på slumpade dagar', () => {
    let seed = 12345;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let round = 0; round < 300; round++) {
      const starts = Array.from({ length: 1 + Math.floor(next() * 4) }, () => at(Math.floor(next() * 24), Math.floor(next() * 60)));
      const sorted = [...starts].sort((a, b) => a - b);
      let anyPair = false;
      for (let i = 0; i < sorted.length - 1; i++) for (let j = i + 1; j < sorted.length; j++) if (sorted[j] - sorted[i] >= 14_400_000) anyPair = true;
      expect(hasDoubleRunGap(starts)).toBe(anyPair);
    }
  });
});

describe('helgsnittet', () => {
  it('lördag och söndag i samma vecka är en helg: snittet av helgernas km', () => {
    // 2026-10-03 lör + 2026-10-04 sön (vecka mån 09-28), 2026-10-10 lör (vecka mån 10-05)
    const average = weekendAverageKm([
      { day: '2026-10-03', km: 10 },
      { day: '2026-10-04', km: 5 },
      { day: '2026-10-10', km: 11 },
    ]);
    expect(average).toBe((15 + 11) / 2);
  });

  it('vardagar räknas inte och utan helgrundor är snittet 0', () => {
    expect(weekendAverageKm([{ day: '2026-10-07', km: 20 }])).toBe(0);
    expect(weekendAverageKm([])).toBe(0);
  });

  it('en söndag hör till helgen som slutar, inte till nästa veckas', () => {
    expect(weekendAverageKm([{ day: '2026-10-04', km: 8 }, { day: '2026-10-10', km: 4 }])).toBe(6);
  });

  it('summerar i samma ordning som förr (flyttalet är bitidentiskt)', () => {
    const runs = [
      { day: '2026-01-10', km: 12.3 },
      { day: '2026-01-11', km: 8 },
      { day: '2026-01-11', km: 4 },
      { day: '2026-02-21', km: 21.3 },
      { day: '2026-02-22', km: 6.1 },
      { day: '2026-04-04', km: 42.5 },
      { day: '2026-04-05', km: 3.5 },
      { day: '2026-05-02', km: 11 },
      { day: '2026-05-03', km: 5 },
      { day: '2026-07-12', km: 14.2 },
      { day: '2026-08-15', km: 9 },
      { day: '2026-08-15', km: 8.5 },
      { day: '2026-08-16', km: 4 },
    ];
    expect(weekendAverageKm(runs)).toBe(24.900000000000002);
  });
});
