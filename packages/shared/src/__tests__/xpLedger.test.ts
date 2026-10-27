import { describe, it, expect } from 'vitest';
import {
  buildXpLedger,
  buildRankDelta,
  xpBeforeDate,
  type LedgerRun,
  type LedgerEventEntry,
  type RankDeltaInput,
} from '../xpLedger.js';

function entry(partial: Partial<LedgerEventEntry>): LedgerEventEntry {
  return {
    entry_id: 'e1', user_id: 'a', event_id: 'ev1', event_type: 'participation',
    xp_awarded: 25, qualified_at: '2026-10-01T10:00:00Z', settled_at: null, ends_at: '2026-10-02T21:59:59Z',
    ...partial,
  };
}

describe('buildXpLedger', () => {
  it('gör en post per runda med dess datum och xp_gained', () => {
    const runs: LedgerRun[] = [{ id: 'r1', user_id: 'a', date: '2026-10-01', xp_gained: 40 }];
    expect(buildXpLedger(runs, [])).toEqual([
      { user_id: 'a', source: 'run', ref_id: 'r1', date: '2026-10-01', xp: 40 },
    ]);
  });

  it('daterar participation-XP med qualified_at i Stockholm-tid', () => {
    const [e] = buildXpLedger([], [entry({ qualified_at: '2026-10-01T10:00:00Z' })]);
    expect(e).toEqual({ user_id: 'a', source: 'event', ref_id: 'e1', date: '2026-10-01', xp: 25 });
  });

  it('daterar competition-XP med settled_at, annars ends_at', () => {
    const comp = { event_type: 'competition' as const, qualified_at: '2026-09-20T08:00:00Z', xp_awarded: 100 };
    const [settled] = buildXpLedger([], [entry({ ...comp, settled_at: '2026-10-04T21:55:00Z', ends_at: '2026-10-04T21:59:59Z' })]);
    expect(settled.date).toBe('2026-10-04');
    const [noSettle] = buildXpLedger([], [entry({ ...comp, settled_at: null, ends_at: '2026-10-05T21:59:59Z' })]);
    expect(noSettle.date).toBe('2026-10-05');
  });

  it('konverterar tidpunkt till Stockholm-dag: söndag 23:30 UTC (vinter) är redan måndag', () => {
    const [e] = buildXpLedger([], [entry({ qualified_at: '2026-01-04T23:30:00Z' })]);
    expect(e.date).toBe('2026-01-05');
    const [summer] = buildXpLedger([], [entry({ qualified_at: '2026-07-05T21:30:00Z' })]); // 23:30 sthlm, kvar på söndagen
    expect(summer.date).toBe('2026-07-05');
  });

  it("buildXpLedger dates event XP by the given zone's calendar day", () => {
    // 22:30Z: kl 00:30 nästa dag i Stockholm (UTC+2 på sommartid) men 18:30 samma dag i New York (UTC-4).
    const entries = [entry({ qualified_at: '2026-10-01T22:30:00Z' })];
    expect(buildXpLedger([], entries)[0]?.date).toBe('2026-10-02');
    expect(buildXpLedger([], entries, 'Europe/Stockholm')[0]?.date).toBe('2026-10-02');
    expect(buildXpLedger([], entries, 'America/New_York')[0]?.date).toBe('2026-10-01');
    expect(buildXpLedger([], entries, 'Asia/Tokyo')[0]?.date).toBe('2026-10-02');
  });

  it('zonen styr bara event-XP: rundornas datum är redan kalenderdagar', () => {
    const runs: LedgerRun[] = [{ id: 'r1', user_id: 'a', date: '2026-10-01', xp_gained: 40 }];
    expect(buildXpLedger(runs, [], 'Pacific/Auckland')[0]?.date).toBe('2026-10-01');
  });

  it('hoppar över poster utan utbetald XP (null, 0) och participation utan qualified_at', () => {
    const out = buildXpLedger([], [
      entry({ entry_id: 'x1', xp_awarded: null }),
      entry({ entry_id: 'x2', xp_awarded: 0 }),
      entry({ entry_id: 'x3', qualified_at: null }),
    ]);
    expect(out).toEqual([]);
  });

  it('hoppar över runda med xp_gained 0/null', () => {
    expect(buildXpLedger([{ id: 'r', user_id: 'a', date: '2026-10-01', xp_gained: null }], [])).toEqual([]);
  });
});

