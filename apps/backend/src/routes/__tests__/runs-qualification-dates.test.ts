/**
 * POST/PUT/DELETE /api/runs — i9 data-spår (open-assumptions backend-frågor 0 och 7):
 *  0. Datumvalideringen jämför Stockholm-dagen, inte serverns UTC-dag.
 *  7. PUT anropar checkEventQualification efter omräkningen (fire-and-forget); DELETE gör det inte
 *     (en radering kan inte skapa en kvalificering och eventService saknar avkvalificering).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  testDatabaseConnection: vi.fn(),
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
import { checkEventQualification } from '../../services/eventService.js';
import app from '../../app.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });
beforeEach(() => { vi.clearAllMocks(); vi.mocked(checkEventQualification).mockResolvedValue(undefined); });
afterEach(() => { vi.useRealTimers(); });

/** Fejka bara Date (inte timers) — HTTP-servern i testet behöver riktiga setTimeout/setImmediate. */
function at(iso: string) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
}

const run = (over: Row = {}): Row => ({
  id: 'run-1', user_id: 'user-1', date: '2026-10-01', distance: 4, streak_day: 1, xp_gained: 20, ...over,
});

function use(tables: Record<string, Row[]> = {}) {
  const t: Record<string, Row[]> = { runs: [run()], user_boosts: [], ...tables };
  const db = createFakeDb(t, { autoIds: true });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return t;
}

const token = (over: { user_id?: string; group_id?: string | null } = {}) => mintToken({ user_id: 'user-1', group_id: 'group-1', ...over });
const post = (body: unknown) => server.request('POST', '/api/runs', { token: token(), body });
const put = (id: string, body: unknown, over = {}) => server.request('PUT', `/api/runs/${id}`, { token: token(over), body });
const del = (id: string, over = {}) => server.request('DELETE', `/api/runs/${id}`, { token: token(over) });

// ─── Backend-fråga 0: Stockholm-dagen ────────────────────────────────────────

