/**
 * Duellens startfönster (ägarens regel 2026-10-19): en duell startar vid nästa midnatt (00:00) i gruppens lokala tid efter
 * att den accepterats, aldrig i samma ögonblick — annars går det att utnyttja. Gruppens tid är Europe/Stockholm tills tidszon
 * per grupp finns. Rundor som loggats samma dag som accepteringen räknas aldrig.
 *
 * Reglerna "nästa midnatt" i sig testas i packages/shared (groupNextMidnight); här testas kopplingen: accept-rutten skriver
 * dess dag som start_date, och utmaningens rundräkning (getProgressForChallenge, som även settleChallenge går via) läser
 * samma kalenderdagar.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import { stockholmWallClockToInstant } from '@runquest/shared';

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
import { getProgressForChallenge } from '../../services/challengeService.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); });
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

const tables = (over: Record<string, Row[]> = {}): Record<string, Row[]> => ({
  activity_log: [],
  challenges: [{
    id: 'c1', status: 'pending', group_id: 'g1', tier: 'minor', metric: 'km', duration_days: 2,
    challenger_id: 'a', opponent_id: 'b',
  }],
  users: [{ id: 'a', challenge_active: true }, { id: 'b', challenge_active: true }],
  runs: [],
  ...over,
});

function acceptAt(iso: string, data: Record<string, Row[]>) {
  const db = createFakeDb(data, { numericIds: ['activity_log'] });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  vi.setSystemTime(new Date(iso));
  return server.request('PUT', '/api/challenges/c1/respond', {
    token: mintToken({ user_id: 'b', group_id: 'g1' }), body: { action: 'accept' },
  });
}

describe('accepterad duell: start_date och fönstret', () => {
  it('accepterad 23:59 Stockholm startar nästa dag, och fönstret börjar 00:00 Stockholm', async () => {
    const data = tables();
    const res = await acceptAt('2026-07-04T21:59:00Z', data); // 2026-07-04 23:59 sommartid

    expect(res.status).toBe(200);
    expect(data.challenges[0].start_date).toBe('2026-07-05');
    expect(res.body.data.start_date).toBe('2026-07-05');
    expect(stockholmWallClockToInstant(data.challenges[0].start_date as string, 0).toISOString()).toBe('2026-07-04T22:00:00.000Z');
  });

  it('accepterad 00:01 Stockholm startar vid nästa midnatt, inte samma dag', async () => {
    const data = tables();
    const res = await acceptAt('2026-07-03T22:01:00Z', data); // 2026-07-04 00:01 sommartid

    expect(res.status).toBe(200);
    expect(data.challenges[0].start_date).toBe('2026-07-05');
  });

  it('end_date och determine_at följer startdagen: exakt duration_days kalenderdagar, avgörande 03:00 Stockholm dagen efter slutet', async () => {
    const data = tables(); // duration_days 2
    await acceptAt('2026-07-04T21:59:00Z', data); // startar 2026-07-05

    expect(data.challenges[0].end_date).toBe('2026-07-06');
    expect(data.challenges[0].determine_at).toBe('2026-07-07T01:00:00.000Z'); // 2026-07-07 03:00 sommartid
  });

  it.each([
    [1, '2026-07-06', '2026-07-07T01:00:00.000Z'],
    [5, '2026-07-10', '2026-07-11T01:00:00.000Z'], // måndag till fredag
    [7, '2026-07-12', '2026-07-13T01:00:00.000Z'],
  ])('en duell på %i dagar som accepteras söndag 23:59 startar måndag och slutar %s', async (days, endDate, determineAt) => {
    const data = tables();
    data.challenges[0].duration_days = days;
    await acceptAt('2026-07-05T21:59:00Z', data); // söndag 2026-07-05 23:59 sommartid -> start måndag 2026-07-06

    expect(data.challenges[0].start_date).toBe('2026-07-06');
    expect(data.challenges[0].end_date).toBe(endDate);
    expect(data.challenges[0].determine_at).toBe(determineAt);
  });

  it('sommartidsbyte under duellen: slutet är kalenderdagar och avgörandet 03:00 vintertid', async () => {
    const data = tables(); // duration_days 2
    await acceptAt('2026-10-24T21:30:00Z', data); // 2026-10-24 23:30 sommartid -> start 25 okt (dygnet är 25 h)

    expect(data.challenges[0].start_date).toBe('2026-10-25');
    expect(data.challenges[0].end_date).toBe('2026-10-26');
    expect(data.challenges[0].determine_at).toBe('2026-10-27T02:00:00.000Z'); // 03:00 vintertid
  });

  it('vintertid: 00:30 Stockholm (23:30 UTC dagen innan) startar också nästa dag', async () => {
    const data = tables();
    await acceptAt('2026-01-09T23:30:00Z', data); // 2026-01-10 00:30 vintertid

    expect(data.challenges[0].start_date).toBe('2026-01-11');
  });
});

describe('rundräkningen i en accepterad duell', () => {
  it('rundor loggade samma dag som accepteringen räknas aldrig, rundor från startdagen och framåt räknas', async () => {
    const data = tables({
      runs: [
        { id: 'r0', user_id: 'a', date: '2026-07-03', distance: 100 }, // dagen innan
        { id: 'r1', user_id: 'a', date: '2026-07-04', distance: 10 },  // acceptansdagen: räknas aldrig
        { id: 'r2', user_id: 'b', date: '2026-07-04', distance: 20 },  // acceptansdagen: räknas aldrig
        { id: 'r3', user_id: 'a', date: '2026-07-05', distance: 3 },   // startdagen
        { id: 'r4', user_id: 'b', date: '2026-07-06', distance: 4 },   // slutdagen (duration_days 2: 5 och 6 juli)
        { id: 'r5', user_id: 'b', date: '2026-07-07', distance: 50 },  // efter slutdagen
      ],
    });
    await acceptAt('2026-07-04T21:59:00Z', data); // accepterad 23:59 samma dag som r1 och r2

    // Utmaningen är nu active med start/end satta av rutten; progress läser den raden.
    expect(data.challenges[0].status).toBe('active');
    await expect(getProgressForChallenge('c1')).resolves.toEqual([
      { user_id: 'a', value: 3 },
      { user_id: 'b', value: 4 },
    ]);
  });

  it('accepterad 00:01: rundor från morgonen samma dag räknas inte heller', async () => {
    const data = tables({
      runs: [
        { id: 'r1', user_id: 'a', date: '2026-07-04', distance: 8 },  // loggad efter accepten, samma dag
        { id: 'r2', user_id: 'a', date: '2026-07-05', distance: 2 },
      ],
    });
    await acceptAt('2026-07-03T22:01:00Z', data); // 2026-07-04 00:01

    await expect(getProgressForChallenge('c1')).resolves.toEqual([
      { user_id: 'a', value: 2 },
      { user_id: 'b', value: 0 },
    ]);
  });
});
