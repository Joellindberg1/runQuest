/**
 * The "completed without boosts" alarms of settleChallenge (manual repair needed) as Sentry alerts. Real logger, faked Sentry transport.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from '../../config/database.js';
import { startFakeSentry, type FakeSentry } from '../../observability/__tests__/helpers/fakeSentry.js';
import { settleChallenge } from '../challengeService.js';
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

const fail = (message: string) => ({ message });
const bothFail = (q: RecordedQuery) => {
  if (q.table === 'user_boosts' && q.mutation === 'insert') return fail('boost insert failed');
  if (q.table === 'challenges' && q.mutation === 'update' && q.filters.some((f) => f.column === 'status' && f.value === 'completed')) return fail('release failed');
  return null;
};

function use(failWhen: (q: RecordedQuery) => { message: string } | null) {
  const db = createFakeDb(baseTables(), { numericIds: ['activity_log'], failWhen });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as never);
}

let sentry: FakeSentry;
beforeEach(() => {
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, method).mockImplementation(() => {});
  sentry = startFakeSentry();
});
afterEach(async () => {
  await sentry.stop();
  vi.restoreAllMocks();
});

describe('challenge repair alerts in sentry', () => {
  it('critical log lines reach sentry', async () => {
    use(bothFail);

    await expect(settleChallenge('c1')).rejects.toThrow();
    const sent = await sentry.flush();

    const critical = sent.filter((event) => event.tags?.alert === 'critical');
    expect(critical).toHaveLength(1);
    expect(critical[0]).toMatchObject({ level: 'fatal', tags: { alert: 'critical', source: 'challenge_repair' } });
    expect(critical[0].message).toContain('c1');
  });

  it('a failing challenge_active reset on top is a second alert', async () => {
    use((q) => (q.table === 'users' && q.mutation === 'update' ? fail('reset failed') : bothFail(q)));

    await expect(settleChallenge('c1')).rejects.toThrow();
    const sent = await sentry.flush();

    expect(sent.filter((event) => event.tags?.alert === 'critical')).toHaveLength(2);
  });

  it('a released claim (only the boost insert fails) sends no critical alert', async () => {
    use((q) => (q.table === 'user_boosts' && q.mutation === 'insert' ? fail('boost insert failed') : null));

    await expect(settleChallenge('c1')).rejects.toThrow();
    const sent = await sentry.flush();

    expect(sent.filter((event) => event.tags?.alert === 'critical')).toEqual([]);
  });
});
