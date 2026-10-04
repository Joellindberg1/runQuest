import { describe, it, expect } from 'vitest';
import { boostDeltasForRuns, type BoostSpec } from '../boostCalculation.js';

const days = (delta: number, startDate: string, endDate: string): BoostSpec => ({
  type: 'multiplier_days', delta, startDate, endDate,
});
const runsBoost = (delta: number, startDate: string, charges: number, usedBefore = 0): BoostSpec => ({
  type: 'multiplier_runs', delta, startDate, charges, usedBefore,
});

describe('boostDeltasForRuns', () => {
  it('returnerar nollor utan boosts', () => {
    expect(boostDeltasForRuns(['2026-01-01', '2026-01-02'], [])).toEqual([0, 0]);
  });

  describe('multiplier_days', () => {
    it('gäller inom fönstret, inklusive gränsdagarna (samma semantik som tidigare)', () => {
      const deltas = boostDeltasForRuns(
        ['2026-01-04', '2026-01-05', '2026-01-07', '2026-01-10', '2026-01-11'],
        [days(0.15, '2026-01-05', '2026-01-10')]
      );
      expect(deltas).toEqual([0, 0.15, 0.15, 0.15, 0]);
    });
  });

  describe('multiplier_runs', () => {
    it('gäller de N första rundorna från startdatumet, därefter inte', () => {
      const deltas = boostDeltasForRuns(
        ['2026-01-01', '2026-01-05', '2026-01-06', '2026-01-08', '2026-01-09'],
        [runsBoost(0.15, '2026-01-05', 3)]
      );
      // Rundan före startdatum påverkas inte; laddning 1–3 får delta, sedan slut.
      expect(deltas).toEqual([0, 0.15, 0.15, 0.15, 0]);
    });

    it('respekterar redan förbrukade laddningar (usedBefore)', () => {
      const deltas = boostDeltasForRuns(
        ['2026-01-08', '2026-01-09'],
        [runsBoost(0.15, '2026-01-05', 3, 2)]
      );
      expect(deltas).toEqual([0.15, 0]);
    });

    it('ger inget vid noll eller saknade laddningar', () => {
      expect(boostDeltasForRuns(['2026-01-05'], [runsBoost(0.15, '2026-01-01', 0)])).toEqual([0]);
      expect(
        boostDeltasForRuns(['2026-01-05'], [{ type: 'multiplier_runs', delta: 0.15, startDate: '2026-01-01' }])
      ).toEqual([0]);
    });

    it('hanterar negativ delta (förlorar-boost är ett handikapp)', () => {
      const deltas = boostDeltasForRuns(
        ['2026-01-05', '2026-01-06'],
        [runsBoost(-0.07, '2026-01-05', 1)]
      );
      expect(deltas).toEqual([-0.07, 0]);
    });
  });

  it('summerar flera samtidiga boosts av båda typerna', () => {
    const deltas = boostDeltasForRuns(
      ['2026-01-05', '2026-01-06', '2026-01-07'],
      [days(0.15, '2026-01-05', '2026-01-06'), runsBoost(-0.07, '2026-01-06', 2)]
    );
    expect(deltas[0]).toBeCloseTo(0.15);
    expect(deltas[1]).toBeCloseTo(0.08);
    expect(deltas[2]).toBeCloseTo(-0.07);
  });
});
