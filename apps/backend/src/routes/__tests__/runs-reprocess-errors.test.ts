/**
 * RUN-215 T1 — reprocessRunsFromDate sväljer inte fel.
 *
 * Tidigare: läsningar kontrollerades inte (en trasig runs-läsning gav en tyst tidig return), uppdateringarna i
 * Promise.all kastade aldrig, och "✅ Reprocessed" loggades ändå. Samma mönster som RUN-157 (titelomräkningen).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));
vi.mock('../../utils/calculateUserTotals.js', () => ({ calculateUserTotals: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../services/eventService.js', () => ({
  checkEventQualification: vi.fn().mockResolvedValue(undefined),
  maybeCreateEvent: vi.fn(),
  activateScheduledEvents: vi.fn(),
  settleCompetitionEvents: vi.fn(),
  settleExpiredParticipationEvents: vi.fn(),
}));
vi.mock('../../services/xpConfig.js', async () => {
  const shared = await import('@runquest/shared');
  return {
    getXpConfig: vi.fn(async () => ({
      settings: shared.DEFAULT_ADMIN_SETTINGS,
      streak_multipliers: shared.DEFAULT_STREAK_MULTIPLIERS,
      meta: { settings_source: 'defaults', multipliers_source: 'defaults' },
    })),
    invalidateXpConfigCache: vi.fn(),
  };
});

import { getSupabaseClient } from '../../config/database.js';
import { calculateUserTotals } from '../../utils/calculateUserTotals.js';
import { logger } from '../../utils/logger.js';
import app from '../../app.js';
import { reprocessRunsFromDate } from '../runs.js';
import { createFakeDb, type Row, type RecordedQuery } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });

let infoSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});
  errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

const run = (over: Row = {}): Row => ({
  id: 'run-1', user_id: 'user-1', date: '2026-10-01', distance: 4, streak_day: 1, xp_gained: 0, ...over,
});

function use(failWhen?: (q: RecordedQuery) => { message: string } | null, tables: Record<string, Row[]> = {}) {
  const t: Record<string, Row[]> = { runs: [run(), run({ id: 'run-2', date: '2026-10-02' })], user_boosts: [], ...tables };
  const db = createFakeDb(t, { autoIds: true, failWhen });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return t;
}

const reprocessedLogged = () => infoSpy.mock.calls.some((c: unknown[]) => String(c[0]).includes('Reprocessed'));

describe('reprocessRunsFromDate — fel syns', () => {
  it('reprocess reports failure when a run update fails', async () => {
    use((q) => (q.table === 'runs' && q.mutation === 'update' ? { message: 'update failed' } : null));

    await expect(reprocessRunsFromDate('user-1', '2026-10-01')).rejects.toThrow(/update/i);
    expect(reprocessedLogged()).toBe(false);
  });

  it('en enda misslyckad rad-uppdatering räcker: övriga skrivs, felet kastas ändå', async () => {
    let n = 0;
    const tables = use((q) => (q.table === 'runs' && q.mutation === 'update' && ++n === 1 ? { message: 'row 1 failed' } : null));

    await expect(reprocessRunsFromDate('user-1', '2026-10-01')).rejects.toThrow(/1 of 2/);
    expect(tables.runs.filter((r) => r.xp_gained > 0)).toHaveLength(1);
  });

  it('läsfel på de berörda rundorna kastas (inte en tyst tidig return)', async () => {
    use((q) => (q.table === 'runs' && q.select === 'id, date, distance' ? { message: 'read failed' } : null));

    await expect(reprocessRunsFromDate('user-1', '2026-10-01')).rejects.toThrow(/read failed/);
    expect(reprocessedLogged()).toBe(false);
  });

  it('läsfel på föregående runda (streak-seed) kastas — annars räknas streaken från fel utgångspunkt', async () => {
    const tables = use((q) => (q.table === 'runs' && q.select === 'date, streak_day' ? { message: 'seed failed' } : null));

    await expect(reprocessRunsFromDate('user-1', '2026-10-02')).rejects.toThrow(/seed failed/);
    expect(tables.runs.every((r) => r.xp_gained === 0)).toBe(true);
  });

  it('läsfel på användarens boostar kastas — annars räknas XP om utan boosten', async () => {
    const tables = use((q) => (q.table === 'user_boosts' ? { message: 'boosts failed' } : null));

    await expect(reprocessRunsFromDate('user-1', '2026-10-01')).rejects.toThrow(/boosts failed/);
    expect(tables.runs.every((r) => r.xp_gained === 0)).toBe(true);
  });

  it('läsfel på förbrukade multiplier_runs-laddningar kastas', async () => {
    use(
      (q) => (q.table === 'runs' && q.select === 'id' ? { message: 'count failed' } : null),
      { user_boosts: [{ user_id: 'user-1', type: 'multiplier_runs', delta: 0.2, remaining: 3, created_at: '2026-09-01T10:00:00Z', expires_at: null }] },
    );

    await expect(reprocessRunsFromDate('user-1', '2026-10-01')).rejects.toThrow(/count failed/);
  });
});

describe('reprocessRunsFromDate — lyckad väg oförändrad', () => {
  it('uppdaterar alla rundor, loggar "Reprocessed" och kastar inte', async () => {
    const tables = use();

    await expect(reprocessRunsFromDate('user-1', '2026-10-01')).resolves.toBeUndefined();
    expect(tables.runs.map((r) => r.streak_day)).toEqual([1, 2]);
    expect(tables.runs.every((r) => r.xp_gained > 0)).toBe(true);
    expect(reprocessedLogged()).toBe(true);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('inga rundor att räkna om är inget fel', async () => {
    use(undefined, { runs: [] });
    await expect(reprocessRunsFromDate('user-1', '2026-10-01')).resolves.toBeUndefined();
  });
});

// Ett reprocess-fel ger 500, men totalerna räknas ändå om best-effort — annars lämnas data sämre än före RUN-215
// (då gick calculateUserTotals alltid).
const token = () => mintToken({ user_id: 'user-1', group_id: 'group-1' });
const reprocessUpdateFails = (q: RecordedQuery) => (q.table === 'runs' && q.mutation === 'update' ? { message: 'update failed' } : null);

describe('POST /api/runs — skrivfel i omräkningen ger 500, inte 201', () => {
  it('create run returns 500 when the reprocess update fails — totals still recalculated best-effort', async () => {
    use(reprocessUpdateFails, { runs: [] });

    const res = await server.request('POST', '/api/runs', { token: token(), body: { date: '2026-10-01', distance: 5 } });

    expect(res.status).toBe(500);
    expect(calculateUserTotals).toHaveBeenCalledWith('user-1');
  });

  it('lyckad POST oförändrad: 200 och totaler räknade', async () => {
    use(undefined, { runs: [] });
    const res = await server.request('POST', '/api/runs', { token: token(), body: { date: '2026-10-01', distance: 5 } });
    expect(res.status).toBe(200);
    expect(calculateUserTotals).toHaveBeenCalledWith('user-1');
  });
});

describe('PUT /api/runs/:id — reprocess-fel', () => {
  /** Rundans egen update (första) går igenom; omräkningens updates (efterföljande) faller. */
  const secondAndLaterUpdatesFail = () => {
    let n = 0;
    return (q: RecordedQuery) => (q.table === 'runs' && q.mutation === 'update' && ++n > 1 ? { message: 'update failed' } : null);
  };

  it('PUT returns 500 when the reprocess fails — totals still recalculated best-effort', async () => {
    use(secondAndLaterUpdatesFail(), { runs: [run({ source: 'manual' }), run({ id: 'run-2', date: '2026-10-02', source: 'manual' })] });

    const res = await server.request('PUT', '/api/runs/run-1', { token: token(), body: { distance: 9, date: '2026-10-01' } });

    expect(res.status).toBe(500);
    expect(calculateUserTotals).toHaveBeenCalledWith('user-1');
  });

  it('lyckad PUT oförändrad: 200', async () => {
    use(undefined, { runs: [run({ source: 'manual' })] });
    const res = await server.request('PUT', '/api/runs/run-1', { token: token(), body: { distance: 9, date: '2026-10-01' } });
    expect(res.status).toBe(200);
    expect(calculateUserTotals).toHaveBeenCalledWith('user-1');
  });
});

describe('DELETE /api/runs/:id — reprocess-fel', () => {
  it('DELETE returns 500 when the reprocess fails — totals still recalculated best-effort', async () => {
    const tables = use(reprocessUpdateFails, {
      runs: [run({ source: 'manual' }), run({ id: 'run-2', date: '2026-10-02', source: 'manual' })],
      event_entries: [],
    });

    const res = await server.request('DELETE', '/api/runs/run-1', { token: token() });

    expect(res.status).toBe(500);
    expect(tables.runs.map((r) => r.id)).toEqual(['run-2']); // raderingen skedde — därför ska totalerna ändå räknas om
    expect(calculateUserTotals).toHaveBeenCalledWith('user-1');
  });

  it('lyckad DELETE oförändrad: 200', async () => {
    use(undefined, { runs: [run({ source: 'manual' })], event_entries: [] });
    const res = await server.request('DELETE', '/api/runs/run-1', { token: token() });
    expect(res.status).toBe(200);
    expect(calculateUserTotals).toHaveBeenCalledWith('user-1');
  });
});
