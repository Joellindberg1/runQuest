import { describe, it, expect } from 'vitest';
import { stravaLookback } from '../stravaLookback.js';

const iso = (seconds: number) => new Date(seconds * 1000).toISOString();
const NOW = new Date('2026-10-13T12:00:00Z');

describe('stravaLookback — från senaste importerade rundan', () => {
  it('sju kalenderdagar före senaste rundan, Stockholm-midnatt (sommartid)', () => {
    const result = stravaLookback(['2026-07-01', '2026-07-15', '2026-07-10'], '2026-01-01', NOW);
    expect(result).toMatchObject({ method: 'recent-run', mostRecentRunDay: '2026-07-15', anchorDay: '2026-07-08' });
    expect(iso(result.after)).toBe('2026-07-07T22:00:00.000Z');
  });

  it('vintertid ger midnatt = 23:00 UTC dagen före', () => {
    const result = stravaLookback(['2026-12-15'], null, NOW);
    expect(result.anchorDay).toBe('2026-12-08');
    expect(iso(result.after)).toBe('2026-12-07T23:00:00.000Z');
  });

  it('sommartidsbytet mellan rundan och fönstret flyttar inte kalenderdagen', () => {
    // 2026-10-25 är dagen sommartiden tar slut (03:00 -> 02:00); midnatt den dagen är fortfarande +02:00.
    const result = stravaLookback(['2026-11-01'], null, NOW);
    expect(result.anchorDay).toBe('2026-10-25');
    expect(iso(result.after)).toBe('2026-10-24T22:00:00.000Z');
  });

  it('månads- och årsskifte räknas som kalender', () => {
    expect(stravaLookback(['2027-01-03'], null, NOW).anchorDay).toBe('2026-12-27');
  });

  it('ogiltiga datum ignoreras och räknas inte som senaste runda', () => {
    expect(stravaLookback(['not-a-date', '2026-07-15'], null, NOW).mostRecentRunDay).toBe('2026-07-15');
  });
});

describe('stravaLookback — utan rundor', () => {
  it('anslutningsdagen i Stockholm: 23:30 UTC den 31 okt är redan 1 nov', () => {
    const result = stravaLookback([], '2026-10-31T23:30:00Z', NOW);
    expect(result).toMatchObject({ method: 'connection-date', anchorDay: '2026-11-01' });
    expect(iso(result.after)).toBe('2026-10-31T23:00:00.000Z');
  });

  it('ett rent anslutningsdatum tolkas som den dagen', () => {
    expect(stravaLookback([], '2026-09-01', NOW).anchorDay).toBe('2026-09-01');
  });

  it('30 dagar bakåt från Stockholm-dagen, inte UTC-dagen', () => {
    // 2026-10-31 23:30 UTC = 2026-11-01 00:30 Stockholm -> 30 dagar före 1 nov är 2 okt.
    const result = stravaLookback([], null, new Date('2026-10-31T23:30:00Z'));
    expect(result).toMatchObject({ method: 'fallback-30-days', anchorDay: '2026-10-02' });
    expect(iso(result.after)).toBe('2026-10-01T22:00:00.000Z');
  });

  it('ett oläsbart anslutningsdatum faller igenom till 30-dagarsfönstret', () => {
    expect(stravaLookback([], 'garbage', NOW).method).toBe('fallback-30-days');
  });
});
