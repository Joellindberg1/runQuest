import { describe, expect, it } from 'vitest';
import { formatTitleValue, hasLinearGap, resolveGenderedTitle, titleValueText, unlockText } from './titleFormat';

describe('titleValueText', () => {
  it('enhet per mått, mellanslag före km, och bara talet när måttet är okänt', () => {
    expect(titleValueText('earlyRunCount', 56)).toBe('56 runs');
    expect(titleValueText('longestStreak', 14)).toBe('14 days');
    expect(titleValueText('longestRun', 32.8)).toBe('32.8 km');
    expect(titleValueText('totalElevationGain', 180)).toBe('180m');
    expect(titleValueText(undefined, 7.4)).toBe('7');
  });

  it('ett mått utan känd enhet får inte en påhittad enhet', () => {
    expect(titleValueText('someFutureMetric', 3.25)).toBe('3.3');
    expect(formatTitleValue('someFutureMetric', 12)).toBe('12');
  });

  it('väder- och vintermått: antal rundor och km i samma form som övriga mått', () => {
    expect(formatTitleValue('stormRunCount', 3)).toBe('3 runs');
    expect(formatTitleValue('coldRunCount', 22)).toBe('22 runs');
    expect(formatTitleValue('winterKm', 304.6)).toBe('304.6km');
    expect(titleValueText('stormRunCount', 3)).toBe('3 runs');
    expect(titleValueText('winterKm', 304.6)).toBe('304.6 km');
    expect(unlockText('coldRunCount', 10)).toBe('10 runs');
    expect(unlockText('winterKm', 50)).toBe('50.0 km');
    expect(hasLinearGap('winterKm')).toBe(true);
    expect(hasLinearGap('stormRunCount')).toBe(true);
  });

  it('alla sju km-mått får sträckenhet', () => {
    for (const key of ['longestRun', 'totalKm', 'weekendAvg', 'maxKmRolling30', 'bestDoubleDayKm', 'longestRunAfterBreak14', 'longestRunAfterBreak30']) {
      expect(titleValueText(key, 10)).toBe('10.0 km');
    }
  });
});

describe('singular vid värdet 1', () => {
  it.each([
    ['nightRunCount', '1 run'],
    ['earlyRunCount', '1 run'],
    ['lunchRunCount', '1 run'],
    ['stormRunCount', '1 run'],
    ['coldRunCount', '1 run'],
    ['longestStreak', '1 day'],
    ['maxWeekdayStreak', '1 weekday'],
    ['maxRunsOneWeek', '1 run/wk'],
  ])('%s med värdet 1 blir "%s" i formatTitleValue, titleValueText och unlockText', (metricKey, expected) => {
    expect(formatTitleValue(metricKey, 1)).toBe(expected);
    expect(titleValueText(metricKey, 1)).toBe(expected);
    expect(unlockText(metricKey, 1)).toBe(expected);
  });

  it('övriga värden förblir i plural, och 0 och 2 påverkas inte', () => {
    expect(formatTitleValue('earlyRunCount', 0)).toBe('0 runs');
    expect(formatTitleValue('earlyRunCount', 2)).toBe('2 runs');
    expect(formatTitleValue('longestStreak', 2)).toBe('2 days');
    expect(formatTitleValue('maxWeekdayStreak', 2)).toBe('2 weekdays');
    expect(formatTitleValue('maxRunsOneWeek', 2)).toBe('2 runs/wk');
  });
});

describe('avrundning före singular/plural', () => {
  it.each([
    [0.4, '0 runs'],
    [0.5, '1 run'],
    [1.49, '1 run'],
    [1.5, '2 runs'],
  ])('värdet %f blir "%s"', (value, expected) => {
    expect(formatTitleValue('earlyRunCount', value)).toBe(expected);
  });
});

describe('formatTitleValue (värden är kodade för sortering)', () => {
  it('tider avkodas ur sorteringsvärdet', () => {
    expect(formatTitleValue('fastest5km', 40)).toBe('20:00');
    expect(formatTitleValue('fastestHalfMarathon', 270)).toBe('1h30m');
    expect(formatTitleValue('fastestMarathon', 540)).toBe('3h00m');
  });

  it('"ingen tid" (sentinel under -100) blir tankstreck', () => {
    expect(formatTitleValue('fastest5km', -999)).toBe('—');
    expect(formatTitleValue('fastestMarathon', -999)).toBe('—');
    expect(formatTitleValue('avgPaceStdDev', 0)).toBe('—');
  });

  it('pace-spridning avkodas till sekunder per km', () => {
    expect(formatTitleValue('lowestPaceStdDev', 2000)).toBe('5.0s/km std');
  });
});

