/**
 * RUN-100 T1 — winterWindow(now): vinterfönstret [start, end) som kalenderdagar (Stockholm-datum ur `now`).
 * Dec–feb är innevarande vinter; mars–nov ger senast avslutade vinter. end är exklusiv (1 mars).
 */
import { describe, it, expect } from 'vitest';
import { winterWindow } from '../_utils.js';

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
