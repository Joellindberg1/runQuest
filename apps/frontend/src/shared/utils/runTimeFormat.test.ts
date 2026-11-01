import { describe, expect, it } from 'vitest';
import { formatDuration, formatPace, spokenDuration, timePaceLabel } from './runTimeFormat';

describe('formatDuration', () => {
  it('ger m:ss under en timme och h:mm:ss från en timme', () => {
    expect(formatDuration(3130)).toBe('52:10');
    expect(formatDuration(3600)).toBe('1:00:00');
    expect(formatDuration(4180)).toBe('1:09:40');
    expect(formatDuration(59)).toBe('0:59');
  });

  it('timmarna är obegränsade', () => {
    expect(formatDuration(400000)).toBe('111:06:40');
  });

  it('avrundar före uppdelningen: 3599.6 s blir 1:00:00, aldrig 59:60', () => {
    expect(formatDuration(3599.6)).toBe('1:00:00');
    expect(formatDuration(59.6)).toBe('1:00');
  });
});

describe('formatPace', () => {
  it('ger m:ss per kilometer', () => {
    expect(formatPace(313)).toBe('5:13');
    expect(formatPace(300)).toBe('5:00');
  });

  it('avrundar före uppdelningen: 359.6 blir 6:00, aldrig 5:60', () => {
    expect(formatPace(359.6)).toBe('6:00');
  });
});

describe('spokenDuration', () => {
  it('under en timme är det samma m:ss som visningen', () => {
    expect(spokenDuration(3130)).toBe('52:10');
    expect(spokenDuration(59)).toBe('0:59');
  });

  it('från exakt en timme skrivs det med ord, och enheter som är noll utelämnas', () => {
    expect(spokenDuration(3600)).toBe('1 hour');
    expect(spokenDuration(7200)).toBe('2 hours');
    expect(spokenDuration(3605)).toBe('1 hour 5 seconds');
    expect(spokenDuration(3660)).toBe('1 hour 1 minute');
  });

  it('över en timme läses minuter och sekunder med ord, inte som ett klockslag', () => {
    expect(spokenDuration(4180)).toBe('1 hour 9 minutes 40 seconds');
    expect(spokenDuration(400000)).toBe('111 hours 6 minutes 40 seconds');
  });

  it('avrundar före uppdelningen: 3599.6 s blir "1 hour", aldrig "59 minutes 60 seconds"', () => {
    expect(spokenDuration(3599.6)).toBe('1 hour');
  });
});

describe('timePaceLabel', () => {
  it('ger skärmläsartexten med tid och tempo under en timme', () => {
    expect(timePaceLabel(3130, 313)).toBe('Time 52:10, pace 5:13 per kilometre');
    expect(timePaceLabel(3599, 300)).toBe('Time 59:59, pace 5:00 per kilometre');
  });

  it('en timme exakt läses med ord', () => {
    expect(timePaceLabel(3600, 300)).toBe('Time 1 hour, pace 5:00 per kilometre');
  });

  it('över en timme läses tiden med ord och tempot som förut', () => {
    expect(timePaceLabel(4180, 345)).toBe('Time 1 hour 9 minutes 40 seconds, pace 5:45 per kilometre');
  });

  it('använder samma avrundning som visningen', () => {
    expect(timePaceLabel(3600, 359.6)).toBe('Time 1 hour, pace 6:00 per kilometre');
    expect(timePaceLabel(3130.4, 312.6)).toBe('Time 52:10, pace 5:13 per kilometre');
  });
});