describe('datumvalidering mot Stockholm-dagen (POST)', () => {
  it('00:30 svensk sommartid (22:30 UTC dagen innan): dagens svenska datum accepteras', async () => {
    at('2026-10-04T22:30:00.000Z'); // = 2026-10-05 00:30 CEST; serverns UTC-"idag" är 2026-10-04
    use();
    const res = await post({ date: '2026-10-05', distance: 5 });
    expect(res.status).toBe(200);
  });

  it('00:30 svensk vintertid (23:30 UTC dagen innan): dagens svenska datum accepteras', async () => {
    at('2026-01-14T23:30:00.000Z'); // = 2026-01-15 00:30 CET
    use();
    expect((await post({ date: '2026-01-15', distance: 5 })).status).toBe(200);
  });

  it('00:30 svensk tid: morgondagens datum är fortfarande framtid → 400', async () => {
    at('2026-10-04T22:30:00.000Z');
    use();
    const res = await post({ date: '2026-10-06', distance: 5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/future dates/i);
  });

  it('klockan 22:00 UTC = 00:00 svensk sommartid: den nya dagen gäller direkt', async () => {
    at('2026-10-05T22:00:00.000Z'); // = 2026-10-06 00:00 CEST
    use();
    expect((await post({ date: '2026-10-06', distance: 5 })).status).toBe(200);
    expect((await post({ date: '2026-10-07', distance: 5 })).status).toBe(400);
  });

  it('23:30 svensk tid (21:30 UTC): dagens datum ok, morgondagens nekas', async () => {
    at('2026-10-05T21:30:00.000Z');
    use();
    expect((await post({ date: '2026-10-05', distance: 5 })).status).toBe(200);
    expect((await post({ date: '2026-10-06', distance: 5 })).status).toBe(400);
  });

  it('mitt på dagen: oförändrat — idag ok, imorgon nekas, igår ok', async () => {
    at('2026-10-05T10:00:00.000Z');
    use();
    expect((await post({ date: '2026-10-05', distance: 5 })).status).toBe(200);
    expect((await post({ date: '2026-10-04', distance: 5 })).status).toBe(200);
    expect((await post({ date: '2026-10-06', distance: 5 })).status).toBe(400);
  });

  it('tidpunkt med klockslag omräknas till sin Stockholm-dag', async () => {
    at('2026-10-04T22:30:00.000Z'); // 00:30 CEST 5 okt
    use();
    expect((await post({ date: '2026-10-05T00:10:00+02:00', distance: 5 })).status).toBe(200);
    expect((await post({ date: '2026-10-06T00:10:00+02:00', distance: 5 })).status).toBe(400);
  });

  it('gränserna för äldsta datum är oförändrade (kalenderdag)', async () => {
    at('2026-10-05T10:00:00.000Z');
    use();
    expect((await post({ date: '2025-06-01', distance: 5 })).status).toBe(200);
    const early = await post({ date: '2025-05-31', distance: 5 });
    expect(early.status).toBe(400);
    expect(early.body.error).toMatch(/before June 1, 2025/i);
  });

  it('ogiltiga datum → 400 "Invalid date"', async () => {
    at('2026-10-05T10:00:00.000Z');
    use();
    for (const bad of ['not-a-date', '2026-02-30', '2026-13-01']) {
      const res = await post({ date: bad, distance: 5 });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid date');
    }
  });
});

describe('datumvalidering mot Stockholm-dagen (PUT)', () => {
  it('00:30 svensk tid: PUT till dagens svenska datum accepteras, morgondagens nekas', async () => {
    at('2026-10-04T22:30:00.000Z');
    use();
    expect((await put('run-1', { date: '2026-10-05', distance: 5 })).status).toBe(200);
    const future = await put('run-1', { date: '2026-10-06', distance: 5 });
    expect(future.status).toBe(400);
    expect(future.body.error).toMatch(/future dates/i);
  });
});

// ─── Backend-fråga 7: kvalificering efter PUT/DELETE ─────────────────────────

describe('PUT /api/runs/:id → checkEventQualification', () => {
  beforeEach(() => at('2026-10-05T10:00:00.000Z'));

  it('ändrad distans: anropas EN gång med rundans datum, nya distans och gruppen', async () => {
    use();
    const res = await put('run-1', { distance: 6.5 });
    expect(res.status).toBe(200);
    expect(checkEventQualification).toHaveBeenCalledTimes(1);
    expect(checkEventQualification).toHaveBeenCalledWith({
      userId: 'user-1', runId: 'run-1', runDate: '2026-10-01', distanceKm: 6.5, groupId: 'group-1', enforceRunDateWindow: true,
    });
  });

  it('ändrat datum: anropas med det NYA datumet', async () => {
    use();
    await put('run-1', { distance: 4, date: '2026-10-03' });
    expect(checkEventQualification).toHaveBeenCalledWith(expect.objectContaining({ runDate: '2026-10-03', distanceKm: 4 }));
  });

  it('anropas EFTER omräkningen (calculateUserTotals)', async () => {
    use();
    await put('run-1', { distance: 7 });
    const totalsOrder = vi.mocked(calculateUserTotals).mock.invocationCallOrder[0];
    const qualOrder = vi.mocked(checkEventQualification).mock.invocationCallOrder[0];
    expect(totalsOrder).toBeLessThan(qualOrder);
  });

  it('oförändrad runda (samma distans och datum) anropar inget', async () => {
    use();
    const res = await put('run-1', { distance: 4, date: '2026-10-01' });
    expect(res.status).toBe(200);
    expect(checkEventQualification).not.toHaveBeenCalled();
  });

  it('fire-and-forget: ett avvisat anrop fäller inte svaret', async () => {
    use();
    vi.mocked(checkEventQualification).mockRejectedValue(new Error('event boom'));
    const res = await put('run-1', { distance: 8 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('avvisade redigeringar (400/403/404) anropar inget', async () => {
    use({ runs: [run(), run({ id: 'foreign', user_id: 'someone-else' })] });
    expect((await put('run-1', { distance: 0.2 })).status).toBe(400);
    expect((await put('foreign', { distance: 9 })).status).toBe(403);
    expect((await put('missing', { distance: 9 })).status).toBe(404);
    expect(checkEventQualification).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/runs/:id', () => {
  beforeEach(() => at('2026-10-05T10:00:00.000Z'));

  it('raderar och räknar om, men anropar INTE checkEventQualification (en radering kan inte kvalificera)', async () => {
    const t = use();
    const res = await del('run-1');
    expect(res.status).toBe(200);
    expect(t.runs).toHaveLength(0);
    expect(calculateUserTotals).toHaveBeenCalledTimes(1);
    expect(checkEventQualification).not.toHaveBeenCalled();
  });
});
