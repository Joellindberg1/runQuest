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

  it('alla sju km-mått får sträckenhet', () => {
    for (const key of ['longestRun', 'totalKm', 'weekendAvg', 'maxKmRolling30', 'bestDoubleDayKm', 'longestRunAfterBreak14', 'longestRunAfterBreak30']) {
      expect(titleValueText(key, 10)).toBe('10.0 km');
    }
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
