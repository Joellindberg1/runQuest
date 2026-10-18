/**
 * calculateUserTotals loggar och rapporterar bara en felkod när databasen eller ett delsteg felar, aldrig hela felobjektet eller
 * meddelandet: ett PostgREST-fel kan bära radvärden (e-post, constraint-namn) och blir via Sentry-kopplingen en händelse.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { inspect } from 'node:util';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

const mocks = vi.hoisted(() => ({
  getLevelFromXP: vi.fn(async (xp: number) => (xp >= 50 ? 2 : 1)),
  evaluateBadges: vi.fn(async () => null),
  processAllUsersTitles: vi.fn(async () => undefined),
  processUserTitlesAfterRun: vi.fn(async () => undefined),
}));
vi.mock('../../services/levelService.js', () => ({ getLevelFromXP: mocks.getLevelFromXP }));
vi.mock('../../services/challengeService.js', () => ({ reconcileTokensForLevel: vi.fn(async () => undefined) }));
vi.mock('../../services/badgeService.js', () => ({ evaluateBadges: mocks.evaluateBadges }));
vi.mock('../../services/enhancedTitleService.js', () => ({
  EnhancedTitleService: class { processAllUsersTitles = mocks.processAllUsersTitles; processUserTitlesAfterRun = mocks.processUserTitlesAfterRun; },
}));

import { getSupabaseClient } from '../../config/database.js';
import { calculateUserTotals } from '../calculateUserTotals.js';
import { createFakeDb, type Row, type RecordedQuery } from '../../routes/__tests__/helpers/fakeDb.js';
import { startFakeSentry, type FakeSentry } from '../../observability/__tests__/helpers/fakeSentry.js';

const LEAK = 'LEAKMARKER users_email_key jane.doe@example.com';
const dbError = () => ({ message: `duplicate key value violates unique constraint "${LEAK}"`, details: `Key (email)=(${LEAK}) already exists.`, code: '23505' });
const thrown = () => Object.assign(new Error(`socket hang up near ${LEAK}`), { code: 'ECONNRESET' });

const tables = (groupId: string | null = 'g1'): Record<string, Row[]> => ({
  activity_log: [],
  users: [{ id: 'u1', group_id: groupId, event_xp: 0, current_level: 1, total_km: 0, total_xp: 10, current_streak: 0, longest_streak: 0 }],
  runs: [{ id: 'r1', user_id: 'u1', date: '2020-01-01', distance: 10, xp_gained: 60 }],
});

const totalsRead = (q: RecordedQuery) => q.table === 'runs' && q.select !== 'date';
const totalsWrite = (q: RecordedQuery) => q.table === 'users' && q.mutation === 'update';

let spies: Array<ReturnType<typeof vi.spyOn>>;
let sentry: FakeSentry;
beforeEach(() => {
  vi.clearAllMocks();
  spies = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
  sentry = startFakeSentry();
});
afterEach(async () => {
  await sentry.stop();
  vi.restoreAllMocks();
});

const logged = () => spies.flatMap((s) => s.mock.calls).map((args: unknown[]) => args.map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 6 }))).join(' ')).join('\n');
const loggedObjects = () => spies.flatMap((s) => s.mock.calls).flat().filter((a: unknown) => a !== null && typeof a === 'object');

function useDb(groupId: string | null, options: Parameters<typeof createFakeDb>[1] = {}) {
  const db = createFakeDb(tables(groupId), { numericIds: ['activity_log'], ...options });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
}

async function expectOnlyTheCode(code: string) {
  const out = logged();
  expect(out).toContain(code);
  expect(out).not.toContain('LEAKMARKER');
  expect(out).not.toContain('users_email_key');
  expect(loggedObjects().some((o: any) => o instanceof Error || 'message' in o || 'stack' in o || 'details' in o)).toBe(false);
  const events = JSON.stringify(await sentry.drain());
  expect(events).toContain(code);
  expect(events).not.toContain('LEAKMARKER');
  expect(events).not.toContain('users_email_key');
  expect(events).not.toContain('jane.doe@example.com');
}

describe('calculateUserTotals when the database returns an error', () => {
  it.each([
    ['the runs read', 'g1', { failWhen: (q: RecordedQuery) => (totalsRead(q) ? dbError() : null) }],
    ['the totals write', 'g1', { failWhen: (q: RecordedQuery) => (totalsWrite(q) ? dbError() : null) }],
    ['the title leaderboard refresh', 'g1', { rpc: { update_all_title_leaderboards: () => ({ error: dbError() }) } }],
    ['the title leaderboard refresh without a group', null, { rpc: { update_all_title_leaderboards: () => ({ error: dbError() }) } }],
  ])('logs and reports only the error code (%s)', async (_label, groupId, options) => {
    useDb(groupId, options as never);
    await expect(calculateUserTotals('u1')).resolves.toBeUndefined();
    await expectOnlyTheCode('23505');
  });
});

describe('calculateUserTotals when a step throws', () => {
  it.each([
    ['the badge evaluation', 'g1', () => mocks.evaluateBadges.mockRejectedValueOnce(thrown())],
    ['the group title run', 'g1', () => mocks.processAllUsersTitles.mockRejectedValueOnce(thrown())],
    ['the own title run', null, () => mocks.processUserTitlesAfterRun.mockRejectedValueOnce(thrown())],
    ['the level lookup', 'g1', () => mocks.getLevelFromXP.mockRejectedValueOnce(thrown())],
  ])('logs and reports only the error code (%s)', async (_label, groupId, arrange) => {
    arrange();
    useDb(groupId);
    await expect(calculateUserTotals('u1')).resolves.toBeUndefined();
    await expectOnlyTheCode('ECONNRESET');
  });
});
