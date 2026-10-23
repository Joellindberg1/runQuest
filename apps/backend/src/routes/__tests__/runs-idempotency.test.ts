/**
 * Idempotensnyckel på POST /api/runs: samma Idempotency-Key skapar aldrig en andra runda (en användare som
 * skickar igen efter ett svar som aldrig nådde fram får inte en dubblett).
 *
 * Unikindexet (user_id, client_request_id) från migration 043 modelleras i fakeDb (`uniqueIndexes`) med
 * Postgres-semantik: null ingår inte, och en krock ger 23505 med indexnamnet. Racet simuleras genom att en
 * "vinnande" rad committas precis innan förlorarens insert utvärderas (`beforeInsert`), dvs. efter att förlorarens
 * förkontroll redan missat den.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

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
vi.mock('../../services/weatherService.js', () => ({
  WeatherService: { fetchAndSaveWeatherForRuns: vi.fn().mockResolvedValue(undefined), backfillMissingWeather: vi.fn() },
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
import { CLIENT_REQUEST_ID_INDEX } from '../runs.js';
import { createFakeDb, type FakeDbOptions, type RecordedQuery, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });
beforeEach(() => { vi.clearAllMocks(); });

const KEY = '3f2b8c1e-5d4a-4b7e-9c3a-1a2b3c4d5e6f';
const OTHER_KEY = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const INDEX = CLIENT_REQUEST_ID_INDEX;
const token = mintToken({ user_id: 'user-1', group_id: 'group-1' });
const otherToken = mintToken({ user_id: 'user-2', group_id: 'group-1' });

/** Som i prod efter migration 043: unikt (user_id, client_request_id) där nyckeln finns. */
const withIndex = (over: FakeDbOptions = {}): FakeDbOptions => ({
  autoIds: true,
  uniqueIndexes: [{ table: 'runs', name: INDEX, columns: ['user_id', 'client_request_id'] }],
  ...over,
});

function use(runs: Row[] = [], options: FakeDbOptions = { autoIds: true }) {
  const tables: Record<string, Row[]> = { runs, user_boosts: [] };
  const db = createFakeDb(tables, options);
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return { tables, queries: db.queries };
}

const existingRun = (over: Row = {}): Row => ({
  id: 'winner-1', user_id: 'user-1', date: '2026-10-02', distance: 5, streak_day: 1, xp_gained: 30,
  multiplier: 1, base_xp: 15, km_xp: 10, distance_bonus: 5, streak_bonus: 0, source: 'manual', external_id: null,
  is_treadmill: null, client_request_id: KEY, ...over,
});

const post = (headers: Record<string, string> = {}, who = token) =>
  server.request('POST', '/api/runs', { token: who, body: { date: '2026-10-02', distance: 5 }, headers });

const runWrites = (queries: RecordedQuery[]) => queries.filter((q) => q.table === 'runs' && q.mutation);

