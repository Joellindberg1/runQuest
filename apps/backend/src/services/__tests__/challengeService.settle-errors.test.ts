/**
 * RUN-215 T2 — settleChallenge sväljer inte fel efter claim.
 *
 * Tidigare: claim-felet, challenge_active-återställningen, W/D/L-uppdateringarna och boost-insertet kontrollerades
 * inte. Ett misslyckat boost-insert gav en "avgjord" utmaning utan boostar, och en trasig progress-läsning gav
 * 0 mot 0 — alltså oavgjort — som sparades som facit.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

// Spion runt den riktiga detektionen: "ett fel i detektionen" och "efter båda skrivningarna" kräver att testet når in i anropet.
vi.mock('@runquest/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@runquest/shared')>();
  return { ...actual, detectRankPasses: vi.fn(actual.detectRankPasses) };
});

import { detectRankPasses } from '@runquest/shared';
import { getSupabaseClient } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import { settleChallenge } from '../challengeService.js';
import { recordRankPassesForChallenge } from '../rankNews.js';
import { createFakeDb, type Row, type RecordedQuery } from '../../routes/__tests__/helpers/fakeDb.js';

function baseTables(): Record<string, Row[]> {
  return {
    activity_log: [],
    challenges: [{
      id: 'c1', group_id: 'g1', status: 'active', tier: 'major', metric: 'km', duration_days: 3,
      challenger_id: 'a', opponent_id: 'b', start_date: '2026-10-01', end_date: '2026-10-03',
      winner_type: 'multiplier_days', winner_delta: 0.2, winner_duration: 3,
      loser_type: 'multiplier_days', loser_delta: -0.1, loser_duration: 2,
      created_at: '2026-09-29T10:00:00.000Z', winner_id: null, outcome: null,
    }],
    users: [
      { id: 'a', wins: 0, draws: 0, losses: 0, challenge_active: true },
      { id: 'b', wins: 0, draws: 0, losses: 0, challenge_active: true },
    ],
    runs: [
      { id: 'r1', user_id: 'a', date: '2026-10-01', distance: 8 },
      { id: 'r2', user_id: 'a', date: '2026-10-02', distance: 7 },
      { id: 'r3', user_id: 'b', date: '2026-10-02', distance: 5 },
    ],
    user_boosts: [],
    user_challenge_tokens: [],
  };
}

function use(tables: Record<string, Row[]>, failWhen?: (q: RecordedQuery) => { message: string } | null) {
  const db = createFakeDb(tables, { numericIds: ['activity_log'], failWhen });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return db;
}

const hasOp = (q: RecordedQuery, op: string) => q.filters.some((f) => f.op === op);
const fail = (message: string, code?: string) => ({ message, ...(code ? { code } : {}) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

describe('settleChallenge — fel efter claim', () => {
  it('settleChallenge does not mark settled when boost insert fails', async () => {
    const tables = baseTables();
    use(tables, (q) => (q.table === 'user_boosts' && q.mutation === 'insert' ? fail('boost insert failed') : null));

    await expect(settleChallenge('c1')).rejects.toThrow(/boost/i);

    // Claimen släpps: utmaningen är active igen och schedulern tar den nästa varv.
    expect(tables.challenges[0]).toMatchObject({ status: 'active', winner_id: null, outcome: null });
    // Inget annat har delats ut, så omförsöket kan inte dubbelräkna.
    expect(tables.users.map((u) => [u.wins, u.losses, u.draws])).toEqual([[0, 0, 0], [0, 0, 0]]);
    expect(tables.activity_log).toHaveLength(0);
  });

  it('boost-insert som misslyckas OCH en claim som inte kan släppas ger ett fel som nämner båda', async () => {
    const tables = baseTables();
    use(tables, (q) => {
      if (q.table === 'user_boosts' && q.mutation === 'insert') return fail('boost insert failed: secret', '40001');
      if (q.table === 'challenges' && q.mutation === 'update' && hasOp(q, 'eq') && q.filters.some((f) => f.column === 'status' && f.value === 'completed')) {
        return fail('release failed: secret', '42501');
      }
      return null;
    });

    await expect(settleChallenge('c1')).rejects.toMatchObject({ code: '40001', message: expect.stringMatching(/Failed to create boosts for challenge c1.*could not be released either/) });
  });

  describe('boost-insert fails AND the claim cannot be released', () => {
    const bothFail = (q: RecordedQuery) => {
      if (q.table === 'user_boosts' && q.mutation === 'insert') return fail('boost insert failed: secret', '40001');
      if (q.table === 'challenges' && q.mutation === 'update' && q.filters.some((f) => f.column === 'status' && f.value === 'completed')) {
        return fail('release failed: secret', '42501');
      }
      return null;
    };

    it('resets challenge_active best-effort so the players are not locked out', async () => {
      const tables = baseTables();
      use(tables, bothFail);

      await expect(settleChallenge('c1')).rejects.toThrow();

      expect(tables.users.map((u) => u.challenge_active)).toEqual([false, false]);
      // W/D/L delas inte ut: det här är inget avgjort resultat för spelarna, bara ett fastlåst tillstånd som måste rättas manuellt.
      expect(tables.users.map((u) => [u.wins, u.losses, u.draws])).toEqual([[0, 0, 0], [0, 0, 0]]);
    });

    it('logs a KRITISK line with the challenge id for manual repair', async () => {
      use(baseTables(), bothFail);

      await expect(settleChallenge('c1')).rejects.toThrow();

      const critical = vi.mocked(logger.error).mock.calls.map((c: unknown[]) => String(c[0])).filter((l) => /KRITISK/.test(l));
      expect(critical).toHaveLength(1);
      expect(critical[0]).toContain('c1');
    });

    it('a failing challenge_active reset on top is still reported (and does not mask the original error)', async () => {
      const tables = baseTables();
      use(tables, (q) => (q.table === 'users' && q.mutation === 'update' ? fail('reset failed') : bothFail(q)));

      await expect(settleChallenge('c1')).rejects.toMatchObject({ code: '40001', message: expect.stringContaining('Failed to create boosts for challenge c1') });
      expect(vi.mocked(logger.error).mock.calls.some((c: unknown[]) => /KRITISK/.test(String(c[0])))).toBe(true);
    });

    it('a released claim (only the boost insert fails) logs no KRITISK line and leaves challenge_active alone', async () => {
      const tables = baseTables();
      use(tables, (q) => (q.table === 'user_boosts' && q.mutation === 'insert' ? fail('boost insert failed') : null));

      await expect(settleChallenge('c1')).rejects.toThrow();

      expect(vi.mocked(logger.error).mock.calls.some((c: unknown[]) => /KRITISK/.test(String(c[0])))).toBe(false);
      expect(tables.users.map((u) => u.challenge_active)).toEqual([true, true]);
    });
  });

  it('settleChallenge surfaces a failed W/D/L update', async () => {
    const tables = baseTables();
    use(tables, (q) => (q.table === 'users' && q.mutation === 'update' && hasOp(q, 'eq') ? fail('wdl failed: secret', '40P01') : null));

    await expect(settleChallenge('c1')).rejects.toMatchObject({ code: '40P01', message: expect.stringContaining('W/D/L update failed (40P01)') });
    // Boostarna är redan utdelade — avgörandet står kvar som completed (att släppa det skulle dubbelräkna vid omförsök).
    expect(tables.challenges[0].status).toBe('completed');
    expect(tables.user_boosts).toHaveLength(2);
  });

  it('settleChallenge surfaces a failed challenge_active reset', async () => {
    const tables = baseTables();
    use(tables, (q) => (q.table === 'users' && q.mutation === 'update' && hasOp(q, 'in') ? fail('reset failed: secret', '42501') : null));

    await expect(settleChallenge('c1')).rejects.toThrow(/challenge_active/);
  });

  it('ett fel i claimen kastas (inte en tyst return som ser ut som "redan avgjord")', async () => {
    const tables = baseTables();
    use(tables, (q) => (q.table === 'challenges' && q.mutation === 'update' ? fail('claim failed: secret', '55P03') : null));

    await expect(settleChallenge('c1')).rejects.toMatchObject({ code: '55P03', message: 'Failed to claim challenge c1 for settling' });
    expect(tables.challenges[0].status).toBe('active');
    expect(tables.user_boosts).toHaveLength(0);
  });

  it('en trasig progress-läsning avgör inte utmaningen som 0–0-oavgjort', async () => {
    const tables = baseTables();
    use(tables, (q) => (q.table === 'runs' ? fail('runs read failed: secret', '57014') : null));

    await expect(settleChallenge('c1')).rejects.toMatchObject({ code: '57014', message: expect.not.stringContaining('secret') });
    expect(tables.challenges[0].status).toBe('active');
    expect(tables.users.map((u) => u.draws)).toEqual([0, 0]);
  });

  it('en trasig läsning av utmaningen själv kastas, men "finns inte" är fortfarande en tyst return', async () => {
    const broken = baseTables();
    use(broken, (q) => (q.table === 'challenges' && q.select ? fail('read failed: secret', '08006') : null));
    await expect(settleChallenge('c1')).rejects.toMatchObject({ code: '08006', message: 'Failed to read challenge c1 for settling' });

    const missing = baseTables();
    use(missing);
    await expect(settleChallenge('nope')).resolves.toBeUndefined();
  });
});

describe('settleChallenge — lyckad väg oförändrad', () => {
  it('vinnare: completed, boostar åt båda, W/L, news-rad', async () => {
    const tables = baseTables();
    use(tables);

    await expect(settleChallenge('c1')).resolves.toBeUndefined();

    expect(tables.challenges[0]).toMatchObject({ status: 'completed', outcome: 'challenger_wins', winner_id: 'a', challenger_final_value: 15, opponent_final_value: 5 });
    expect(tables.users).toEqual([
      expect.objectContaining({ id: 'a', wins: 1, losses: 0, challenge_active: false }),
      expect.objectContaining({ id: 'b', wins: 0, losses: 1, challenge_active: false }),
    ]);
    expect(tables.user_boosts.map((b) => [b.user_id, b.outcome, b.delta])).toEqual([['a', 'winner', 0.2], ['b', 'loser', -0.1]]);
    expect(tables.activity_log).toHaveLength(1);
  });

  it('oavgjort: draws räknas, inga boostar', async () => {
    const tables = baseTables();
    tables.runs = [];
    use(tables);

    await expect(settleChallenge('c1')).resolves.toBeUndefined();

    expect(tables.challenges[0]).toMatchObject({ status: 'completed', outcome: 'draw' });
    expect(tables.users.map((u) => u.draws)).toEqual([1, 1]);
    expect(tables.user_boosts).toHaveLength(0);
  });

  it('redan avgjord → ingen dubbel utdelning', async () => {
    const tables = baseTables();
    use(tables);
    await settleChallenge('c1');
    await settleChallenge('c1');

    expect(tables.user_boosts).toHaveLength(2);
    expect(tables.users.map((u) => u.wins + u.losses)).toEqual([1, 1]);
  });
});

describe('settleChallenge — rank_passed (challenge_points)', () => {
  const NOW = new Date('2026-10-15T10:00:00.000Z'); // 12:00 i Stockholm
  const TODAY = '2026-10-15';

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => { vi.useRealTimers(); });

  const member = (id: string, name: string, wins: number, draws: number, losses: number): Row => (
    { id, name, group_id: 'g1', wins, draws, losses, challenge_active: true, created_at: '2026-01-01T08:00:00.000Z' }
  );
  /** a (Anna) utmanar b (Bertil). Utan `draw` vinner a med 15 mot 5 km; med `draw` har ingen sprungit. */
  function world(users: Row[], draw = false): Record<string, Row[]> {
    const tables = baseTables();
    tables.users = users;
    if (draw) tables.runs = [];
    return tables;
  }
  const rankRows = (t: Record<string, Row[]>) => t.activity_log.filter((r) => r.type === 'rank_passed');
  const pairs = (t: Record<string, Row[]>) => rankRows(t).map((r) => [r.actor_user_id, r.target_user_id]).sort();
  const passers = () => vi.mocked(detectRankPasses).mock.calls.map((c) => (c[0] as { passerId: string }).passerId);

  it('avgörandet skriver rank_passed (challenge_points) en gång när vinnaren tar en plats', async () => {
    // Anna har inte spelat (0-0-0 → 1-0-0) och ligger bakom Cecilia (1-1-0, 0,75) vid dygnsskiftet, men före henne efter avgörandet.
    const t = world([member('a', 'Anna', 0, 0, 0), member('b', 'Bertil', 0, 0, 0), member('c', 'Cecilia', 1, 1, 0)]);
    use(t);

    await settleChallenge('c1');

    expect(rankRows(t)).toHaveLength(1);
    expect(rankRows(t)[0]).toMatchObject({
      type: 'rank_passed', group_id: 'g1', actor_user_id: 'a', target_user_id: 'c', is_backfill: false,
      occurred_at: NOW.toISOString(), dedupe_key: `rank_passed:challenge_points:a:c:${TODAY}`,
    });
    expect(rankRows(t)[0].payload).toEqual({ measure: 'challenge_points', passer_rank: 1, passed_rank: 2 });
    expect(t.activity_log.filter((r) => r.type === 'challenge_won')).toHaveLength(1);
  });

  it('omkörning av samma avgörande ger ingen dubblett', async () => {
    const t = world([member('a', 'Anna', 0, 0, 0), member('b', 'Bertil', 0, 0, 0), member('c', 'Cecilia', 1, 1, 0)]);
    use(t);
    await settleChallenge('c1');

    await settleChallenge('c1'); // redan avgjord: återvänder tidigt
    await recordRankPassesForChallenge('c1'); // överlappande instans / ny körning av själva skrivningen
    await recordRankPassesForChallenge('c1');

    expect(rankRows(t)).toHaveLength(1);
  });

  it('en förlorare som faller under någon ger ingen rad åt den andra deltagaren', async () => {
    // Bertil (3-0-1, 0,75 → 3-0-2, 0,6) faller under Cecilia (0,7). Anna (0-0-3 → 1-0-3, 0,25) tar ingen plats av någon.
    const t = world([member('a', 'Anna', 0, 0, 3), member('b', 'Bertil', 3, 0, 1), member('c', 'Cecilia', 7, 0, 3)]);
    use(t);

    await settleChallenge('c1');

    expect(t.users.map((u) => [u.id, u.wins, u.losses])).toEqual([['a', 1, 3], ['b', 3, 2], ['c', 7, 3]]);
    expect(rankRows(t)).toHaveLength(0);
    expect(passers()).toEqual(['a']); // förloraren och de som inte deltog körs aldrig
  });

  it('oavgjort kan ge rader åt båda deltagarna', async () => {
    // Anna 0-0-2 → 0-1-2 (0,167), Bertil 0-0-1 → 0-1-1 (0,25), Cecilia 1-0-9 (0,1). Bertil tar sig förbi både Anna (som låg före på namn) och Cecilia.
    const t = world([member('a', 'Anna', 0, 0, 2), member('b', 'Bertil', 0, 0, 1), member('c', 'Cecilia', 1, 0, 9)], true);
    use(t);

    await settleChallenge('c1');

    expect(t.activity_log.filter((r) => r.type === 'challenge_draw')).toHaveLength(1);
    expect(pairs(t)).toEqual([['a', 'c'], ['b', 'a'], ['b', 'c']]);
    expect(passers().sort()).toEqual(['a', 'b']);
    const byPair = Object.fromEntries(rankRows(t).map((r) => [`${r.actor_user_id}>${r.target_user_id}`, r.payload]));
    expect(byPair['b>a']).toEqual({ measure: 'challenge_points', passer_rank: 1, passed_rank: 2 });
    expect(byPair['a>c']).toEqual({ measure: 'challenge_points', passer_rank: 2, passed_rank: 3 });
  });

  it('ett fel i detektionen kastar aldrig och ändrar inte utfallet', async () => {
    const t = world([member('a', 'Anna', 0, 0, 0), member('b', 'Bertil', 0, 0, 0), member('c', 'Cecilia', 1, 1, 0)]);
    use(t);
    vi.mocked(detectRankPasses).mockImplementationOnce(() => { throw new Error('secret-detector-detail'); });

    await expect(settleChallenge('c1')).resolves.toBeUndefined();

    expect(t.challenges[0]).toMatchObject({ status: 'completed', outcome: 'challenger_wins', winner_id: 'a' });
    expect(t.users.map((u) => [u.id, u.wins, u.losses, u.challenge_active])).toEqual([['a', 1, 0, false], ['b', 0, 1, false], ['c', 1, 0, true]]);
    expect(t.user_boosts).toHaveLength(2);
    expect(t.activity_log.filter((r) => r.type === 'challenge_won')).toHaveLength(1);
    expect(rankRows(t)).toHaveLength(0);
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain('secret');

    // Ett delfel efter claimen kastas fortfarande, trots att detektionen också fallerar: kastet från postClaimErrors stoppas aldrig av den.
    const t2 = world([member('a', 'Anna', 0, 0, 0), member('b', 'Bertil', 0, 0, 0), member('c', 'Cecilia', 1, 1, 0)]);
    use(t2, (q) => (q.table === 'users' && q.mutation === 'update' && hasOp(q, 'in') ? fail('reset failed') : null));
    vi.mocked(detectRankPasses).mockImplementationOnce(() => { throw new Error('secret-detector-detail'); });
    await expect(settleChallenge('c1')).rejects.toThrow(/challenge_active/);
  });

  it('ett delfel efter claimen stoppar inte detektionen och döljs inte av den', async () => {
    const t = world([member('a', 'Anna', 0, 0, 0), member('b', 'Bertil', 0, 0, 0), member('c', 'Cecilia', 1, 1, 0)]);
    use(t, (q) => (q.table === 'users' && q.mutation === 'update' && hasOp(q, 'in') ? fail('reset failed') : null));

    await expect(settleChallenge('c1')).rejects.toThrow(/challenge_active/);

    expect(pairs(t)).toEqual([['a', 'c']]);
  });

  // Räknarna är skilda från noll med flit: med 0-0-0 skulle den inre vakten i rankNews (negativt "före") stoppa detektionen ändå
  // och maskera att settleChallenge själv hoppar över anropet.
  const failsFor = (id: string) => (q: RecordedQuery) => (
    q.table === 'users' && q.mutation === 'update' && hasOp(q, 'eq') && q.filters.some((f) => f.value === id) ? fail('wdl failed') : null
  );

  it('misslyckad W/D/L-uppdatering ger ingen rank_passed', async () => {
    // Vinnarens skrivning faller: Zelda står kvar på 5-0-0. Utan hoppet skulle hennes oskrivna räknare ändå läsas som ett lyft
    // 4 → 5 förbi Aaron (4-0-0), alltså en falsk "Zelda passerade Aaron".
    const t = world([member('a', 'Zelda', 5, 0, 0), member('b', 'Bertil', 0, 0, 1), member('c', 'Aaron', 4, 0, 0)]);
    use(t, failsFor('a'));

    await expect(settleChallenge('c1')).rejects.toThrow(/W\/D\/L/);

    expect(t.users.find((u) => u.id === 'a')!.wins).toBe(5);
    expect(rankRows(t)).toHaveLength(0);
    expect(detectRankPasses).not.toHaveBeenCalled();
  });

  it('misslyckad W/D/L-uppdatering för förloraren ger ingen rank_passed', async () => {
    // Vinnarens skrivning lyckas (3-0-1 → 4-0-1 och förbi Aaron 7-0-2), men förlorarens faller: slutläget är inte komplett.
    const t = world([member('a', 'Zelda', 3, 0, 1), member('b', 'Bertil', 0, 0, 1), member('c', 'Aaron', 7, 0, 2)]);
    use(t, failsFor('b'));

    await expect(settleChallenge('c1')).rejects.toThrow(/W\/D\/L/);

    expect(t.users.find((u) => u.id === 'a')!.wins).toBe(4);
    expect(rankRows(t)).toHaveLength(0);
    expect(detectRankPasses).not.toHaveBeenCalled();
  });

  it('misslyckad läsning av W/D/L ger ingen rank_passed', async () => {
    const t = world([member('a', 'Zelda', 5, 0, 0), member('b', 'Bertil', 0, 0, 1), member('c', 'Aaron', 4, 0, 0)]);
    use(t, (q) => (q.table === 'users' && q.select === 'id, wins, draws, losses' ? fail('wdl read failed') : null));

    await expect(settleChallenge('c1')).rejects.toThrow(/W\/D\/L/);

    expect(rankRows(t)).toHaveLength(0);
    expect(detectRankPasses).not.toHaveBeenCalled();
  });

  it('ingen rank_passed när avgörandets egen loggrad inte skrevs', async () => {
    const t = world([member('a', 'Anna', 0, 0, 0), member('b', 'Bertil', 0, 0, 0), member('c', 'Cecilia', 1, 1, 0)]);
    use(t, (q) => (q.table === 'activity_log' && q.mutation === 'upsert' ? fail('log write failed') : null));

    await expect(settleChallenge('c1')).resolves.toBeUndefined();

    expect(t.activity_log).toHaveLength(0);
    expect(detectRankPasses).not.toHaveBeenCalled();
  });

  it('detektionen körs först när båda deltagarnas W/D/L är skrivna, även med motståndaren före vinnaren i skrivordningen', async () => {
    // b (förloraren) ligger före a (vinnaren) i tabellen och skrivs därför först.
    const t = world([member('b', 'Bertil', 0, 0, 0), member('a', 'Anna', 0, 0, 0), member('c', 'Cecilia', 1, 1, 0)]);
    const db = use(t);
    const seen: Array<Array<[string, number, number]>> = [];
    const actual = (await vi.importActual<typeof import('@runquest/shared')>('@runquest/shared')).detectRankPasses;
    vi.mocked(detectRankPasses).mockImplementationOnce((input) => {
      seen.push(t.users.filter((u) => u.id !== 'c').map((u) => [u.id, u.wins, u.losses]).sort() as Array<[string, number, number]>);
      return actual(input);
    });

    await settleChallenge('c1');

    expect(seen).toEqual([[['a', 1, 0], ['b', 0, 1]]]);
    const lastWdlWrite = Math.max(...db.queries.map((q, i) => (q.table === 'users' && q.mutation === 'update' && hasOp(q, 'eq') ? i : -1)));
    const firstRead = db.queries.findIndex((q) => q.table === 'activity_log' && q.select !== null && q.mutation === undefined);
    expect(firstRead).toBeGreaterThan(lastWdlWrite);
    expect(pairs(t)).toEqual([['a', 'c']]);
  });
});
