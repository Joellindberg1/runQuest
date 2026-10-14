import { describe, it, expect } from 'vitest';
import {
  challengeScore,
  compareChallengeStandings,
  detectRankPasses,
  type ChallengeRecord,
  type ChallengeStanding,
  type RankPassMember,
} from '../rankPasses.js';
import { activityKeys } from '../activity.js';
import { buildRankDelta, type RankDeltaInput } from '../xpLedger.js';

const TODAY = '2026-10-14';
const OLD = '2026-01-01';

/** midnight defaults to `before` (W och M rörde sig inte före skrivningen idag); after defaults to `before` (orörd). */
function xp(id: string, name: string, before: number, after = before, extra: Partial<RankPassMember<number>> = {}): RankPassMember<number> {
  return { id, name, createdDate: OLD, midnight: before, before, after, ...extra };
}

function rec(wins: number, draws: number, losses: number): ChallengeRecord {
  return { wins, draws, losses };
}

function cp(
  id: string, name: string, before: ChallengeRecord, after = before, extra: Partial<RankPassMember<ChallengeRecord>> = {},
): RankPassMember<ChallengeRecord> {
  return { id, name, createdDate: OLD, midnight: before, before, after, ...extra };
}

function detectXp(passerId: string, members: RankPassMember<number>[], today = TODAY) {
  return detectRankPasses({ measure: 'xp', passerId, today, members });
}

function detectCp(passerId: string, members: RankPassMember<ChallengeRecord>[], today = TODAY) {
  return detectRankPasses({ measure: 'challenge_points', passerId, today, members });
}

