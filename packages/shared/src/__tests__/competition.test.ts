import { describe, it, expect } from 'vitest';
import { prizeForRank, scoreCompetition, type CompetitionParticipant } from '../competition.js';

const person = (id: string, name: string, runs: CompetitionParticipant['runs'] = []): CompetitionParticipant => ({ id, name, runs });
const km = (...distances: Array<number | string | null>) => distances.map((distance) => ({ distance, total_elevation_gain: 999 }));
const climb = (...gains: Array<number | string | null>) => gains.map((gain) => ({ distance: 999, total_elevation_gain: gain }));
const ids = (scored: ReadonlyArray<{ participant: { id: string } }>): string[] => scored.map((s) => s.participant.id);

describe('scoreCompetition', () => {
  it('sums distance for a km competition and ranks by the total, highest first', () => {
    const scored = scoreCompetition('km', [
      person('a', 'Anna', km(5, 5)),
      person('b', 'Bertil', km(12)),
      person('c', 'Cecilia', km(3.5, 1.25)),
    ]);
    expect(scored.map((s) => [s.participant.id, s.totalValue, s.rank])).toEqual([['b', 12, 1], ['a', 10, 2], ['c', 4.75, 3]]);
  });

  it('sums elevation gain for any other metric and counts a missing gain as zero', () => {
    const scored = scoreCompetition('elevation', [
      person('a', 'Anna', climb(120, null)),
      person('b', 'Bertil', climb('80.5', 40)),
    ]);
    expect(scored.map((s) => [s.participant.id, s.totalValue])).toEqual([['b', 120.5], ['a', 120]]);
  });

  it('counts a null distance as zero in a km competition', () => {
    const scored = scoreCompetition('km', [person('a', 'Anna', km(null, 4))]);
    expect(scored[0].totalValue).toBe(4);
  });

  it('gives a participant without runs the total 0 and keeps them on the board', () => {
    const scored = scoreCompetition('km', [person('a', 'Anna'), person('b', 'Bertil', km(1))]);
    expect(scored.map((s) => [s.participant.id, s.totalValue, s.rank])).toEqual([['b', 1, 1], ['a', 0, 2]]);
  });

  it('returns an empty board for no participants', () => {
    expect(scoreCompetition('km', [])).toEqual([]);
  });

  it('keeps the participant object it was given, so the caller can carry its own fields', () => {
    const entry = { ...person('a', 'Anna', km(2)), entryId: 'entry-1' };
    expect(scoreCompetition('km', [entry])[0].participant).toBe(entry);
  });

  describe('equal totals', () => {
    it('breaks the tie on name (case-insensitive) and then on id, like the all-time table', () => {
      const scored = scoreCompetition('km', [
        person('z-1', 'bertil', km(10)),
        person('a-2', 'Anna', km(10)),
        person('b-3', 'Bertil', km(10)),
        person('a-1', 'Anna', km(10)),
        person('c-9', 'Cecilia', km(10.5)),
      ]);
      expect(ids(scored)).toEqual(['c-9', 'a-1', 'a-2', 'b-3', 'z-1']);
      expect(scored.map((s) => s.rank)).toEqual([1, 2, 3, 4, 5]);
    });

    it('gives the same ranking whichever order the participants arrive in (live and settlement read them differently)', () => {
      const field = [
        person('u1', 'Anna', km(10)),
        person('u2', 'Bertil', km(10)),
        person('u3', 'Cecilia', km(7, 3)),
        person('u4', 'David', km(2)),
        person('u5', 'Erik', km(2)),
        person('u6', 'Frida'),
        person('u7', 'Greta'),
      ];
      const orders = [
        field,
        [...field].reverse(),
        [field[3], field[0], field[6], field[2], field[5], field[1], field[4]],
        [field[4], field[3], field[2], field[1], field[0], field[6], field[5]],
      ];
      const expected = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7'];
      for (const order of orders) expect(ids(scoreCompetition('km', order))).toEqual(expected);
    });

    it('does not modify the list it was given', () => {
      const field = [person('b', 'Bertil', km(1)), person('a', 'Anna', km(2))];
      scoreCompetition('km', field);
      expect(field.map((p) => p.id)).toEqual(['b', 'a']);
    });
  });
});

describe('prizeForRank', () => {
  const prizes = [40, 30, 20];

  it('gives the prize of the placement: first, second and third', () => {
    expect([1, 2, 3].map((rank) => prizeForRank(rank, prizes))).toEqual([40, 30, 20]);
  });

  it('gives 0 below the podium', () => {
    expect([4, 5, 40].map((rank) => prizeForRank(rank, prizes))).toEqual([0, 0, 0]);
  });

  it('gives 0 for a placement that does not exist', () => {
    expect([0, -1, 1.5, Number.NaN].map((rank) => prizeForRank(rank, prizes))).toEqual([0, 0, 0, 0]);
  });

  it('gives 0 for a placement the template has no prize for', () => {
    expect([1, 2, 3].map((rank) => prizeForRank(rank, [150]))).toEqual([150, 0, 0]);
  });
});
