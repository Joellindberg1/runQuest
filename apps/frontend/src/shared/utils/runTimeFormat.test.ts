import { describe, expect, it } from 'vitest';
import { formatDuration, formatPace, timePaceLabel } from './runTimeFormat';

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

describe('timePaceLabel', () => {
  it('ger skärmläsartexten med tid och tempo', () => {
    expect(timePaceLabel(3130, 313)).toBe('Time 52:10, pace 5:13 per kilometre');
  });

  it('använder samma formatering och avrundning som visningen', () => {
    expect(timePaceLabel(3600, 359.6)).toBe('Time 1:00:00, pace 6:00 per kilometre');
  });
});
