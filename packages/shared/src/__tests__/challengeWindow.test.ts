import { describe, expect, it } from 'vitest';
import { daysBetween } from '../calendar.js';
import { challengeWindow } from '../challengeWindow.js';

describe('challengeWindow — en duell på N dagar räknar exakt N kalenderdagar', () => {
  it('N=1: startdagen är också slutdagen, avgörande 03:00 Stockholm dagen efter', () => {
    const w = challengeWindow('2026-07-06', 1);
    expect(w.endDate).toBe('2026-07-06');
    expect(w.determineAt.toISOString()).toBe('2026-07-07T01:00:00.000Z'); // 03:00 sommartid
  });

  it('N=5 från en måndag slutar på fredagen (fredag 24:00), avgörande lördag 03:00', () => {
    const w = challengeWindow('2026-07-06', 5); // måndag
    expect(w.endDate).toBe('2026-07-10'); // fredag
    expect(w.determineAt.toISOString()).toBe('2026-07-11T01:00:00.000Z');
  });

  it('N=7 slutar på söndagen', () => {
    const w = challengeWindow('2026-07-06', 7);
    expect(w.endDate).toBe('2026-07-12');
    expect(w.determineAt.toISOString()).toBe('2026-07-13T01:00:00.000Z');
  });

  it('vintertid: avgörandet 03:00 är 02:00 UTC', () => {
    const w = challengeWindow('2026-01-05', 3);
    expect(w.endDate).toBe('2026-01-07');
    expect(w.determineAt.toISOString()).toBe('2026-01-08T02:00:00.000Z');
  });

  it('vårens sommartidsbyte (29 mars) inne i duellen: slutdatumet är kalenderdagar, avgörandet 03:00 sommartid', () => {
    const w = challengeWindow('2026-03-27', 3);
    expect(w.endDate).toBe('2026-03-29'); // det 23 timmar långa dygnet är sista dagen
    expect(w.determineAt.toISOString()).toBe('2026-03-30T01:00:00.000Z');
  });

  it('höstens sommartidsbyte (25 okt) inne i duellen: avgörandet 03:00 vintertid, inte 24 h efter sommartid', () => {
    const w = challengeWindow('2026-10-24', 2);
    expect(w.endDate).toBe('2026-10-25'); // det 25 timmar långa dygnet är sista dagen
    expect(w.determineAt.toISOString()).toBe('2026-10-26T02:00:00.000Z');
  });

  it('antalet kalenderdagar från start till och med slut är alltid N', () => {
    for (const start of ['2026-01-01', '2026-03-27', '2026-10-24', '2026-12-30']) {
      for (let n = 1; n <= 30; n++) {
        expect(daysBetween(start, challengeWindow(start, n).endDate) + 1).toBe(n);
      }
    }
  });

  it('ogiltig längd (0, negativ, bråk, NaN) ger RangeError i stället för en tyst fel dag', () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() => challengeWindow('2026-07-06', bad)).toThrow(RangeError);
    }
  });
});