describe('lastRunOfWeek', () => {
  it('datumet formateras på engelska (en-GB), inte svenska', () => {
    // 2026-10-04 12:00 UTC
    expect(formatTitleValue('lastRunOfWeek', Date.UTC(2026, 9, 4, 12) / 1000)).toBe('4 Oct');
  });

  // Värdet är väggklockan kodad som UTC-sekunder (se calendar.ts), så dagen läses i UTC — inte i webbläsarens zon.
  it('dagen läses i UTC: 23:30 väggklocka förblir samma dag oavsett processens tidszon', () => {
    expect(formatTitleValue('lastRunOfWeek', Date.UTC(2026, 9, 4, 23, 30) / 1000)).toBe('4 Oct');
    expect(formatTitleValue('lastRunOfWeek', Date.UTC(2026, 6, 5, 23, 0) / 1000)).toBe('5 Jul');
  });
});

describe('resolveGenderedTitle', () => {
  it('King/Queen följer innehavarens kön; okänt kön lämnar namnet orört', () => {
    expect(resolveGenderedTitle('XP King/Queen', 'female')).toBe('XP Queen');
    expect(resolveGenderedTitle('XP King/Queen', 'male')).toBe('XP King');
    expect(resolveGenderedTitle('XP King/Queen', null)).toBe('XP King/Queen');
    expect(resolveGenderedTitle('The Hamster', 'female')).toBe('The Hamster');
  });
});

describe('hasLinearGap', () => {
  it('antal och sträckor har en läsbar differens; tider, spridning och datum har det inte', () => {
    expect(hasLinearGap('earlyRunCount')).toBe(true);
    expect(hasLinearGap('longestRun')).toBe(true);
    expect(hasLinearGap('fastest5km')).toBe(false);
    expect(hasLinearGap('lastRunOfWeek')).toBe(false);
    expect(hasLinearGap(undefined)).toBe(false);
  });
});

describe('unlockText', () => {
  it('kravet i måttets enhet', () => {
    expect(unlockText('earlyRunCount', 7)).toBe('7 runs');
    expect(unlockText('weekendAvg', 30)).toBe('30.0 km');
  });

  it('inget krav eller ett datumkodat mått ger inget lås-krav att visa', () => {
    expect(unlockText('earlyRunCount', 0)).toBeNull();
    expect(unlockText('lastRunOfWeek', 1)).toBeNull();
  });
});

// Referensen är formlerna som låg inbäddade i formatTitleValue före samlingen i shared/titleMetrics. Värdena är numeric(15,4) i
// databasen, så svepet prövar både orunda värden och värden avrundade till fyra decimaler.
describe('visningen av kodade värden är oförändrad mot de gamla formlerna', () => {
  const clock = (value: number, reference: number) => {
    if (value < -100) return '—';
    const mins = Math.round(reference - value);
    return `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}m`;
  };
  const stored = (value: number) => Number(value.toFixed(4));

  it('maraton och halvmaraton: varje heltalssekund upp till referenstiden', () => {
    for (let seconds = 1; seconds <= 43200; seconds++) {
      for (const raw of [720 - seconds / 60, stored(720 - seconds / 60)]) {
        expect(formatTitleValue('fastestMarathon', raw)).toBe(clock(raw, 720));
      }
      for (const raw of [360 - seconds / 60, stored(360 - seconds / 60)]) {
        expect(formatTitleValue('fastestHalfMarathon', raw)).toBe(clock(raw, 360));
      }
    }
  });

  it('5 km: varje heltalssekund upp till referenstiden', () => {
    for (let seconds = 1; seconds <= 9600; seconds++) {
      for (const raw of [60 - seconds / 60, stored(60 - seconds / 60)]) {
        const total = Math.round((60 - raw) * 60);
        expect(formatTitleValue('fastest5km', raw)).toBe(`${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`);
      }
    }
  });

  it('spridning: varje tiondels sekund per km', () => {
    for (let tenths = 1; tenths <= 3000; tenths++) {
      for (const raw of [10000 / (tenths / 10), stored(10000 / (tenths / 10))]) {
        expect(formatTitleValue('lowestPaceStdDev', raw)).toBe(`${(10000 / raw).toFixed(1)}s/km std`);
        expect(formatTitleValue('avgPaceStdDev', raw)).toBe(`${(10000 / raw).toFixed(1)}s/km std`);
      }
    }
  });
});
