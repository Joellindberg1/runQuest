import { describe, it, expect } from 'vitest';
import { buildPositionHistory, type PositionHistoryUser } from '../positionHistory.js';
import { buildRankDelta, buildXpLedger, type LedgerEventEntry, type LedgerRun, type XpLedgerEntry } from '../xpLedger.js';
import { compareXpStandings, rankOf } from '../rankPasses.js';
import { zoneDay } from '../calendar.js';

// Tisdag 2026-10-27 i Stockholm: den pågående veckan börjar måndagen 2026-10-26.
const NOW = new Date('2026-10-27T10:00:00Z');
const OLD = '2020-01-01T00:00:00Z';

function member(id: string, name: string, total_xp: number, created_at: string | null = OLD): PositionHistoryUser {
  return { id, name, profile_picture: null, total_xp, created_at };
}

function run(id: string, user_id: string, date: string, xp_gained: number): LedgerRun {
  return { id, user_id, date, xp_gained };
}

function positionsOf(response: { runners: Array<{ user_id: string; positions: Array<number | null> }> }, id: string) {
  return response.runners.find((r) => r.user_id === id)!.positions;
}

describe('buildPositionHistory', () => {
  it('positions never share a place and ties follow name then id', () => {
    const users = [
      member('u3', 'Cecilia', 0),
      member('s2', 'Sam', 0),
      member('z', 'Zed', 100),
      member('u1', 'adam', 0),
      member('s1', 'Sam', 0),
      member('u2', 'Bea', 0),
    ];
    // Zed har sin XP först den 20 oktober, så i de tidiga veckorna är alla sex lika på 0.
    const ledger = buildXpLedger([run('r1', 'z', '2026-10-20', 100)], []);
    const { response } = buildPositionHistory(users, ledger, NOW, 8);

    expect(response.weeks).toHaveLength(8);
    response.weeks.forEach((_, k) => {
      const places = response.runners.map((r) => r.positions[k]!).sort((a, b) => a - b);
      expect(places).toEqual([1, 2, 3, 4, 5, 6]);
    });
    // Tidig vecka: alfabetiskt skiftlägesokänsligt, därefter id. Zed är sist med 0 XP.
    const early = response.runners
      .map((r) => ({ id: r.user_id, place: r.positions[0]! }))
      .sort((a, b) => a.place - b.place)
      .map((r) => r.id);
    expect(early).toEqual(['u1', 'u2', 'u3', 's1', 's2', 'z']);
    // Live-veckan: Zed har 100 och leder, resten behåller sin ordning.
    expect(response.runners.map((r) => r.user_id)).toEqual(['z', 'u1', 'u2', 'u3', 's1', 's2']);
  });

  it('a member who joined mid-period is null before and ranked after the joining week ends', () => {
    // Nyman skapades onsdagen 2026-10-14 (veckan 2026-10-12..18) och har mest XP idag.
    const users = [
      member('a', 'Anna', 100),
      member('b', 'Bertil', 50),
      member('n', 'Nyman', 500, '2026-10-14T08:00:00Z'),
    ];
    const { response } = buildPositionHistory(users, [], NOW, 8);

    expect(response.weeks.map((w) => w.start)).toEqual([
      '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26',
    ]);
    // Före inträdesveckan: null, och de andra två rankas utan Nyman.
    expect(positionsOf(response, 'n')).toEqual([null, null, null, null, null, 1, 1, 1]);
    expect(positionsOf(response, 'a')).toEqual([1, 1, 1, 1, 1, 2, 2, 2]);
    expect(positionsOf(response, 'b')).toEqual([2, 2, 2, 2, 2, 3, 3, 3]);
  });

  it('a member created on the first day of a week is placed from the following week', () => {
    // Måndagen 2026-10-19 är gränsen för veckan 2026-10-12..18: dagen räknas inte som närvarande där.
    const users = [member('a', 'Anna', 100), member('n', 'Nyman', 500, '2026-10-19T05:00:00Z')];
    const { response } = buildPositionHistory(users, [], NOW, 3);
    expect(positionsOf(response, 'n')).toEqual([null, 1, 1]);
    expect(positionsOf(response, 'a')).toEqual([1, 2, 2]);
  });

  it('reports member_since as the day in the group zone, or null when created_at is unknown', () => {
    const users = [member('a', 'Anna', 10, '2026-10-14T22:30:00Z'), member('b', 'Bertil', 5, null)];
    const stockholm = buildPositionHistory(users, [], NOW, 2).response;
    expect(stockholm.runners.find((r) => r.user_id === 'a')!.member_since).toBe('2026-10-15');
    expect(stockholm.runners.find((r) => r.user_id === 'b')!.member_since).toBeNull();
    const newYork = buildPositionHistory(users, [], NOW, 2, 'America/New_York').response;
    expect(newYork.runners.find((r) => r.user_id === 'a')!.member_since).toBe('2026-10-14');
  });

  it('leading weeks with nobody present are trimmed and the current week stays', () => {
    // Gruppen är yngre än åtta veckor: båda skapades onsdagen 2026-10-14.
    const users = [member('a', 'Anna', 100, '2026-10-14T08:00:00Z'), member('b', 'Bertil', 50, '2026-10-15T08:00:00Z')];
    const { response } = buildPositionHistory(users, [], NOW, 8);
    expect(response.weeks.map((w) => w.start)).toEqual(['2026-10-12', '2026-10-19', '2026-10-26']);
    expect(response.runners.every((r) => r.positions.length === response.weeks.length)).toBe(true);
    expect(positionsOf(response, 'a')).toEqual([1, 1, 1]);
  });

  it('one member gives a valid response', () => {
    const { response } = buildPositionHistory([member('a', 'Anna', 120)], [], NOW, 8);
    expect(response.weeks).toHaveLength(8);
    expect(response.runners).toHaveLength(1);
    expect(response.runners[0]).toMatchObject({ user_id: 'a', name: 'Anna', profile_picture: null });
    expect(response.runners[0]!.positions).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it('no finished week gives weeks.length 1', () => {
    // Alla skapades i dag, och tomma grupper har heller ingen avslutad vecka med närvarande.
    const created = [member('a', 'Anna', 10, '2026-10-27T07:00:00Z'), member('b', 'Bertil', 20, '2026-10-27T07:30:00Z')];
    const fresh = buildPositionHistory(created, [], NOW, 8).response;
    expect(fresh.weeks).toHaveLength(1);
    expect(fresh.weeks[0]).toMatchObject({ start: '2026-10-26', end: '2026-11-01', is_current_week: true });
    expect(fresh.runners.map((r) => [r.user_id, r.positions])).toEqual([['b', [1]], ['a', [2]]]);

    const empty = buildPositionHistory([], [], NOW, 8).response;
    expect(empty.weeks).toHaveLength(1);
    expect(empty.runners).toEqual([]);
  });

  it('ledger larger than total_xp clamps to 0 and reports divergence', () => {
    // Annas liggare (40 den 20 oktober) är större än hennes total_xp (10).
    const users = [member('a', 'Anna', 10), member('b', 'Bertil', 5)];
    const ledger = buildXpLedger([run('r1', 'a', '2026-10-20', 40)], []);
    const { response, diverged } = buildPositionHistory(users, ledger, NOW, 8);

    // Veckor som slutar före den 20:e: Annas XP klampas till 0 och Bertil (5) leder. Efter: 10 mot 5.
    expect(positionsOf(response, 'a')).toEqual([2, 2, 2, 2, 2, 2, 1, 1]);
    expect(positionsOf(response, 'b')).toEqual([1, 1, 1, 1, 1, 1, 2, 2]);
    expect(diverged).toEqual(['a']);
  });

  it('last finished week equals rank-delta previous_rank for every member, null included', () => {
    const users = [
      member('a', 'Anna', 400),
      member('b', 'Bertil', 450),
      member('c', 'Cecilia', 450),
      member('d', 'David', 90, '2026-10-26T06:00:00Z'), // skapad måndagen: ingen placering förra veckan
      member('e', 'Erik', 0, null),
      member('f', 'Fia', 130, '2026-10-21T12:00:00Z'), // skapad mitt i förra veckan
    ];
    const entry: LedgerEventEntry = {
      entry_id: 'e1', user_id: 'c', event_id: 'ev1', event_type: 'participation',
      xp_awarded: 60, qualified_at: '2026-10-26T08:00:00Z', settled_at: null, ends_at: '2026-10-27T21:59:59Z',
    };
    const ledger = buildXpLedger(
      [
        run('r1', 'a', '2026-10-27', 100),
        run('r2', 'b', '2026-10-26', 150),
        run('r3', 'b', '2026-10-22', 30),
        run('r4', 'f', '2026-10-25', 40),
        run('r5', 'e', '2026-10-20', 0),
      ],
      [entry],
    );

    const { response } = buildPositionHistory(users, ledger, NOW, 8);
    const asOf = response.weeks[response.weeks.length - 1]!.start;
    const { users: delta } = buildRankDelta(
      users.map((u) => ({
        id: u.id, name: u.name, total_xp: u.total_xp,
        created_date: u.created_at ? zoneDay(new Date(u.created_at)) : null,
      })),
      ledger,
      asOf,
    );

    expect(delta).toHaveLength(users.length);
    for (const d of delta) {
      expect(positionsOf(response, d.user_id)[response.weeks.length - 2]).toBe(d.previous_rank);
    }
    // Invarianten är inte tom: både null och riktiga placeringar förekommer.
    expect(delta.some((d) => d.previous_rank === null)).toBe(true);
    expect(delta.some((d) => d.previous_rank !== null)).toBe(true);
  });

  it('live week order equals the Standings order for the same users', () => {
    const users = [
      member('u4', 'dora', 70),
      member('u1', 'Anna', 300),
      member('u3', 'Cecilia', 300),
      member('u2', 'Bertil', 20, '2026-10-26T09:00:00Z'), // skapad i dag: finns i Standings och i live-veckan
      member('u5', 'Erik', 0),
    ];
    const ledger = buildXpLedger([run('r1', 'u1', '2026-10-26', 25), run('r2', 'u4', '2026-10-15', 10)], []);
    const { response } = buildPositionHistory(users, ledger, NOW, 4);

    const standings = [...users].sort((a, b) => compareXpStandings(
      { id: a.id, name: a.name, xp: a.total_xp },
      { id: b.id, name: b.name, xp: b.total_xp },
    ));
    expect(response.runners.map((r) => r.user_id)).toEqual(standings.map((u) => u.id));
    const standingRows = users.map((u) => ({ id: u.id, name: u.name, xp: u.total_xp }));
    for (const r of response.runners) {
      expect(r.positions[r.positions.length - 1]).toBe(rankOf(r.user_id, standingRows));
    }
  });

  it('week boundaries are calendar days across the 2026-10-25 daylight-saving week', () => {
    // 00:30 måndag 2026-10-26 lokal tid (CET) = söndag 23:30 UTC.
    const mondayJustAfterMidnight = new Date('2026-10-25T23:30:00Z');
    // Annas 20 XP söndagen och 20 XP måndagen; Bertils eventXP kvalificerades 00:10 lokal måndag = 23:10 UTC söndag.
    const users = [member('a', 'Anna', 100), member('b', 'Bertil', 90)];
    const bertilEvent: LedgerEventEntry = {
      entry_id: 'e1', user_id: 'b', event_id: 'ev1', event_type: 'participation',
      xp_awarded: 15, qualified_at: '2026-10-25T23:10:00Z', settled_at: null, ends_at: '2026-10-30T21:59:59Z',
    };
    const ledger = buildXpLedger([run('r1', 'a', '2026-10-25', 20), run('r2', 'a', '2026-10-26', 20)], [bertilEvent]);
    const { response } = buildPositionHistory(users, ledger, mondayJustAfterMidnight, 3, 'Europe/Stockholm');

    expect(response.as_of).toBe('2026-10-26');
    expect(response.weeks).toEqual([
      { start: '2026-10-12', end: '2026-10-18', iso_week: 42, iso_year: 2026, is_current_week: false },
      { start: '2026-10-19', end: '2026-10-25', iso_week: 43, iso_year: 2026, is_current_week: false },
      { start: '2026-10-26', end: '2026-11-01', iso_week: 44, iso_year: 2026, is_current_week: true },
    ]);
    // Slutet av sommartidsveckan: söndagens 20 XP ligger kvar, måndagens 20 (Anna) och 15 (Bertil) räknas bort.
    // Anna 80 mot Bertil 75: Anna leder. Hade eventet daterats i UTC (söndag) hade Bertil lett med 90.
    expect(positionsOf(response, 'a')).toEqual([2, 1, 1]);
    expect(positionsOf(response, 'b')).toEqual([1, 2, 2]);
  });

  it('week 53 and the year boundary carry iso_week and iso_year', () => {
    const { response } = buildPositionHistory([member('a', 'Anna', 1)], [], new Date('2027-01-05T10:00:00Z'), 8);
    expect(response.as_of).toBe('2027-01-05');
    expect(response.weeks.map((w) => [w.start, w.iso_week, w.iso_year])).toEqual([
      ['2026-11-16', 47, 2026],
      ['2026-11-23', 48, 2026],
      ['2026-11-30', 49, 2026],
      ['2026-12-07', 50, 2026],
      ['2026-12-14', 51, 2026],
      ['2026-12-21', 52, 2026],
      ['2026-12-28', 53, 2026],
      ['2027-01-04', 1, 2027],
    ]);
    expect(response.weeks[6]!.end).toBe('2027-01-03');
  });

  it('Monday morning with an almost empty current week ranks from total_xp', () => {
    // Måndag 08:10 lokal tid. Annas första runda i veckan (20 XP) ger henne ledningen i live-veckan men inte i slutet av förra veckan.
    const monday = new Date('2026-10-26T06:10:00Z');
    const users = [member('a', 'Anna', 100), member('b', 'Bertil', 90)];
    const ledger = buildXpLedger([run('r1', 'a', '2026-10-26', 20)], []);
    const { response, diverged } = buildPositionHistory(users, ledger, monday, 4);

    expect(response.weeks[response.weeks.length - 1]!.start).toBe('2026-10-26');
    expect(positionsOf(response, 'a')).toEqual([2, 2, 2, 1]);
    expect(positionsOf(response, 'b')).toEqual([1, 1, 1, 2]);
    expect(diverged).toEqual([]);
  });

  it('weeks=1 returns only the current week', () => {
    const ledger: XpLedgerEntry[] = buildXpLedger([run('r1', 'a', '2026-10-20', 40)], []);
    const { response } = buildPositionHistory([member('a', 'Anna', 10), member('b', 'Bertil', 20)], ledger, NOW, 1);
    expect(response.weeks).toEqual([
      { start: '2026-10-26', end: '2026-11-01', iso_week: 44, iso_year: 2026, is_current_week: true },
    ]);
    expect(response.runners.map((r) => [r.user_id, r.positions])).toEqual([['b', [1]], ['a', [2]]]);
  });

  it('marks only the last week as current and keeps positions parallel with weeks', () => {
    const { response } = buildPositionHistory([member('a', 'Anna', 10)], [], NOW, 6);
    expect(response.weeks.map((w) => w.is_current_week)).toEqual([false, false, false, false, false, true]);
    expect(response.runners[0]!.positions).toHaveLength(response.weeks.length);
  });

  it('rejects a weeks value that is not a positive integer', () => {
    for (const bad of [0, -1, 2.5, Number.NaN]) {
      expect(() => buildPositionHistory([], [], NOW, bad)).toThrow(RangeError);
    }
  });
});
