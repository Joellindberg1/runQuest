/**
 * Pack News-skrivpunkter i routes/challenges.ts (ADR 008 beslut 5):
 *  - POST /send → challenge_received
 *  - PUT /:id/respond (decline) och PUT /:id/withdraw → raden återkallas (retract)
 *  - PUT /:id/respond (accept) → challenge_accepted (ADR 011 beslut 7)
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { inspect } from 'node:util';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from '../../config/database.js';
import app from '../../app.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';
import { logger } from '../../utils/logger.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });
afterEach(() => { vi.clearAllMocks(); });

function use(tables: Record<string, Row[]>) {
  const db = createFakeDb(tables, { autoIds: true, numericIds: ['activity_log'] });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return db;
}

// Riktiga uuid: /send avvisar opponent_id som inte är ett uuid.
const SENDER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TARGET_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const sendTables = (): Record<string, Row[]> => ({
  activity_log: [],
  user_challenge_tokens: [{ id: 't1', user_id: SENDER_ID, tier: 'major', metric: 'km', duration_days: 5, reward_id: 'rw1', sent_at: null }],
  users: [{ id: SENDER_ID, current_level: 6, group_id: 'g1' }, { id: TARGET_ID, current_level: 7, group_id: 'g1' }],
  challenges: [],
  challenge_rewards: [{
    id: 'rw1', winner_type: 'multiplier_days', winner_delta: 0.2, winner_duration: 3,
    loser_type: 'multiplier_days', loser_delta: -0.1, loser_duration: 2,
  }],
});

describe('POST /api/challenges/send → challenge_received', () => {
  it('loggar exakt en challenge_received: utmanaren → motståndaren, utan att ändra svaret', async () => {
    const tables = sendTables();
    use(tables);
    const res = await server.request('POST', '/api/challenges/send', {
      token: mintToken({ user_id: SENDER_ID, group_id: 'g1' }),
      body: { token_id: 't1', opponent_id: TARGET_ID },
    });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, data: { challenge_id: 'gen-1' } });
    expect(tables.activity_log).toHaveLength(1);
    expect(tables.activity_log[0]).toMatchObject({
      group_id: 'g1', type: 'challenge_received', actor_user_id: SENDER_ID, target_user_id: TARGET_ID, is_backfill: false,
      dedupe_key: 'challenge_received:gen-1',
      payload: { challenge_id: 'gen-1', tier: 'major', metric: 'km', duration_days: 5 },
    });
  });

  it('news row and log line use the opponent id from the database, not the spelling in the request body', async () => {
    // Postgres compares uuid values case-insensitively, so a body with an upper-case opponent_id finds the row. The id that is
    // written to the news row (its recipient) and to the log must be the canonical one from the row, as the rest of the route uses.
    const tables = sendTables();
    const db = createFakeDb(tables, { autoIds: true, numericIds: ['activity_log'] });
    const caseInsensitiveUuids = {
      ...db.client,
      from: (table: string) => {
        const builder = db.client.from(table);
        const eq = builder.eq.bind(builder);
        builder.eq = (column: string, value: unknown) => eq(column, typeof value === 'string' ? value.toLowerCase() : value);
        return builder;
      },
    };
    vi.mocked(getSupabaseClient).mockReturnValue(caseInsensitiveUuids as any);
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});

    const res = await server.request('POST', '/api/challenges/send', {
      token: mintToken({ user_id: SENDER_ID, group_id: 'g1' }),
      body: { token_id: 't1', opponent_id: TARGET_ID.toUpperCase() },
    });

    expect(res.status).toBe(201);
    expect(tables.activity_log).toHaveLength(1);
    expect(tables.activity_log[0].target_user_id).toBe(TARGET_ID);
    const sent = infoSpy.mock.calls.map((c: unknown[]) => String(c[0])).find((l) => l.includes('Challenge sent'));
    expect(sent).toContain(`${SENDER_ID} → ${TARGET_ID} (`);
    infoSpy.mockRestore();
  });

  it('en trasig logg fäller inte utskicket (utmaningen skapas ändå, 201)', async () => {
    const tables = sendTables();
    const db = createFakeDb(tables, { autoIds: true, errors: { activity_log: { message: 'relation does not exist' } } });
    vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
    const res = await server.request('POST', '/api/challenges/send', {
      token: mintToken({ user_id: SENDER_ID, group_id: 'g1' }),
      body: { token_id: 't1', opponent_id: TARGET_ID },
    });
    expect(res.status).toBe(201);
    expect(tables.challenges).toHaveLength(1);
  });

  it('avvisat utskick (opponent i annan grupp) ger ingen rad', async () => {
    const tables = sendTables();
    tables.users[1].group_id = 'other-group';
    use(tables);
    const res = await server.request('POST', '/api/challenges/send', {
      token: mintToken({ user_id: SENDER_ID, group_id: 'g1' }),
      body: { token_id: 't1', opponent_id: TARGET_ID },
    });
    expect(res.status).toBe(400);
    expect(tables.activity_log).toHaveLength(0);
  });
});

const pendingTables = (): Record<string, Row[]> => ({
  activity_log: [
    { id: 1, dedupe_key: 'challenge_received:c1', type: 'challenge_received' },
    { id: 2, dedupe_key: 'challenge_received:c2', type: 'challenge_received' },
  ],
  challenges: [
    { id: 'c1', status: 'pending', tier: 'minor', challenger_id: 'a', opponent_id: 'b' },
    { id: 'c2', status: 'pending', tier: 'minor', challenger_id: 'x', opponent_id: 'y' },
  ],
  user_challenge_tokens: [{ id: 't1', challenge_id: 'c1', sent_at: '2026-10-05T10:00:00.000Z' }],
  users: [{ id: 'a', challenge_active: true }, { id: 'b', challenge_active: true }],
});

describe('återkallad/avböjd utmaning → challenge_received återkallas', () => {
  it('PUT /:id/respond decline tar bort raden för just den utmaningen', async () => {
    const tables = pendingTables();
    use(tables);
    const res = await server.request('PUT', '/api/challenges/c1/respond', {
      token: mintToken({ user_id: 'b', group_id: 'g1' }), body: { action: 'decline' },
    });
    expect(res.status).toBe(200);
    expect(tables.challenges.map((c) => c.id)).toEqual(['c2']);
    expect(tables.activity_log.map((r) => r.dedupe_key)).toEqual(['challenge_received:c2']);
  });

  it('PUT /:id/withdraw tar bort raden för just den utmaningen', async () => {
    const tables = pendingTables();
    use(tables);
    const res = await server.request('PUT', '/api/challenges/c1/withdraw', { token: mintToken({ user_id: 'a', group_id: 'g1' }) });
    expect(res.status).toBe(200);
    expect(tables.activity_log.map((r) => r.dedupe_key)).toEqual(['challenge_received:c2']);
  });

  it('misslyckad radering av utmaningen (decline) → raden i flödet står kvar', async () => {
    const tables = pendingTables();
    const db = createFakeDb(tables, { failWhen: (q) => (q.table === 'challenges' && q.mutation === 'delete' ? { message: 'delete failed' } : null) });
    vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
    const res = await server.request('PUT', '/api/challenges/c1/respond', {
      token: mintToken({ user_id: 'b', group_id: 'g1' }), body: { action: 'decline' },
    });
    expect(res.status).toBe(200);
    expect(tables.activity_log.map((r) => r.dedupe_key)).toEqual(['challenge_received:c1', 'challenge_received:c2']);
  });

  it('ett fel när raden återkallas loggas med bara koden och fäller inte decline', async () => {
    const tables = pendingTables();
    const db = createFakeDb(tables, {
      errors: { activity_log: { code: '42501', message: 'permission denied', details: 'SECRET-ROW-DETAIL' } as { message: string } },
    });
    vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
    const spies = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    try {
      const res = await server.request('PUT', '/api/challenges/c1/respond', {
        token: mintToken({ user_id: 'b', group_id: 'g1' }), body: { action: 'decline' },
      });
      expect(res.status).toBe(200);
      const logged = spies.flatMap((s) => s.mock.calls)
        .map((args: unknown[]) => args.map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 6 }))).join(' '))
        .join('\n');
      expect(logged).toContain('42501');
      expect(logged).not.toContain('SECRET-ROW-DETAIL');
      expect(logged).not.toContain('permission denied');
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });

  it('misslyckad radering av utmaningen (withdraw) → raden i flödet står kvar', async () => {
    const tables = pendingTables();
    const db = createFakeDb(tables, { failWhen: (q) => (q.table === 'challenges' && q.mutation === 'delete' ? { message: 'delete failed' } : null) });
    vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
    await server.request('PUT', '/api/challenges/c1/withdraw', { token: mintToken({ user_id: 'a', group_id: 'g1' }) });
    expect(tables.activity_log).toHaveLength(2);
  });

  it('accept lämnar raden kvar (utmaningen finns ju)', async () => {
    const tables = pendingTables();
    tables.challenges[0].duration_days = 3;
    use(tables);
    const res = await server.request('PUT', '/api/challenges/c1/respond', {
      token: mintToken({ user_id: 'b', group_id: 'g1' }), body: { action: 'accept' },
    });
    expect(res.status).toBe(200);
    expect(tables.activity_log).toHaveLength(2);
  });
});

// ─── accept → challenge_accepted ─────────────────────────────────────────────

const acceptTables = (): Record<string, Row[]> => ({
  activity_log: [{ id: 1, dedupe_key: 'challenge_received:c1', type: 'challenge_received' }],
  challenges: [{
    id: 'c1', status: 'pending', group_id: 'g1', tier: 'major', metric: 'km', duration_days: 5,
    challenger_id: 'a', opponent_id: 'b',
  }],
  users: [{ id: 'a', challenge_active: true }, { id: 'b', challenge_active: true }],
});

const respond = (action: 'accept' | 'decline', userId = 'b') =>
  server.request('PUT', '/api/challenges/c1/respond', { token: mintToken({ user_id: userId, group_id: 'g1' }), body: { action } });

const acceptedRows = (tables: Record<string, Row[]>) => tables.activity_log.filter((r) => r.type === 'challenge_accepted');

describe('PUT /api/challenges/:id/respond (accept) → challenge_accepted', () => {
  it('accept skriver exakt en challenge_accepted med utmanaren som mål och motståndaren som aktör', async () => {
    const tables = acceptTables();
    use(tables);
    const res = await respond('accept');

    expect(res.status).toBe(200);
    const rows = acceptedRows(tables);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      group_id: 'g1', type: 'challenge_accepted', actor_user_id: 'b', target_user_id: 'a',
      is_backfill: false, dedupe_key: 'challenge_accepted:c1',
    });
    // Utmaningens egen challenge_received lämnas orörd.
    expect(tables.activity_log.some((r) => r.dedupe_key === 'challenge_received:c1')).toBe(true);
  });

  it('payloaden bär challenge_id, tier, metric, duration_days och start_date', async () => {
    const tables = acceptTables();
    use(tables);
    const res = await respond('accept');

    const storedStart = tables.challenges[0].start_date;
    expect(storedStart).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    // Samma värde som routen lagrar på utmaningen och svarar med — aldrig ett separat uträknat datum.
    expect(res.body.data.start_date).toBe(storedStart);
    expect(acceptedRows(tables)[0].payload).toEqual({
      challenge_id: 'c1', tier: 'major', metric: 'km', duration_days: 5, start_date: storedStart,
    });
  });

  it('accept två gånger ger en rad (dedupe)', async () => {
    const tables = acceptTables();
    use(tables);
    expect((await respond('accept')).status).toBe(200);

    // Väg 1: den andra accepten når aldrig loggningen — utmaningen är redan active, så uppslaget (status = pending) ger 404.
    const again = await respond('accept');
    expect(again.status).toBe(404);
    expect(acceptedRows(tables)).toHaveLength(1);

    // Väg 2: når en accept loggningen igen (utmaningen åter pending, t.ex. en omkörning efter ett race) ger
    // dedupe_key challenge_accepted:<id> fortfarande bara en rad.
    tables.challenges[0].status = 'pending';
    expect((await respond('accept')).status).toBe(200);
    expect(acceptedRows(tables)).toHaveLength(1);
  });

  it('decline skriver ingen challenge_accepted', async () => {
    const tables = acceptTables();
    use(tables);
    const res = await respond('decline');
    expect(res.status).toBe(200);
    expect(acceptedRows(tables)).toHaveLength(0);
  });

  it('reverterad aktivering (flaggfel) skriver ingen rad', async () => {
    const tables = acceptTables();
    const db = createFakeDb(tables, {
      numericIds: ['activity_log'],
      failWhen: (q) => (q.table === 'users' && q.mutation === 'update' ? { message: 'flag update failed' } : null),
    });
    vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
    const res = await respond('accept');

    expect(res.status).toBe(500);
    expect(tables.challenges[0].status).toBe('pending');
    expect(acceptedRows(tables)).toHaveLength(0);
  });

  it('ett fel i loggningen får inte fälla accept', async () => {
    const tables = acceptTables();
    const db = createFakeDb(tables, {
      numericIds: ['activity_log'],
      errors: {
        activity_log: {
          code: '23514',
          message: 'violates check constraint "activity_log_type_check"',
          details: 'Failing row contains (c1, major, km, 5, SECRET-PAYLOAD-VALUE)',
        } as { message: string },
      },
    });
    vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
    const spies = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    try {
      const res = await respond('accept');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(tables.challenges[0].status).toBe('active');
      expect(tables.users.every((u) => u.challenge_active === true)).toBe(true);

      const logged = spies.flatMap((s) => s.mock.calls)
        .map((args: unknown[]) => args.map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 6 }))).join(' '))
        .join('\n');
      expect(logged).toContain('23514');
      expect(logged).not.toContain('SECRET-PAYLOAD-VALUE');
      expect(logged).not.toContain('activity_log_type_check');
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });

  it('utmaning utan group_id hoppar över loggningen utan att fälla accept', async () => {
    const tables = acceptTables();
    delete tables.challenges[0].group_id;
    use(tables);
    const spies = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    try {
      const res = await respond('accept');

      expect(res.status).toBe(200);
      expect(tables.challenges[0].status).toBe('active');
      expect(acceptedRows(tables)).toHaveLength(0);
      // Bara koden och utmaningens id loggas — ingen payload.
      const objects = spies.flatMap((s) => s.mock.calls).flat().filter((a: unknown) => a !== null && typeof a === 'object');
      expect(objects).toContainEqual({ code: 'missing_group_id', challengeId: 'c1' });
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });

  it('occurred_at är ett aktuellt ISO-datum, inte epok', async () => {
    const tables = acceptTables();
    use(tables);
    const before = Date.now();
    await respond('accept');
    const after = Date.now();

    const occurredAt = String(acceptedRows(tables)[0].occurred_at);
    expect(occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
    expect(Date.parse(occurredAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(occurredAt)).toBeLessThanOrEqual(after);
  });

  it('misslyckad aktivering skriver ingen rad och lämnar utmaningen pending', async () => {
    const tables = acceptTables();
    const db = createFakeDb(tables, {
      numericIds: ['activity_log'],
      failWhen: (q) => (q.table === 'challenges' && q.mutation === 'update' ? { message: 'activation failed' } : null),
    });
    vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
    const res = await respond('accept');

    expect(res.status).toBe(500);
    expect(tables.challenges[0].status).toBe('pending');
    expect(acceptedRows(tables)).toHaveLength(0);
  });

  describe('utmaningen försvinner eller ändras mellan läsningen och aktiveringen (decline/withdraw/auto-decline)', () => {
    const racing = (tables: Record<string, Row[]>, interfere: () => void) => {
      let fired = false;
      const db = createFakeDb(tables, {
        numericIds: ['activity_log'],
        // Körs precis innan aktiveringens update — efter routens läsning av den pending utmaningen.
        failWhen: (q) => {
          if (!fired && q.table === 'challenges' && q.mutation === 'update') { fired = true; interfere(); }
          return null;
        },
      });
      vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
    };

    it.each([
      ['raderas', (t: Record<string, Row[]>) => { t.challenges.length = 0; }],
      ['får en annan status', (t: Record<string, Row[]>) => { t.challenges[0].status = 'declined'; }],
    ])('utmaningen %s → 404, inga flaggor och ingen challenge_accepted', async (_name, mutate) => {
      const tables = acceptTables();
      tables.users.forEach((u) => { u.challenge_active = false; });
      racing(tables, () => mutate(tables));
      const res = await respond('accept');

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Challenge not found or already responded' });
      expect(tables.users.map((u) => u.challenge_active)).toEqual([false, false]);
      expect(acceptedRows(tables)).toHaveLength(0);
    });
  });
});
