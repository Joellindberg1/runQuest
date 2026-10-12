/**
 * RUN-218 T4 — utmaningens "idag" är Stockholm-dagen, inte UTC-dagen.
 *
 * getProgressForChallenge slutar vid utmaningens end_date, och utan end_date vid "idag". "Idag" togs ur
 * `new Date().toISOString()` (UTC), så mellan Stockholm-midnatt och UTC-midnatt (00:00–02:00 på sommaren, 00:00–01:00 på
 * vintern) saknades dagens runda i ställningen: runs.ts godtar redan dagens datum som Stockholm-dag (todayStockholm).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  testDatabaseConnection: vi.fn(),
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from '../../config/database.js';
import { getProgressForChallenge } from '../challengeService.js';
import { createFakeDb, type Row } from '../../routes/__tests__/helpers/fakeDb.js';

function use(tables: Record<string, Row[]>) {
  const db = createFakeDb(tables);
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return db;
}

const challenge = (over: Row = {}): Row => ({
  id: 'c1', challenger_id: 'a', opponent_id: 'b', metric: 'km', status: 'active',
  start_date: '2026-07-01', end_date: null, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); });

describe('getProgressForChallenge utan end_date — "idag" i Stockholm', () => {
  it('sommar: 00:30 Stockholm (22:30 UTC dagen innan) räknar dagens runda', () => {
    vi.setSystemTime(new Date('2026-07-04T22:30:00Z')); // 2026-07-05 00:30 i Stockholm
    use({
      challenges: [challenge()],
      runs: [
        { id: 'r1', user_id: 'a', date: '2026-07-04', distance: 3 },
        { id: 'r2', user_id: 'a', date: '2026-07-05', distance: 5 }, // loggad idag (Stockholm)
        { id: 'r3', user_id: 'b', date: '2026-07-05', distance: 2 },
      ],
    });
    return expect(getProgressForChallenge('c1')).resolves.toEqual([
      { user_id: 'a', value: 8 },
      { user_id: 'b', value: 2 },
    ]);
  });

  it('vinter: 00:30 Stockholm (23:30 UTC dagen innan) räknar dagens runda, även över årsskiftet', () => {
    vi.setSystemTime(new Date('2026-12-31T23:30:00Z')); // 2027-01-01 00:30 i Stockholm
    use({
      challenges: [challenge({ start_date: '2026-12-28' })],
      runs: [{ id: 'r1', user_id: 'a', date: '2027-01-01', distance: 6 }],
    });
    return expect(getProgressForChallenge('c1')).resolves.toEqual([
      { user_id: 'a', value: 6 },
      { user_id: 'b', value: 0 },
    ]);
  });

  it('antal rundor (runs-mått) följer samma dag', () => {
    vi.setSystemTime(new Date('2026-07-04T22:30:00Z'));
    use({
      challenges: [challenge({ metric: 'runs' })],
      runs: [
        { id: 'r1', user_id: 'a', date: '2026-07-05', distance: 5 },
        { id: 'r2', user_id: 'a', date: '2026-07-03', distance: 5 },
      ],
    });
    return expect(getProgressForChallenge('c1')).resolves.toEqual([
      { user_id: 'a', value: 2 },
      { user_id: 'b', value: 0 },
    ]);
  });

  it('mitt på dagen är Stockholm-dagen och UTC-dagen samma: oförändrat', () => {
    vi.setSystemTime(new Date('2026-07-05T10:00:00Z'));
    use({
      challenges: [challenge()],
      runs: [
        { id: 'r1', user_id: 'a', date: '2026-07-05', distance: 5 },
        { id: 'r2', user_id: 'a', date: '2026-07-06', distance: 9 }, // framtiden räknas inte
      ],
    });
    return expect(getProgressForChallenge('c1')).resolves.toEqual([
      { user_id: 'a', value: 5 },
      { user_id: 'b', value: 0 },
    ]);
  });

  it('en satt end_date används som den är', () => {
    vi.setSystemTime(new Date('2026-07-04T22:30:00Z'));
    use({
      challenges: [challenge({ end_date: '2026-07-04' })],
      runs: [
        { id: 'r1', user_id: 'a', date: '2026-07-04', distance: 3 },
        { id: 'r2', user_id: 'a', date: '2026-07-05', distance: 5 },
      ],
    });
    return expect(getProgressForChallenge('c1')).resolves.toEqual([
      { user_id: 'a', value: 3 },
      { user_id: 'b', value: 0 },
    ]);
  });
});