describe('POST /api/runs med Idempotency-Key', () => {
  it('två anrop med samma nyckel ger en enda runda', async () => {
    const { tables } = use();
    const first = await post({ 'Idempotency-Key': KEY });
    const second = await post({ 'Idempotency-Key': KEY });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(tables.runs).toHaveLength(1);
  });

  it('nyckeln sparas på rundan (gemener) och väljs inte ut i svaret', async () => {
    const { tables, queries } = use();
    await post({ 'Idempotency-Key': KEY.toUpperCase() });
    expect(tables.runs[0].client_request_id).toBe(KEY);
    // fakeDb projicerar inte kolumner; kontrollera därför kolumnlistan som routen ber om.
    const selects = queries.filter((q) => q.table === 'runs' && q.select).map((q) => q.select);
    expect(selects.some((s) => s?.includes('xp_gained'))).toBe(true);
    expect(selects.every((s) => !s?.includes('client_request_id'))).toBe(true);
  });

  it('upprepningen får samma status och samma svar som det första, utan ny skrivning eller omräkning', async () => {
    const { tables, queries } = use([], withIndex());
    const first = await post({ 'Idempotency-Key': KEY });
    const writesAfterFirst = runWrites(queries).length;
    const totalsAfterFirst = vi.mocked(calculateUserTotals).mock.calls.length;
    const eventsAfterFirst = vi.mocked(checkEventQualification).mock.calls.length;

    const second = await post({ 'Idempotency-Key': KEY });

    expect(second.status).toBe(first.status);
    expect(second.body).toEqual(first.body);
    expect(second.body.run.id).toBe(first.body.run.id);
    expect(tables.runs).toHaveLength(1);
    expect(runWrites(queries)).toHaveLength(writesAfterFirst);
    expect(vi.mocked(calculateUserTotals).mock.calls).toHaveLength(totalsAfterFirst);
    expect(vi.mocked(checkEventQualification).mock.calls).toHaveLength(eventsAfterFirst);
  });

  it('två samtidiga anrop med samma nyckel ger en enda runda och två lyckade svar', async () => {
    const { tables } = use([], withIndex());
    const [a, b] = await Promise.all([post({ 'Idempotency-Key': KEY }), post({ 'Idempotency-Key': KEY })]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.run.id).toBe(b.body.run.id);
    expect(tables.runs).toHaveLength(1);
  });

  it('race: förkontrollen missar, insert träffar unikindexet (23505) → den befintliga raden returneras', async () => {
    let raced = false;
    const { tables, queries } = use([], withIndex({
      beforeInsert: (table, t) => {
        if (table !== 'runs' || raced) return;
        raced = true;
        t.runs.push(existingRun()); // det samtidiga anropet committar precis före vår insert
      },
    }));

    const res = await post({ 'Idempotency-Key': KEY });

    expect(raced).toBe(true);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, message: 'Run created successfully', run: { id: 'winner-1', xp_gained: 30 } });
    expect(tables.runs).toHaveLength(1);
    // Vi försökte skriva (insert → 23505) och läste sedan om raden; ingen omräkning för förloraren.
    expect(runWrites(queries).map((q) => q.mutation)).toEqual(['insert']);
    expect(queries.filter((q) => q.table === 'runs' && q.select !== null && !q.mutation)).toHaveLength(2);
    expect(calculateUserTotals).not.toHaveBeenCalled();
    expect(checkEventQualification).not.toHaveBeenCalled();
  });

  it('23505 på ett ANNAT index är inte en återspelning: 500 som idag, även när en rad med samma nyckel finns att läsa', async () => {
    let raced = false;
    const { tables } = use([], {
      autoIds: true,
      // Raden med vår nyckel finns när insert felar — en felaktig "alla 23505 är återspelning" skulle svara 200 med den.
      beforeInsert: (table, t) => {
        if (table !== 'runs' || raced) return;
        raced = true;
        t.runs.push(existingRun());
      },
      failWhen: (q) => (q.table === 'runs' && q.mutation === 'insert'
        ? ({ code: '23505', message: 'duplicate key value violates unique constraint "idx_runs_external_id"' } as { message: string })
        : null),
    });
    const res = await post({ 'Idempotency-Key': KEY });
    expect(raced).toBe(true);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to create run', code: 'internal_error' });
    expect(tables.runs).toHaveLength(1);
    expect(tables.runs[0].id).toBe('winner-1');
  });

  it('förkontrollen felar (läsfel på runs): 500, ingen insert görs och inget skapas', async () => {
    const { tables, queries } = use([], {
      autoIds: true,
      failWhen: (q) => (q.table === 'runs' && q.select !== null && !q.mutation ? { message: 'read failed' } : null),
    });
    const res = await post({ 'Idempotency-Key': KEY });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to create run', code: 'internal_error' });
    expect(queries.some((q) => q.mutation === 'insert')).toBe(false);
    expect(tables.runs).toHaveLength(0);
    expect(calculateUserTotals).not.toHaveBeenCalled();
  });

  it('23505 på idempotensindexet men raden går inte att läsa → 500, inget påstås vara skapat', async () => {
    const { tables } = use([], {
      autoIds: true,
      failWhen: (q) => (q.table === 'runs' && q.mutation === 'insert'
        ? ({ code: '23505', message: `duplicate key value violates unique constraint "${INDEX}"` } as { message: string })
        : null),
    });
    const res = await post({ 'Idempotency-Key': KEY });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to create run', code: 'internal_error' });
    expect(tables.runs).toHaveLength(0);
  });

  it('en annan användares nyckel krockar inte: samma nyckel hos två användare ger två rundor', async () => {
    const { tables } = use([], withIndex());
    const mine = await post({ 'Idempotency-Key': KEY });
    const theirs = await post({ 'Idempotency-Key': KEY }, otherToken);
    expect(mine.status).toBe(200);
    expect(theirs.status).toBe(200);
    expect(theirs.body.run.id).not.toBe(mine.body.run.id);
    expect(tables.runs.map((r) => r.user_id).sort()).toEqual(['user-1', 'user-2']);
  });

  it('en annan användares runda med samma nyckel återspelas aldrig till mig', async () => {
    const { tables } = use([existingRun({ id: 'theirs', user_id: 'user-2' })], withIndex());
    const res = await post({ 'Idempotency-Key': KEY });
    expect(res.status).toBe(200);
    expect(res.body.run.id).not.toBe('theirs');
    expect(tables.runs).toHaveLength(2);
  });

  it('två olika nycklar ger två rundor', async () => {
    const { tables } = use([], withIndex());
    await post({ 'Idempotency-Key': KEY });
    await post({ 'Idempotency-Key': OTHER_KEY });
    expect(tables.runs).toHaveLength(2);
  });

  it('written: true — rundan finns men omräkningen föll: upprepningen returnerar rundan (200), ingen dubblett', async () => {
    let failRecalc = true;
    const { tables } = use([], withIndex({
      failWhen: (q) => (failRecalc && q.table === 'runs' && q.mutation === 'update' ? { message: 'update failed' } : null),
    }));

    const first = await post({ 'Idempotency-Key': KEY });
    expect(first.status).toBe(500);
    expect(first.body).toMatchObject({ written: true, code: 'recalc_failed_after_write' });
    expect(tables.runs).toHaveLength(1);

    failRecalc = false;
    const second = await post({ 'Idempotency-Key': KEY });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ success: true, run: { id: tables.runs[0].id } });
    expect(tables.runs).toHaveLength(1);
  });

  it('en ogiltig nyckel ger 400 och ingenting skrivs', async () => {
    const { tables } = use([], withIndex());
    for (const bad of ['not-a-uuid', '', 'c232ab00-9414-11ec-b3c8-9f6bdeced846', `${KEY}, ${KEY}`]) {
      const res = await post({ 'Idempotency-Key': bad });
      expect(res.status, `nyckel "${bad}"`).toBe(400);
      expect(res.body).toEqual({ success: false, error: 'Idempotency-Key must be a UUID v4', code: 'invalid_request' });
    }
    expect(tables.runs).toHaveLength(0);
  });
});

describe('POST /api/runs utan Idempotency-Key — oförändrat', () => {
  it('skapar en runda per anrop, utan client_request_id, även med unikindexet på plats', async () => {
    const { tables } = use([], withIndex());
    const first = await post();
    const second = await post();
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(tables.runs).toHaveLength(2);
    expect(tables.runs.every((r) => !('client_request_id' in r))).toBe(true);
  });

  it('gör ingen nyckelslagning (ingen extra läsning före insert)', async () => {
    const { queries } = use([], withIndex());
    await post();
    const before = queries.findIndex((q) => q.mutation === 'insert');
    expect(queries.slice(0, before).filter((q) => q.table === 'runs')).toHaveLength(0);
  });

  it('ogiltig indata ger samma 400 som förut', async () => {
    use([], withIndex());
    const res = await server.request('POST', '/api/runs', { token, body: { date: '2026-10-02', distance: 0.5 } });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'Distance must be at least 1.0 km', code: 'invalid_request' });
  });
});