describe('rankPasses', () => {
  it('korsning: W förbi M ger en passering med rätt rangordning efter', () => {
    // Före: B 300 (1), A 200 (2), W 100 (3), C 50 (4). Efter: B 300 (1), W 250 (2), A 200 (3), C 50 (4).
    const members = [xp('b', 'Bo', 300), xp('a', 'Ada', 200), xp('w', 'Wilma', 100, 250), xp('c', 'Cleo', 50)];
    expect(detectXp('w', members)).toEqual({
      passes: [{
        passerId: 'w', passedId: 'a', passerRank: 2, passedRank: 3,
        dedupeKey: activityKeys.rankPassed('xp', 'w', 'a', TODAY),
      }],
      retractKeys: [],
    });
  });

  it('pingis: W förbi M, M förbi W, W förbi M ger en rad (M:s återtagande ger ingen eftersom M inte låg bakom vid dygnsskiftet)', () => {
    // Dygnsskiftet: M 200, W 100. Kl 10 W 100→250, kl 14 M 200→300, kl 18 W 250→400.
    const atMidnight = { w: 100, m: 200 };
    const at10 = detectXp('w', [xp('w', 'Wilma', 100, 250, { midnight: atMidnight.w }), xp('m', 'Max', 200, 200, { midnight: atMidnight.m })]);
    const at14 = detectXp('m', [xp('w', 'Wilma', 250, 250, { midnight: atMidnight.w }), xp('m', 'Max', 200, 300, { midnight: atMidnight.m })]);
    const at18 = detectXp('w', [xp('w', 'Wilma', 250, 400, { midnight: atMidnight.w }), xp('m', 'Max', 300, 300, { midnight: atMidnight.m })]);

    expect(at10.passes).toHaveLength(1);
    expect(at14.passes).toEqual([]);
    expect(at18.passes).toHaveLength(1);
    // Samma nyckel kl 10 och kl 18: loggens unika index släpper bara igenom en rad.
    expect(at18.passes[0].dedupeKey).toBe(at10.passes[0].dedupeKey);
  });

  it('W som inte låg bakom M vid dygnsskiftet ger ingen rad', () => {
    // W låg före M vid dygnsskiftet (300 mot 200), föll bakom under dagen och tar nu igen platsen.
    const members = [xp('w', 'Wilma', 150, 250, { midnight: 300 }), xp('m', 'Max', 200)];
    expect(detectXp('w', members)).toEqual({ passes: [], retractKeys: [] });
  });

  describe('lika mått avgörs av namn och id', () => {
    // W når 200 och M har 200; ordningen avgörs av namn (skiftlägesokänsligt) och sedan id.
    const cases: Array<{ rad: string; w: [string, string]; m: [string, string]; passes: boolean; ranks?: [number, number] }> = [
      { rad: 'W har tidigare namn', w: ['w', 'Anna'], m: ['m', 'Berit'], passes: true, ranks: [1, 2] },
      { rad: 'W har senare namn', w: ['w', 'Berit'], m: ['m', 'Anna'], passes: false },
      { rad: 'skiftläge räknas inte: lika namn faller tillbaka på id, W har lägre id', w: ['a', 'anna'], m: ['b', 'Anna'], passes: true, ranks: [1, 2] },
      { rad: 'skiftläge räknas inte: lika namn faller tillbaka på id, W har högre id', w: ['b', 'anna'], m: ['a', 'Anna'], passes: false },
      { rad: 'identiskt namn avgörs av id', w: ['a', 'Anna'], m: ['b', 'Anna'], passes: true, ranks: [1, 2] },
    ];
    it.each(cases)('$rad', ({ w, m, passes, ranks }) => {
      const result = detectXp(w[0], [xp(w[0], w[1], 100, 200), xp(m[0], m[1], 200)]);
      if (!passes) {
        expect(result.passes).toEqual([]);
        return;
      }
      expect(result.passes).toHaveLength(1);
      expect([result.passes[0].passerRank, result.passes[0].passedRank]).toEqual(ranks);
    });

    it('flera medlemmar med samma mått delar aldrig rang', () => {
      const members = [xp('w', 'Aaron', 10, 100), xp('c', 'cecil', 100), xp('b', 'Bo', 100), xp('a', 'Ada', 100), xp('d', 'Dag', 100)];
      const { passes } = detectXp('w', members);
      // Lika xp avgörs av namn: Aaron, Ada, Bo, cecil, Dag. Fyra olika rangplatser efter W.
      expect(passes.map((p) => [p.passedId, p.passerRank, p.passedRank])).toEqual([['a', 1, 2], ['b', 1, 3], ['c', 1, 4], ['d', 1, 5]]);
    });
  });

  it('nytt dygn ger ny nyckel', () => {
    const members = [xp('w', 'Wilma', 100, 250), xp('m', 'Max', 200)];
    const today = detectXp('w', members, '2026-10-14').passes[0];
    const tomorrow = detectXp('w', members, '2026-10-15').passes[0];
    expect(today.dedupeKey).toBe(activityKeys.rankPassed('xp', 'w', 'm', '2026-10-14'));
    expect(tomorrow.dedupeKey).toBe(activityKeys.rankPassed('xp', 'w', 'm', '2026-10-15'));
    expect(tomorrow.dedupeKey).not.toBe(today.dedupeKey);
  });

  describe('en minskning ger ingen rad och returnerar dagens retract-nycklar', () => {
    it('xp', () => {
      // Före: P 300, W 250, M 200, N 100. Efter: P 300, M 200, W 150, N 100. W föll bakom M men inte bakom N.
      const members = [xp('p', 'Pia', 300), xp('w', 'Wilma', 250, 150, { midnight: 100 }), xp('m', 'Max', 200), xp('n', 'Nils', 100)];
      expect(detectXp('w', members)).toEqual({
        passes: [],
        retractKeys: [activityKeys.rankPassed('xp', 'w', 'm', TODAY)],
      });
    });

    it('challenge_points', () => {
      // W 3-0-2 (0,6) → 3-0-3 (0,5). M 5-0-4 (0,556) går före; N 1-0-1 (0,5, färre vinster) hamnar efter. W var före M (0,6 > 0,556) och N.
      const members = [
        cp('w', 'Wilma', rec(3, 0, 2), rec(3, 0, 3), { midnight: rec(0, 0, 0) }),
        cp('m', 'Max', rec(5, 0, 4)),
        cp('n', 'Nils', rec(1, 0, 1)),
      ];
      expect(detectCp('w', members)).toEqual({
        passes: [],
        retractKeys: [activityKeys.rankPassed('challenge_points', 'w', 'm', TODAY)],
      });
    });

    it('en minskning som inte byter plats retractar ingenting', () => {
      const members = [xp('w', 'Wilma', 500, 400), xp('m', 'Max', 200)];
      expect(detectXp('w', members)).toEqual({ passes: [], retractKeys: [] });
    });
  });

  describe('ett oförändrat mått ger ingen rad', () => {
    it('xp', () => {
      const members = [xp('w', 'Wilma', 100, 100, { midnight: 50 }), xp('m', 'Max', 200)];
      expect(detectXp('w', members)).toEqual({ passes: [], retractKeys: [] });
    });

    it('challenge_points', () => {
      const members = [cp('w', 'Wilma', rec(1, 0, 1), rec(1, 0, 1), { midnight: rec(0, 0, 0) }), cp('m', 'Max', rec(3, 0, 0))];
      expect(detectCp('w', members)).toEqual({ passes: [], retractKeys: [] });
    });
  });

  describe('en ny medlem skapad efter dygnsskiftet ger ingen rad', () => {
    it('M skapad idag passeras inte, även om dess midnight-värde är 0', () => {
      // Båda har 0 vid dygnsskiftet och namnet skulle placera W bakom M där — men M fanns inte då.
      const members = [xp('w', 'Wilma', 0, 250), xp('m', 'Anna', 200, 200, { createdDate: TODAY, midnight: 0 })];
      expect(detectXp('w', members).passes).toEqual([]);
    });

    it('M utan midnight-värde passeras inte', () => {
      const members = [xp('w', 'Wilma', 100, 250), xp('m', 'Max', 200, 200, { midnight: null })];
      expect(detectXp('w', members).passes).toEqual([]);
    });

    it('W skapad idag passerar ingen', () => {
      const members = [xp('w', 'Wilma', 0, 250, { createdDate: TODAY, midnight: null }), xp('m', 'Max', 200)];
      expect(detectXp('w', members).passes).toEqual([]);
    });

    it('en medlem utan känt skapandedatum räknas som medlem vid dygnsskiftet', () => {
      const members = [xp('w', 'Wilma', 100, 250, { createdDate: null }), xp('m', 'Max', 200, 200, { createdDate: null })];
      expect(detectXp('w', members).passes).toHaveLength(1);
    });

    it('den nya medlemmen räknas ändå med i rangordningen efter passeringen', () => {
      // Nya N ligger före W och A efter, men ger själv ingen rad. W:s rang räknar med N.
      const members = [xp('w', 'Wilma', 100, 250), xp('a', 'Ada', 200), xp('n', 'Nils', 400, 400, { createdDate: TODAY, midnight: null })];
      const { passes } = detectXp('w', members);
      expect(passes).toHaveLength(1);
      expect(passes[0]).toMatchObject({ passedId: 'a', passerRank: 2, passedRank: 3 });
    });
  });

  it('flera passerade medlemmar ger en rad per medlem', () => {
    // Före: D 400, C 300, B 200, A 100, W 50. Efter: W 250 går förbi B och A men inte C och D; rangordning efter: D, C, W, B, A.
    const members = [
      xp('d', 'Dag', 400), xp('c', 'Cleo', 300), xp('b', 'Bo', 200), xp('a', 'Ada', 100), xp('w', 'Wilma', 50, 250),
    ];
    const { passes } = detectXp('w', members);
    expect(passes).toEqual([
      { passerId: 'w', passedId: 'b', passerRank: 3, passedRank: 4, dedupeKey: activityKeys.rankPassed('xp', 'w', 'b', TODAY) },
      { passerId: 'w', passedId: 'a', passerRank: 3, passedRank: 5, dedupeKey: activityKeys.rankPassed('xp', 'w', 'a', TODAY) },
    ]);
    expect(new Set(passes.map((p) => p.dedupeKey)).size).toBe(2);
  });

  describe('samma indata ger samma nycklar (stabil activityKeys.rankPassed)', () => {
    it('två anrop och blandad medlemsordning ger identiskt resultat', () => {
      const members = [xp('d', 'Dag', 400), xp('b', 'Bo', 200), xp('a', 'Ada', 100), xp('w', 'Wilma', 50, 250), xp('c', 'Cleo', 300)];
      const first = detectXp('w', members);
      expect(detectXp('w', members)).toEqual(first);
      expect(detectXp('w', [...members].reverse())).toEqual(first);
      expect(detectXp('w', [members[2], members[4], members[0], members[3], members[1]])).toEqual(first);
      expect(first.passes.map((p) => p.dedupeKey)).toEqual([
        activityKeys.rankPassed('xp', 'w', 'b', TODAY),
        activityKeys.rankPassed('xp', 'w', 'a', TODAY),
      ]);
    });

    it('anropet muterar inte indata', () => {
      const members = [xp('w', 'Wilma', 50, 250), xp('a', 'Ada', 100)];
      const snapshot = structuredClone(members);
      detectXp('w', members);
      expect(members).toEqual(snapshot);
    });
  });

  describe('kantfall', () => {
    it('W ensam i gruppen ger ingenting', () => {
      expect(detectXp('w', [xp('w', 'Wilma', 0, 100)])).toEqual({ passes: [], retractKeys: [] });
    });

    it('W saknas i medlemslistan ger ingenting (och kastar inte)', () => {
      expect(detectXp('w', [xp('a', 'Ada', 100)])).toEqual({ passes: [], retractKeys: [] });
    });

    it('W sist förbi alla ger en rad per medlem och rang 1', () => {
      const members = [xp('a', 'Ada', 300), xp('b', 'Bo', 200), xp('w', 'Wilma', 0, 1000)];
      const { passes } = detectXp('w', members);
      expect(passes.map((p) => [p.passedId, p.passerRank, p.passedRank])).toEqual([['a', 1, 2], ['b', 1, 3]]);
    });

    it('W i täten som ökar ytterligare passerar ingen', () => {
      const members = [xp('w', 'Wilma', 500, 600), xp('a', 'Ada', 300)];
      expect(detectXp('w', members)).toEqual({ passes: [], retractKeys: [] });
    });
  });

  describe('challenge_points', () => {
    it('challenge_points: poäng, sedan vinster, sedan namn och id avgör ordningen', () => {
      // W 2-0-2 (0,5) → 3-0-2 (0,6). Före var 0,5 med två vinster: efter Cleo (0,5, 3 vinster) och Alva (0,5, 2 vinster, tidigare namn).
      const members = [
        cp('a', 'Ada', rec(1, 0, 0)),         // 1,0 — före W hela tiden
        cp('b', 'Bo', rec(2, 1, 1)),          // 0,625 — före W hela tiden
        cp('c', 'Cleo', rec(3, 0, 3)),        // 0,5, 3 vinster — före W före, efter W nu
        cp('v', 'Alva', rec(2, 0, 2)),        // 0,5, 2 vinster, namn före 'Wilma' — före W före, efter W nu
        cp('z', 'Zed', rec(2, 0, 2)),         // 0,5, 2 vinster, namn efter 'Wilma' — efter W hela tiden
        cp('h', 'Hugo', rec(0, 0, 1)),        // 0 poäng men har spelat — efter W hela tiden
        cp('g', 'Gunn', rec(0, 0, 0)),        // noll matcher — sist
        cp('w', 'Wilma', rec(2, 0, 2), rec(3, 0, 2)),
      ];
      const { passes } = detectCp('w', members);
      // Efter: Ada 1, Bo 2, Wilma 3, Cleo 4, Alva 5, Zed 6, Hugo 7, Gunn 8.
      expect(passes).toEqual([
        { passerId: 'w', passedId: 'c', passerRank: 3, passedRank: 4, dedupeKey: activityKeys.rankPassed('challenge_points', 'w', 'c', TODAY) },
        { passerId: 'w', passedId: 'v', passerRank: 3, passedRank: 5, dedupeKey: activityKeys.rankPassed('challenge_points', 'w', 'v', TODAY) },
      ]);
    });

    it('en första förlust lyfter över medlemmar utan matcher (samma ordning som tabellen)', () => {
      const members = [cp('w', 'Wilma', rec(0, 0, 0), rec(0, 0, 1)), cp('g', 'Gunn', rec(0, 0, 0))];
      expect(detectCp('w', members).passes).toEqual([
        { passerId: 'w', passedId: 'g', passerRank: 1, passedRank: 2, dedupeKey: activityKeys.rankPassed('challenge_points', 'w', 'g', TODAY) },
      ]);
    });

    it('båda deltagarna kan ändras i samma skrivning: M:s nya värde används för W:s rang efter', () => {
      // Seger för W över M i en utmaning: W 0-0-0 → 1-0-0, M 1-0-0 → 1-0-1. Z har 1-0-1 (0,5). Före: M, Z, W (noll matcher sist).
      const members = [
        cp('w', 'Wilma', rec(0, 0, 0), rec(1, 0, 0), { midnight: rec(0, 0, 0) }),
        cp('m', 'Max', rec(1, 0, 0), rec(1, 0, 1), { midnight: rec(1, 0, 0) }),
        cp('z', 'Zed', rec(1, 0, 1)),
      ];
      const { passes } = detectCp('w', members);
      // Efter: W 1,0 (1); M och Z har 0,5 och en vinst vardera, så namnet avgör: Max (2), Zed (3). W passerar båda.
      expect(passes.map((p) => [p.passedId, p.passerRank, p.passedRank])).toEqual([['m', 1, 2], ['z', 1, 3]]);
    });
  });

  describe('xp-rangen är samma som buildRankDelta', () => {
    const users: RankDeltaInput[] = [
      { id: 'u1', name: 'anna', total_xp: 500, created_date: OLD },
      { id: 'u2', name: 'Anna', total_xp: 500, created_date: OLD },
      { id: 'u3', name: 'Bertil', total_xp: 500, created_date: OLD },
      { id: 'u4', name: 'Cecilia', total_xp: 900, created_date: OLD },
      { id: 'u5', name: 'david', total_xp: 120, created_date: OLD },
      { id: 'u6', name: 'Eva', total_xp: 120, created_date: OLD },
      { id: 'u7', name: 'Filip', total_xp: 0, created_date: OLD },
      { id: 'u8', name: 'Gustav', total_xp: 0, created_date: OLD },
    ];
    const expected = new Map(buildRankDelta(users, [], TODAY).users.map((u) => [u.user_id, u.rank]));

    it('varje medlems rang efter passeringen är lika med rank i buildRankDelta (inkl. lika xp och skiftläge)', () => {
      // Varje medlem får en tur som W, helt bakom alla före skrivningen (-1) och med sitt riktiga xp efter. Då passerar W
      // alla som ligger efter W i tabellen; unionen av observerade rangordningar täcker alla medlemmar.
      const observed = new Map<string, number>();
      for (const w of users) {
        const members = users.map((u) => (u.id === w.id
          ? xp(u.id, u.name, -1, u.total_xp, { midnight: -1 })
          : xp(u.id, u.name, u.total_xp)));
        const { passes } = detectXp(w.id, members);
        for (const p of passes) {
          observed.set(p.passerId, p.passerRank);
          observed.set(p.passedId, p.passedRank);
        }
      }
      expect(observed.size).toBe(users.length);
      expect(Object.fromEntries(observed)).toEqual(Object.fromEntries(expected));
    });

    it('"låg bakom vid dygnsskiftet" är samma som previous_rank i buildRankDelta (inkl. medlem skapad idag)', () => {
      const withNewcomer: RankDeltaInput[] = [...users, { id: 'u9', name: 'Hanna', total_xp: 80, created_date: TODAY }];
      const ledger = [
        { user_id: 'u1', source: 'run' as const, ref_id: 'r1', date: TODAY, xp: 400 },
        { user_id: 'u5', source: 'run' as const, ref_id: 'r2', date: TODAY, xp: 100 },
        { user_id: 'u9', source: 'run' as const, ref_id: 'r3', date: TODAY, xp: 80 },
      ];
      const delta = buildRankDelta(withNewcomer, ledger, TODAY);
      const previous = new Map(delta.users.map((u) => [u.user_id, u]));

      // Midnight-värdet är samma härledning som buildRankDelta: total xp minus xp krediterad idag (aldrig under 0).
      const credited = new Map<string, number>();
      for (const e of ledger) credited.set(e.user_id, (credited.get(e.user_id) ?? 0) + e.xp);
      const midnightOf = (u: RankDeltaInput) => Math.max(0, u.total_xp - (credited.get(u.id) ?? 0));

      for (const w of withNewcomer) {
        // W före skrivningen = dess midnight-värde; alla andra orörda på sina midnight-värden; W efter = överlägset högst.
        const members = withNewcomer.map((u) => (u.id === w.id
          ? xp(u.id, u.name, midnightOf(u), 1_000_000, { createdDate: u.created_date, midnight: midnightOf(u) })
          : xp(u.id, u.name, midnightOf(u), midnightOf(u), { createdDate: u.created_date, midnight: midnightOf(u) })));
        const passedIds = detectXp(w.id, members).passes.map((p) => p.passedId).sort();

        const wPrev = previous.get(w.id)!.previous_rank;
        const expectedIds = wPrev === null ? [] : withNewcomer
          .map((u) => ({ id: u.id, prev: previous.get(u.id)!.previous_rank }))
          .filter((o) => o.id !== w.id && o.prev !== null && o.prev < wPrev)
          .map((o) => o.id)
          .sort();
        expect(passedIds).toEqual(expectedIds);
      }
    });
  });
});

