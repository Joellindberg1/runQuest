/**
 * RUN-100 T1 — winterWindow(now): vinterfönstret [start, end) som kalenderdagar (Stockholm-datum ur `now`).
 * Dec–feb är innevarande vinter; mars–nov ger senast avslutade vinter. end är exklusiv (1 mars).
 */
import { describe, it, expect } from 'vitest';
import { winterWindow } from '../_utils.js';
import { winterKmEngine } from '../winterKm.js';

const at = (iso: string) => winterWindow(new Date(iso));

describe('winterWindow (RUN-100 T1)', () => {
  it('mitt i januari → fönster från 1 dec föregående år', () => {
    expect(at('2027-01-15T12:00:00Z')).toEqual({ start: '2026-12-01', end: '2027-03-01' });
  });

  it('i december → innevarande vinter', () => {
    expect(at('2026-12-15T12:00:00Z')).toEqual({ start: '2026-12-01', end: '2027-03-01' });
  });

  it('i februari → vintern som började föregående dec', () => {
    expect(at('2027-02-10T12:00:00Z')).toEqual({ start: '2026-12-01', end: '2027-03-01' });
  });

  it('i juli → senast avslutade vinter', () => {
    expect(at('2026-07-15T12:00:00Z')).toEqual({ start: '2025-12-01', end: '2026-03-01' });
  });

  it('1 mars → senast avslutade vinter (vintern som just tog slut)', () => {
    expect(at('2027-03-01T12:00:00Z')).toEqual({ start: '2026-12-01', end: '2027-03-01' });
  });

  it('30 nov → förra vintern, 1 dec → nya vintern', () => {
    expect(at('2026-11-30T12:00:00Z')).toEqual({ start: '2025-12-01', end: '2026-03-01' });
    expect(at('2026-12-01T12:00:00Z')).toEqual({ start: '2026-12-01', end: '2027-03-01' });
  });

  it('datumet tas i Stockholm-tid: 23:30Z den 30 nov är redan 1 dec i Stockholm', () => {
    expect(at('2026-11-30T23:30:00Z')).toEqual({ start: '2026-12-01', end: '2027-03-01' });
    expect(at('2026-11-30T22:30:00Z')).toEqual({ start: '2025-12-01', end: '2026-03-01' });
  });

  it('29 feb skottår ingår i fönstret, 1 mars gör det inte', () => {
    const { start, end } = at('2028-01-10T12:00:00Z');
    expect({ start, end }).toEqual({ start: '2027-12-01', end: '2028-03-01' });
    expect('2028-02-29' >= start && '2028-02-29' < end).toBe(true);
    expect('2028-03-01' >= start && '2028-03-01' < end).toBe(false);
  });
});

// RUN-102 T3 — nyårsgränsen och månadsskiftet feb/mars. Stockholm är UTC+1 hela vintern, så lokal väggklocka 23:30 = 22:30Z.
describe('winterWindow vid nyår och februari/mars (RUN-102 T3)', () => {
  const WINTER_2026 = { start: '2026-12-01', end: '2027-03-01' };
  const inWindow = (date: string, w: { start: string; end: string }) => date >= w.start && date < w.end;
  const stats = { totalKm: 0, longestStreak: 0 };

  // Fönstret byter varken vid nyår eller vid 1 mars, så ett test kan inte skilja Stockholm-väggklocka från UTC där:
  // både 31 dec och 1 jan ger samma fönster. Tidszonsgränsen som faktiskt gör skillnad är 30 nov/1 dec
  // ('datumet tas i Stockholm-tid' ovan). Testerna här vaktar i stället att nyåret och feb/mars INTE byter vinter.
  it('31 dec 23:30 och 1 jan 00:30 lokal tid ger samma vinter (nyåret byter inte vinter)', () => {
    expect(at('2026-12-31T22:30:00Z')).toEqual(WINTER_2026); // 31 dec 23:30 Stockholm
    expect(at('2026-12-31T23:30:00Z')).toEqual(WINTER_2026); // 1 jan 00:30 Stockholm
  });

  it('sekunden före och efter lokal midnatt (31 dec → 1 jan) ger samma fönster', () => {
    expect(at('2026-12-31T22:59:59Z')).toEqual(WINTER_2026); // 31 dec 23:59:59
    expect(at('2026-12-31T23:00:00Z')).toEqual(WINTER_2026); // 1 jan 00:00:00
  });

  it('rundor daterade 31 dec och 1 jan räknas båda i samma vinter, oavsett om omräkningen sker före eller efter lokal midnatt', () => {
    const runs = [
      { date: '2026-12-31', distance_km: 5 },
      { date: '2027-01-01', distance_km: 7 },
      { date: '2026-11-30', distance_km: 100 }, // före vintern
    ];
    for (const now of ['2026-12-31T22:30:00Z', '2026-12-31T23:30:00Z']) {
      expect(winterKmEngine.calculate(runs, stats, { now: new Date(now) })).toBe(12);
    }
  });

  it('nyår i ett skottår: 31 dec 2028 / 1 jan 2029 ger vintern 2028–29 (slutar 1 mars 2029, inte 29 feb)', () => {
    const expected = { start: '2028-12-01', end: '2029-03-01' };
    expect(at('2028-12-31T22:30:00Z')).toEqual(expected);
    expect(at('2028-12-31T23:30:00Z')).toEqual(expected);
  });

  it('28 feb är sista dagen i ett vanligt år, 1 mars faller utanför', () => {
    expect(at('2027-02-10T12:00:00Z')).toEqual(WINTER_2026);
    expect(inWindow('2027-02-28', WINTER_2026)).toBe(true);
    expect(inWindow('2027-03-01', WINTER_2026)).toBe(false);
    const runs = [{ date: '2027-02-28', distance_km: 4 }, { date: '2027-03-01', distance_km: 9 }];
    expect(winterKmEngine.calculate(runs, stats, { now: new Date('2027-02-28T23:30:00Z') })).toBe(4);
  });

  it('1 mars 00:30 lokal tid (28 feb 23:30Z) pekar fortfarande på vintern som just slutade — samma fönster som kvällen före', () => {
    expect(at('2027-02-28T22:30:00Z')).toEqual(WINTER_2026); // 28 feb 23:30 Stockholm
    expect(at('2027-02-28T23:30:00Z')).toEqual(WINTER_2026); // 1 mars 00:30 Stockholm
  });

  it('skottår: 29 feb är sista dagen och räknas, 1 mars gör det inte — även när omräkningen sker efter lokal midnatt', () => {
    const leap = { start: '2027-12-01', end: '2028-03-01' };
    expect(at('2028-02-29T22:30:00Z')).toEqual(leap); // 29 feb 23:30 Stockholm
    expect(at('2028-02-29T23:30:00Z')).toEqual(leap); // 1 mars 00:30 Stockholm
    expect(inWindow('2028-02-29', leap)).toBe(true);
    expect(inWindow('2028-03-01', leap)).toBe(false);
    const runs = [{ date: '2028-02-29', distance_km: 6 }, { date: '2028-03-01', distance_km: 8 }];
    expect(winterKmEngine.calculate(runs, stats, { now: new Date('2028-02-29T23:30:00Z') })).toBe(6);
  });

  it('1 jan byter aldrig vinter: i varje år ligger den i fönstret som började föregående december', () => {
    for (const year of [2027, 2028, 2029]) {
      expect(at(`${year}-01-01T00:30:00Z`)).toEqual({ start: `${year - 1}-12-01`, end: `${year}-03-01` });
    }
  });
});