describe('buildRankDelta', () => {
  const AS_OF = '2026-09-28';
  function user(id: string, name: string, total_xp: number, created_date: string | null = '2026-01-01'): RankDeltaInput {
    return { id, name, total_xp, created_date };
  }

  it('previous_xp = total_xp minus all XP krediterad från veckostart (runda + event)', () => {
    const users = [user('a', 'Anna', 500), user('b', 'Bertil', 450)];
    const ledger = buildXpLedger(
      [
        { id: 'r1', user_id: 'a', date: '2026-09-27', xp_gained: 30 }, // före gränsen: räknas inte bort
        { id: 'r2', user_id: 'a', date: '2026-09-28', xp_gained: 40 }, // på gränsen: räknas bort
        { id: 'r3', user_id: 'b', date: '2026-10-02', xp_gained: 60 },
      ],
      [entry({ user_id: 'b', qualified_at: '2026-10-01T09:00:00Z', xp_awarded: 25 })],
    );
    const { users: out } = buildRankDelta(users, ledger, AS_OF);
    const by = Object.fromEntries(out.map(u => [u.user_id, u]));
    expect(by.a.previous_xp).toBe(460);
    expect(by.b.previous_xp).toBe(365);
  });

  it('ger rank (xp desc, namn asc) och previous_rank/rank_delta = previous - rank', () => {
    // nu: Bertil 450 (1) > Anna 400 (2) ; förut: Anna 400 (1) > Bertil 300 (2)
    const users = [user('a', 'Anna', 400), user('b', 'Bertil', 450)];
    const ledger = buildXpLedger([{ id: 'r', user_id: 'b', date: '2026-10-01', xp_gained: 150 }], []);
    const { users: out } = buildRankDelta(users, ledger, AS_OF);
    expect(out.map(u => [u.user_id, u.rank, u.previous_rank, u.rank_delta])).toEqual([
      ['b', 1, 2, 1],
      ['a', 2, 1, -1],
    ]);
  });

  it('bryter lika xp på namn asc, både nu och förut', () => {
    const users = [user('b', 'Bertil', 100), user('a', 'Anna', 100)];
    const { users: out } = buildRankDelta(users, [], AS_OF);
    expect(out.map(u => [u.user_id, u.rank, u.previous_rank])).toEqual([['a', 1, 1], ['b', 2, 2]]);
  });

  it('ger null previous_rank/rank_delta för användare skapade på eller efter veckostart', () => {
    const users = [user('a', 'Anna', 100), user('n', 'Nyman', 50, '2026-09-28')];
    const { users: out } = buildRankDelta(users, [], AS_OF);
    const n = out.find(u => u.user_id === 'n')!;
    expect(n.previous_rank).toBeNull();
    expect(n.rank_delta).toBeNull();
    expect(out.find(u => u.user_id === 'a')!.previous_rank).toBe(1); // nyman räknas inte i förra rankingen
  });

  it('klampar previous_xp vid 0 och rapporterar avvikelsen när ledger > total_xp', () => {
    const users = [user('a', 'Anna', 10)];
    const ledger = buildXpLedger([{ id: 'r', user_id: 'a', date: '2026-10-01', xp_gained: 40 }], []);
    const { users: out, diverged } = buildRankDelta(users, ledger, AS_OF);
    expect(out[0].previous_xp).toBe(0);
    expect(diverged).toEqual(['a']);
  });

  it('inga avvikelser när ledgern stämmer; xp = total_xp oförändrat', () => {
    const users = [user('a', 'Anna', 100)];
    const { users: out, diverged } = buildRankDelta(users, [], AS_OF);
    expect(out[0].xp).toBe(100);
    expect(diverged).toEqual([]);
  });

  it('räknar bara ledger för kända användare', () => {
    const ledger = buildXpLedger([{ id: 'r', user_id: 'ghost', date: '2026-10-01', xp_gained: 40 }], []);
    const { users: out } = buildRankDelta([user('a', 'Anna', 100)], ledger, AS_OF);
    expect(out).toHaveLength(1);
    expect(out[0].previous_xp).toBe(100);
  });
});

describe('xpBeforeDate', () => {
  const AS_OF = '2026-09-28';
  const ledgerOf = (rows: Array<[string, string, number]>) =>
    rows.map(([user_id, date, xp], i) => ({ user_id, source: 'run' as const, ref_id: `r${i}`, date, xp }));

  it('drar bort XP daterad från och med asOf, men inte dagen före', () => {
    const ledger = ledgerOf([['a', '2026-09-27', 30], ['a', '2026-09-28', 40], ['a', '2026-10-02', 5]]);
    const { previousXp, diverged } = xpBeforeDate([{ id: 'a', total_xp: 500 }], ledger, AS_OF);
    expect(previousXp.get('a')).toBe(455);
    expect(diverged).toEqual([]);
  });

  it('klampar till 0 och rapporterar användaren när liggaren överstiger total_xp', () => {
    const { previousXp, diverged } = xpBeforeDate([{ id: 'a', total_xp: 30 }], ledgerOf([['a', '2026-09-29', 40]]), AS_OF);
    expect(previousXp.get('a')).toBe(0);
    expect(diverged).toEqual(['a']);
  });

  it('ger varje användare ett värde (total_xp utan liggarposter) och ignorerar poster för okända användare', () => {
    const { previousXp } = xpBeforeDate([{ id: 'a', total_xp: 100 }], ledgerOf([['ghost', '2026-10-01', 40]]), AS_OF);
    expect([...previousXp.entries()]).toEqual([['a', 100]]);
  });

  it('buildRankDelta uses the same back-calculation: previous_xp equals xpBeforeDate for every user', () => {
    const users: RankDeltaInput[] = [
      { id: 'a', name: 'Anna', total_xp: 500, created_date: '2026-01-01' },
      { id: 'b', name: 'Bertil', total_xp: 20, created_date: '2026-01-01' },
      { id: 'c', name: 'Cecilia', total_xp: 90, created_date: '2026-09-29' },
    ];
    const ledger = ledgerOf([['a', '2026-09-28', 40], ['b', '2026-09-30', 60], ['c', '2026-10-01', 90]]);
    const expected = xpBeforeDate(users, ledger, AS_OF);
    const { users: out, diverged } = buildRankDelta(users, ledger, AS_OF);

    expect(Object.fromEntries(out.map((u) => [u.user_id, u.previous_xp]))).toEqual(Object.fromEntries(expected.previousXp));
    expect(diverged).toEqual(expected.diverged);
  });
});