describe('challengeScore', () => {
  it('är 0 för noll matcher', () => {
    expect(challengeScore(0, 0, 0)).toBe(0);
  });

  it('räknar (vinster + oavgjorda × 0,5) / matcher utan avrundning', () => {
    expect(challengeScore(2, 1, 1)).toBe(0.625);
    expect(challengeScore(1, 0, 2)).toBeCloseTo(1 / 3, 15);
    expect(challengeScore(0, 0, 3)).toBe(0);
  });
});

describe('compareChallengeStandings', () => {
  const s = (id: string, name: string, wins: number, draws: number, losses: number): ChallengeStanding => ({ id, name, wins, draws, losses });

  it('compareChallengeStandings: lika poäng och vinster ger deterministisk ordning och noll matcher rankas sist', () => {
    const rows: ChallengeStanding[] = [
      s('z0', 'Zero', 0, 0, 0),       // noll matcher
      s('y0', 'yara', 0, 0, 0),       // noll matcher
      s('l1', 'Loser', 0, 0, 4),      // 0 poäng men har spelat
      s('b2', 'anna', 2, 0, 2),       // 0,5, 2 vinster, lika namn som a1 → id
      s('a1', 'Anna', 2, 0, 2),
      s('c3', 'Cleo', 2, 0, 2),
      s('w4', 'Wiktor', 4, 0, 4),     // 0,5 men fler vinster
      s('t5', 'Top', 1, 0, 0),        // 1,0
    ];
    const expected = ['t5', 'w4', 'a1', 'b2', 'c3', 'l1', 'y0', 'z0'];
    expect([...rows].sort(compareChallengeStandings).map((r) => r.id)).toEqual(expected);
    // Samma resultat oavsett ingångsordning.
    expect([...rows].reverse().sort(compareChallengeStandings).map((r) => r.id)).toEqual(expected);
    expect([...rows.slice(3), ...rows.slice(0, 3)].sort(compareChallengeStandings).map((r) => r.id)).toEqual(expected);
    // Komparatorn är antisymmetrisk och ger 0 bara för samma post.
    for (const a of rows) for (const b of rows) {
      expect(compareChallengeStandings(a, b) < 0).toBe(compareChallengeStandings(b, a) > 0);
      if (a.id !== b.id) expect(compareChallengeStandings(a, b)).not.toBe(0);
    }
  });

  it('jämför poäng utan avrundning', () => {
    // 2/3 = 0,6667 avrundas till 0,667 och är därmed lika med 667/1000 i den gamla tabellen; här är 667/1000 högre.
    const a = s('a', 'Ada', 2, 0, 1);
    const b = s('b', 'Bo', 667, 0, 333);
    expect(compareChallengeStandings(a, b)).toBeGreaterThan(0);
    expect(compareChallengeStandings(b, a)).toBeLessThan(0);
  });

  it('lika poäng på olika sätt (oavgjorda mot vinster) avgörs av vinster', () => {
    const wins = s('a', 'Zed', 1, 0, 1);   // 0,5
    const draws = s('b', 'Ada', 0, 2, 0);  // 0,5 men inga vinster
    const mixed = s('c', 'Bo', 0, 2, 2);   // 0,25
    expect([draws, wins, mixed].sort(compareChallengeStandings).map((r) => r.id)).toEqual(['a', 'b', 'c']); // lika poäng: vinster går före namn
    const equalPoints = s('d', 'Ada', 0, 1, 1); // 0,25, 0 vinster
    expect(compareChallengeStandings(mixed, equalPoints)).toBeGreaterThan(0); // Bo efter Ada på namn
  });
});
