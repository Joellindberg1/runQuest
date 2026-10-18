/**
 * RUN-215 T5 — allSettled-resultat i schedulers sammanfattas och loggas.
 *
 * Tidigare kastades resultaten bort (challenge/event) eller räknades bara in i en info-rad (streak): ett nattjobb där
 * varje användare föll gav "✅ Recalculated 0/40". Nu loggas antalet fel som error, med orsakerna.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  crons: new Map<string, () => Promise<void>>(),
  settleChallenge: vi.fn(),
  retractChallengeReceived: vi.fn(),
  maybeCreateEvent: vi.fn(),
  getAllGroupIds: vi.fn(),
  getEventPool: vi.fn(),
  updateUserStreak: vi.fn(),
}));

vi.mock('node-cron', () => ({
  default: { schedule: (expr: string, cb: () => Promise<void>) => { h.crons.set(expr, cb); } },
}));
vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));
vi.mock('../../services/challengeService.js', () => ({ settleChallenge: h.settleChallenge }));
vi.mock('../../services/activityLog.js', () => ({ retractChallengeReceived: h.retractChallengeReceived }));
vi.mock('../../services/eventService.js', () => ({
  maybeCreateEvent: h.maybeCreateEvent,
  getAllGroupIds: h.getAllGroupIds,
  getEventPool: h.getEventPool,
  settleCompetitionEvents: vi.fn(),
  settleExpiredParticipationEvents: vi.fn(),
  activateScheduledEvents: vi.fn(),
  checkStormChaserForecast: vi.fn(),
}));
vi.mock('../../services/streakService.js', () => ({ StreakService: { updateUserStreak: h.updateUserStreak } }));

import { getSupabaseClient } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import { createFakeDb, type Row, type RecordedQuery } from '../../routes/__tests__/helpers/fakeDb.js';
import { autoDeclinePendingChallenges, startChallengeScheduler } from '../challengeScheduler.js';
import { startEventScheduler } from '../eventScheduler.js';
import { recalculateAllStreaks } from '../streakScheduler.js';

let errorSpy: ReturnType<typeof vi.spyOn>;
let infoSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  h.crons.clear();
  errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
  infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

function use(tables: Record<string, Row[]>, failWhen?: (q: RecordedQuery) => { message: string; code?: string; details?: string } | null) {
  const db = createFakeDb(tables, { failWhen });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return db;
}

const errorLines = () => errorSpy.mock.calls.map((c: unknown[]) => String(c[0]));
const infoLines = () => infoSpy.mock.calls.map((c: unknown[]) => String(c[0]));
const tick = async (expr: string) => { const cb = h.crons.get(expr); expect(cb, `cron ${expr}`).toBeDefined(); await cb!(); };

describe('streakScheduler', () => {
  const users = [{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }];

  it('logs the failure count as an error when users fail', async () => {
    use({ users });
    h.updateUserStreak.mockImplementation(async (id: string) => { if (id !== 'u2') throw new Error(`boom ${id}`); });

    await recalculateAllStreaks();

    expect(errorLines().some((l) => /StreakScheduler.*2 of 3/.test(l))).toBe(true);
    // orsakernas felkoder följer med i texten, aldrig meddelandena (de kan bära radvärden)
    const call = errorSpy.mock.calls.find((c: unknown[]) => /2 of 3/.test(String(c[0])))!;
    expect(String(call[0])).toContain('(Error)');
    expect(JSON.stringify(call)).not.toMatch(/boom/);
  });

  it('lyckad körning: bara info-raden, inget error', async () => {
    use({ users });
    h.updateUserStreak.mockResolvedValue(undefined);

    await recalculateAllStreaks();

    expect(errorSpy).not.toHaveBeenCalled();
    expect(infoLines().some((l) => /3\/3/.test(l))).toBe(true);
  });
});

describe('challengeScheduler', () => {
  it('settleEndedChallenges logs how many settles failed', async () => {
    use({ challenges: [{ id: 'c1', status: 'active', determine_at: '2000-01-01T00:00:00Z' }, { id: 'c2', status: 'active', determine_at: '2000-01-01T00:00:00Z' }] });
    h.settleChallenge.mockImplementation(async (id: string) => { if (id === 'c1') throw new Error('settle c1 failed'); });
    startChallengeScheduler();

    await tick('5 * * * *');

    expect(errorLines().some((l) => /ChallengeScheduler.*1 of 2/.test(l))).toBe(true);
  });

  it('autoDeclinePendingChallenges: återställningen av token/challenge_active kontrolleras — utmaningen raderas inte om den misslyckas', async () => {
    const old = new Date(Date.now() - 4 * 86400000).toISOString();
    const tables: Record<string, Row[]> = {
      challenges: [{ id: 'old1', status: 'pending', tier: 'minor', challenger_id: 'a', opponent_id: 'b', created_at: old }],
      user_challenge_tokens: [{ id: 't1', challenge_id: 'old1', sent_at: old }],
      users: [{ id: 'a', challenge_active: true }, { id: 'b', challenge_active: true }],
    };
    use(tables, (q) => (q.table === 'user_challenge_tokens' && q.mutation === 'update' ? { message: 'restore failed: secret', code: '42501' } : null));

    // Felet loggas en gång här, med sin kod; funktionen kastar inte vidare (tickens sammanfattning loggade annars samma fel igen).
    await expect(autoDeclinePendingChallenges()).resolves.toBeUndefined();

    expect(errorLines().filter((l) => /Auto-declining challenges: 1 of 1 failed \(42501\)/.test(l))).toHaveLength(1);
    expect(tables.challenges).toHaveLength(1);
    expect(h.retractChallengeReceived).not.toHaveBeenCalled();
  });

  it('auto-manage-tick: ett fel i auto-decline loggas med antal', async () => {
    const old = new Date(Date.now() - 4 * 86400000).toISOString();
    use(
      {
        challenges: [{ id: 'old1', status: 'pending', tier: 'minor', challenger_id: 'a', opponent_id: 'b', created_at: old }],
        user_challenge_tokens: [], users: [],
      },
      (q) => (q.table === 'users' && q.mutation === 'update' ? { message: 'reset failed: secret', code: '42501' } : null),
    );
    startChallengeScheduler();

    await tick('10 */6 * * *');

    expect(errorLines().filter((l) => /ChallengeScheduler.*1 of 1 failed \(42501\)/.test(l))).toHaveLength(1);
    expect(errorLines()).toHaveLength(1);
  });

  it('auto-start av legendary: ett misslyckat update kastas (och syns i tickens sammanfattning)', async () => {
    const old = new Date(Date.now() - 5 * 86400000).toISOString();
    const tables: Record<string, Row[]> = {
      challenges: [{ id: 'L1', status: 'pending', tier: 'legendary', duration_days: 3, legendary_sent_at: old }],
      user_challenge_tokens: [], users: [],
    };
    use(tables, (q) => (q.table === 'challenges' && q.mutation === 'update' ? { message: 'start failed: secret', code: '23514' } : null));
    startChallengeScheduler();

    await tick('10 */6 * * *');

    expect(errorLines().filter((l) => /Auto-starting legendary challenges: 1 of 1 failed \(23514\)/.test(l))).toHaveLength(1);
    expect(errorLines()).toHaveLength(1);
    expect(tables.challenges[0].status).toBe('pending');
  });

  describe('a database error in the auto-manage tick logs a meaningful code and no text', () => {
    const tables = (): Record<string, Row[]> => ({ challenges: [], user_challenge_tokens: [], users: [] });
    const readsFail = (failure: { message: string; code: string; details?: string }) => (q: RecordedQuery) => (q.table === 'challenges' && !q.mutation ? failure : null);
    const logged = () => JSON.stringify(errorSpy.mock.calls);

    it('names the Postgres code of a failed read, once per failing job and without the database message', async () => {
      use(tables(), readsFail({ message: 'canceling statement due to statement timeout (row 987654321, jane@example.com)', code: '57014' }));
      startChallengeScheduler();

      await tick('10 */6 * * *');

      const lines = errorLines();
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/Auto-manage tick: 2 of 2 failed \(57014\)/);
      expect(logged()).not.toMatch(/987654321|jane@example\.com|statement timeout/);
      expect(logged()).not.toMatch(/\((Error|unknown)\)/);
    });

    it('names the network cause when supabase-js gives an error without a code (the connection broke)', async () => {
      // What supabase-js returns instead of throwing when fetch fails: code '', no name, the cause only in the text.
      use(tables(), readsFail({
        message: 'TypeError: fetch failed',
        details: 'TypeError: fetch failed\n\nCaused by: Error: read ECONNRESET (ECONNRESET)\n    at jane@example.com',
        code: '',
      }));
      startChallengeScheduler();

      await tick('10 */6 * * *');

      const lines = errorLines();
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/Auto-manage tick: 2 of 2 failed \(ECONNRESET\)/);
      expect(logged()).not.toMatch(/jane@example\.com|\((Error|unknown)\)/);
    });
  });

  it('lyckad settle-tick: inget error', async () => {
    use({ challenges: [{ id: 'c1', status: 'active', determine_at: '2000-01-01T00:00:00Z' }] });
    h.settleChallenge.mockResolvedValue(undefined);
    startChallengeScheduler();

    await tick('5 * * * *');

    expect(h.settleChallenge).toHaveBeenCalledWith('c1');
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe('eventScheduler', () => {
  it('createForAllGroups logs how many groups failed', async () => {
    h.getAllGroupIds.mockResolvedValue(['g1', 'g2', 'g3']);
    h.getEventPool.mockResolvedValue({
      triggerChance: 1,
      members: [{ name: 'Hangover Run', weight: 1, condition: null, startHour: 0, endHour: 23, endMinute: 59, endDayOffset: 0 }],
    });
    h.maybeCreateEvent.mockImplementation(async (_n: string, groupId: string) => { if (groupId === 'g2') throw new Error('create g2 failed'); return true; });
    startEventScheduler();

    await tick('0 22 * * 5,6');

    expect(h.maybeCreateEvent).toHaveBeenCalledTimes(3);
    expect(errorLines().some((l) => /EventScheduler.*1 of 3/.test(l))).toBe(true);
  });

  it('inga fel: bara info', async () => {
    h.getAllGroupIds.mockResolvedValue(['g1']);
    h.getEventPool.mockResolvedValue({
      triggerChance: 1,
      members: [{ name: 'Hangover Run', weight: 1, condition: null, startHour: 0, endHour: 23, endMinute: 59, endDayOffset: 0 }],
    });
    h.maybeCreateEvent.mockResolvedValue(true);
    startEventScheduler();

    await tick('0 22 * * 5,6');

    expect(errorSpy).not.toHaveBeenCalled();
  });
});
