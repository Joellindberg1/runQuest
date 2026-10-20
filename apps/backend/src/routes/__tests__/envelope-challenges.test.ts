/**
 * Kuvertet i /api/challenges, steg 1 (ADR 007 Addendum 2026-10-20): `success` på varje svar, `code` på varje fel, och `data` bredvid `message` i kvittenserna
 * (respond och withdraw). Not-found-paret i head-to-head (okänd användare mot användare i en annan grupp) är byte-identiskt (A6, ADR 012 beslut 5).
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';

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

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });
afterEach(() => { vi.clearAllMocks(); });

function use(tables: Record<string, Row[]>) {
  const db = createFakeDb(tables, { autoIds: true, numericIds: ['activity_log'] });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as never);
  return db;
}

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OUTSIDER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const UNKNOWN = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const pending = (): Record<string, Row[]> => ({
  activity_log: [], user_challenge_tokens: [{ id: 't1', challenge_id: 'c1', sent_at: '2026-10-05T10:00:00.000Z' }],
  challenges: [{ id: 'c1', status: 'pending', group_id: 'g1', tier: 'minor', metric: 'km', duration_days: 3, challenger_id: A, opponent_id: B }],
  users: [{ id: A, challenge_active: true, group_id: 'g1' }, { id: B, challenge_active: true, group_id: 'g1' }],
});

const asB = () => mintToken({ user_id: B, group_id: 'g1' });
const asA = () => mintToken({ user_id: A, group_id: 'g1' });

describe('PUT /api/challenges/:id/respond and /withdraw', () => {
  it('answers a decline with message and data: null next to it', async () => {
    use(pending());
    const res = await server.request('PUT', '/api/challenges/c1/respond', { token: asB(), body: { action: 'decline' } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'Challenge declined', data: null });
  });

  it('answers an accept with the dates in data, as before, and the message next to it', async () => {
    use(pending());
    const res = await server.request('PUT', '/api/challenges/c1/respond', { token: asB(), body: { action: 'accept' } });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Challenge accepted');
    expect(res.body.data).toEqual({ start_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), end_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
  });

  it('answers a withdraw with message and data: null next to it', async () => {
    use(pending());
    const res = await server.request('PUT', '/api/challenges/c1/withdraw', { token: asA() });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'Challenge withdrawn', data: null });
  });

  it('answers the errors with their codes', async () => {
    const tables = pending();
    use(tables);
    const badAction = await server.request('PUT', '/api/challenges/c1/respond', { token: asB(), body: { action: 'maybe' } });
    expect(badAction.status).toBe(400);
    expect(badAction.body).toEqual({ success: false, error: 'action must be "accept" or "decline"', code: 'invalid_request' });

    const notYours = await server.request('PUT', '/api/challenges/c1/respond', { token: asA(), body: { action: 'accept' } });
    expect(notYours.status).toBe(404);
    expect(notYours.body).toEqual({ success: false, error: 'Challenge not found or already responded', code: 'not_found' });

    tables.challenges[0].tier = 'legendary';
    const legendary = await server.request('PUT', '/api/challenges/c1/respond', { token: asB(), body: { action: 'decline' } });
    expect(legendary.status).toBe(400);
    expect(legendary.body).toEqual({ success: false, error: 'Legendary challenges cannot be declined', code: 'invalid_request' });
  });
});

describe('POST /api/challenges/send', () => {
  it('answers 201 { success, data: { challenge_id } }, unchanged', async () => {
    use({
      activity_log: [],
      user_challenge_tokens: [{ id: 't1', user_id: A, tier: 'major', metric: 'km', duration_days: 5, reward_id: 'rw1', sent_at: null }],
      users: [{ id: A, current_level: 6, group_id: 'g1' }, { id: B, current_level: 7, group_id: 'g1' }],
      challenges: [],
      challenge_rewards: [{ id: 'rw1', winner_type: 'multiplier_days', winner_delta: 0.2, winner_duration: 3, loser_type: 'multiplier_days', loser_delta: -0.1, loser_duration: 2 }],
    });
    const res = await server.request('POST', '/api/challenges/send', { token: asA(), body: { token_id: 't1', opponent_id: B } });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, data: { challenge_id: 'gen-1' } });
  });

  it('answers 400 invalid_request for a missing field and for a challenge to yourself', async () => {
    use(pending());
    const missing = await server.request('POST', '/api/challenges/send', { token: asA(), body: {} });
    expect(missing.status).toBe(400);
    expect(missing.body).toEqual({ success: false, error: 'token_id and opponent_id are required', code: 'invalid_request' });
    const self = await server.request('POST', '/api/challenges/send', { token: asA(), body: { token_id: 't1', opponent_id: A } });
    expect(self.status).toBe(400);
    expect(self.body).toEqual({ success: false, error: 'You cannot challenge yourself', code: 'invalid_request' });
  });
});

describe('GET /api/challenges/head-to-head/:userId', () => {
  const tables = (): Record<string, Row[]> => ({
    users: [
      { id: A, name: 'Anna', profile_picture: null, group_id: 'g1' },
      { id: B, name: 'Bo', profile_picture: null, group_id: 'g1' },
      { id: OUTSIDER, name: 'Out', profile_picture: null, group_id: 'g2' },
    ],
    challenges: [],
  });

  it('answers the same 404 for an unknown user and for a user in another group, byte for byte', async () => {
    use(tables());
    const unknown = await server.request('GET', `/api/challenges/head-to-head/${UNKNOWN}`, { token: asA() });
    const otherGroup = await server.request('GET', `/api/challenges/head-to-head/${OUTSIDER}`, { token: asA() });
    expect(unknown.status).toBe(404);
    expect(otherGroup.status).toBe(404);
    expect(JSON.stringify(otherGroup.body)).toBe(JSON.stringify(unknown.body));
    expect(unknown.body).toEqual({ success: false, error: 'User not found', code: 'not_found' });
  });

  it('answers the same 404 for a token without a group, so the group of the caller is not revealed', async () => {
    use(tables());
    const noGroup = await server.request('GET', `/api/challenges/head-to-head/${B}`, { token: mintToken({ user_id: A, group_id: null }) });
    expect(noGroup.status).toBe(404);
    expect(noGroup.body).toEqual({ success: false, error: 'User not found', code: 'not_found' });
  });

  it('answers 400 invalid_request for an id that is not a uuid and for a comparison with yourself', async () => {
    use(tables());
    const notUuid = await server.request('GET', '/api/challenges/head-to-head/nope', { token: asA() });
    expect(notUuid.body).toEqual({ success: false, error: 'userId must be a valid uuid', code: 'invalid_request' });
    const self = await server.request('GET', `/api/challenges/head-to-head/${A}`, { token: asA() });
    expect(self.body).toEqual({ success: false, error: 'Cannot compare with yourself', code: 'invalid_request' });
  });
});

describe('GET /api/challenges/my and /group-history', () => {
  it('answers { success, data } with the boosts carrying their start_date and end_date (the stored window)', async () => {
    use({
      user_challenge_tokens: [], challenges: [], users: [{ id: A, group_id: 'g1', name: 'Anna' }],
      user_boosts: [{ id: 'b1', user_id: A, challenge_id: 'c1', outcome: 'won', type: 'multiplier_days', delta: 0.2, remaining: null, expires_at: '2026-10-09T22:00:00Z', created_at: '2026-10-06T09:00:00Z', start_date: '2026-10-07', end_date: '2026-10-09' }],
    });
    const res = await server.request('GET', '/api/challenges/my', { token: asA() });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.boosts).toEqual([expect.objectContaining({ start_date: '2026-10-07', end_date: '2026-10-09' })]);
  });

  it('answers 200 with empty data in the envelope for a token without a group', async () => {
    use(pending());
    const res = await server.request('GET', '/api/challenges/group-history', { token: mintToken({ user_id: A, group_id: null }) });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { items: [] }, meta: { total: 0, limit: 20, offset: 0, has_more: false } });
  });

  it('answers 400 invalid_request for a bad page', async () => {
    use(pending());
    const res = await server.request('GET', '/api/challenges/group-history?limit=500', { token: asA() });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, code: 'invalid_request' });
  });
});

describe('GET /api/challenges/:id/progress', () => {
  it('answers 404 not_found for a challenge that does not exist', async () => {
    use({ ...pending(), challenges: [] });
    const res = await server.request('GET', '/api/challenges/nope/progress', { token: asA() });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'Challenge not found', code: 'not_found' });
  });
});
