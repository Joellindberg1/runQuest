/**
 * Kuvertet i de övriga routrarna, steg 1 (ADR 007 Addendum 2026-10-20): groups, onboarding, väntelistan, news, badges, leaderboard, settings, group settings, admin och public stats.
 * De nakna svaren (`{ seen }`, `{ ok: true }`, `{ success: true, message, group }`) får `data` bredvid de gamla nycklarna; varje fel bär `code`.
 * Not-found-paret (okänt id mot id i en annan grupp) är byte-identiskt (A6, ADR 012 beslut 5).
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
vi.mock('../../services/groupRanking.js', () => ({ rebuildGroupRankingAfterJoin: vi.fn().mockResolvedValue(undefined) }));

import { getSupabaseClient } from '../../config/database.js';
import app from '../../app.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });

function use(tables: Record<string, Row[]> = {}, options: Parameters<typeof createFakeDb>[1] = {}) {
  const db = createFakeDb(tables, { autoIds: true, ...options });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as never);
  return db;
}

const ME = '00000000-0000-4000-8000-000000000001';
const OTHER_GROUP = '00000000-0000-4000-8000-000000000009';
const MISSING = '00000000-0000-4000-8000-0000000000ff';
const token = (group_id: string | null = 'g1') => mintToken({ user_id: ME, group_id });

beforeEach(() => { vi.clearAllMocks(); });

describe('onboarding', () => {
  it('answers seen at the top level (old client) and in data (new client)', async () => {
    use({ user_seen_items: [{ user_id: ME, item_slug: 'welcome' }, { user_id: ME, item_slug: 'tour' }] });
    const res = await server.request('GET', '/api/onboarding/status', { token: token() });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, seen: ['welcome', 'tour'], data: { seen: ['welcome', 'tour'] } });
  });

  it('answers { ok: true } with success and data: null next to it', async () => {
    use({ user_seen_items: [] });
    const res = await server.request('POST', '/api/onboarding/mark-seen', { token: token(), body: { slug: 'welcome' } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, ok: true, data: null });
  });

  it('answers 400 invalid_request and 500 internal_error with fixed texts', async () => {
    use({ user_seen_items: [] });
    const bad = await server.request('POST', '/api/onboarding/mark-seen', { token: token(), body: {} });
    expect(bad.status).toBe(400);
    expect(bad.body).toEqual({ success: false, error: 'slug is required and must be a string', code: 'invalid_request' });

    use({ user_seen_items: [] }, { errors: { user_seen_items: { message: 'row value 12345678901' } } });
    const broken = await server.request('GET', '/api/onboarding/status', { token: token() });
    expect(broken.status).toBe(500);
    expect(broken.body).toEqual({ success: false, error: 'Failed to fetch onboarding status', code: 'internal_error' });
  });
});

describe('groups', () => {
  const tables = (): Record<string, Row[]> => ({
    groups: [{ id: 'g1', name: 'Crew', invite_code: 'ABC123', owner_id: ME, created_at: '2026-10-01T00:00:00Z' }],
    users: [{ id: ME, name: 'Me', group_id: 'g1', total_xp: 10, current_level: 1, profile_picture: null, challenge_active: false }],
    group_members: [{ id: 'm1', group_id: 'g1', user_id: ME, role: 'admin', left_at: null, joined_at: '2026-10-01T00:00:00Z' }],
  });

  it('answers 404 not_found for a token without a group', async () => {
    use(tables());
    const res = await server.request('GET', '/api/groups/my', { token: token(null) });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'You are not a member of any group', code: 'not_found' });
  });

  it('answers join with message and group at the top level and group in data', async () => {
    const t = tables();
    t.users.push({ id: 'new-user', name: 'New', group_id: null });
    use(t, { rpc: { join_group: () => ({ data: null, error: null }) } });
    const res = await server.request('POST', '/api/groups/join', { token: mintToken({ user_id: 'new-user', group_id: null }), body: { invite_code: 'abc123' } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'Successfully joined group "Crew"', group: { id: 'g1', name: 'Crew' }, data: { group: { id: 'g1', name: 'Crew' } } });
  });

  it('answers join errors with their codes: 400 invalid_request, 404 invalid_invite_code', async () => {
    use(tables());
    const missing = await server.request('POST', '/api/groups/join', { token: token(), body: {} });
    expect(missing.status).toBe(400);
    expect(missing.body).toEqual({ success: false, error: 'invite_code is required', code: 'invalid_request' });
    const wrong = await server.request('POST', '/api/groups/join', { token: token(), body: { invite_code: 'NOPE00' } });
    expect(wrong.status).toBe(404);
    expect(wrong.body).toEqual({ success: false, error: 'Invalid invite code', code: 'invalid_invite_code' });
  });

  it('answers the same 404 invalid_invite_code whatever the reason, byte for byte', async () => {
    use(tables());
    const unknown = await server.request('POST', '/api/groups/join', { token: token(), body: { invite_code: 'ZZZZZZ' } });
    const other = await server.request('POST', '/api/groups/join', { token: token(), body: { invite_code: 'QQQQQQ' } });
    expect(JSON.stringify(unknown.body)).toBe(JSON.stringify(other.body));
  });
});

describe('the waitlist', () => {
  let ipCounter = 0;
  const freshIp = () => { ipCounter++; return `10.7.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`; };
  const post = (body: unknown) => server.request('POST', '/api/waitlist', { body, headers: { 'x-forwarded-for': freshIp() } });

  it('answers a new signup, a duplicate, the honeypot and the timing trap with the same body { success: true, data: null }', async () => {
    use({ waitlist_signups: [] });
    const fresh = await post({ email: 'a@example.com', consent: true });
    const duplicate = await post({ email: 'a@example.com', consent: true });
    const honeypot = await post({ email: 'b@example.com', consent: true, website: 'http://spam' });
    const tooFast = await post({ email: 'c@example.com', consent: true, elapsedMs: 1 });
    for (const res of [fresh, duplicate, honeypot, tooFast]) {
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: null });
    }
  });

  it('answers the errors with their codes: consent_required, invalid_request, invalid_json, payload_too_large', async () => {
    use({ waitlist_signups: [] });
    const noConsent = await post({ email: 'a@example.com' });
    expect(noConsent.status).toBe(400);
    expect(noConsent.body).toEqual({ success: false, error: 'Consent is required', code: 'consent_required' });
    const badEmail = await post({ email: 'nope', consent: true });
    expect(badEmail.body).toEqual({ success: false, error: 'A valid email address is required', code: 'invalid_request' });

    const broken = await server.request('POST', '/api/waitlist', { headers: { 'x-forwarded-for': freshIp() }, body: undefined });
    expect(broken.status).toBe(400);

    const huge = await post({ email: 'a@example.com', consent: true, filler: 'x'.repeat(4000) });
    expect(huge.status).toBe(413);
    expect(huge.body).toEqual({ success: false, error: 'Request body too large', code: 'payload_too_large' });
  });
});

describe('news', () => {
  it('answers 400 invalid_request with the validation text and 404 not_found for an unknown reader', async () => {
    use({ users: [{ id: ME, group_id: 'g1', news_last_seen_id: null }], activity_log: [] });
    const bad = await server.request('GET', '/api/news?limit=0', { token: token() });
    expect(bad.status).toBe(400);
    expect(bad.body).toEqual({ success: false, error: expect.stringMatching(/^limit must be an integer between 1 and \d+$/), code: 'invalid_request' });

    use({ users: [], activity_log: [] });
    const unknown = await server.request('GET', '/api/news', { token: token() });
    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual({ success: false, error: 'User not found', code: 'not_found' });
  });
});

describe('badges', () => {
  it('answers the same 404 for an unknown user and for a user in another group, byte for byte', async () => {
    use({
      users: [{ id: ME, group_id: 'g1', displayed_badge_series: [] }, { id: OTHER_GROUP, group_id: 'g2', displayed_badge_series: [] }],
      user_badges: [],
    });
    const unknown = await server.request('GET', `/api/badges/user/${MISSING}`, { token: token() });
    const otherGroup = await server.request('GET', `/api/badges/user/${OTHER_GROUP}`, { token: token() });
    expect(unknown.status).toBe(404);
    expect(otherGroup.status).toBe(404);
    expect(JSON.stringify(otherGroup.body)).toBe(JSON.stringify(unknown.body));
    expect(unknown.body).toEqual({ success: false, error: 'User not found', code: 'not_found' });
  });

  it('answers 400 invalid_request for an id that is not a uuid', async () => {
    use({ users: [], user_badges: [] });
    const res = await server.request('GET', '/api/badges/user/nope', { token: token() });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'userId must be a valid uuid', code: 'invalid_request' });
  });
});

describe('leaderboard, settings, admin and public stats', () => {
  it('answers 400 invalid_request for a week_start that is not a Monday', async () => {
    use({ users: [], runs: [] });
    const res = await server.request('GET', '/api/leaderboard/week?week_start=2026-10-07', { token: token() });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'week_start must be a Monday', code: 'invalid_request' });
  });

  it('answers 400 invalid_request with the validation text built from the caller input for settings', async () => {
    use({ user_settings: [] });
    const res = await server.request('PUT', '/api/settings', { token: token(), body: { values: { nonsense_key: true } } });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, code: 'invalid_request' });
    expect(typeof res.body.error).toBe('string');
  });

  it('answers 200 { success, data: { values }, meta: { customised } } for settings, unchanged', async () => {
    use({ user_settings: [] });
    const res = await server.request('GET', '/api/settings', { token: token() });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: { values: expect.any(Object) }, meta: { customised: [] } });
  });

  it('answers 403 forbidden for a member who may not write group settings, and 200 with can_edit false for a read', async () => {
    use({
      group_members: [{ id: 'm1', group_id: 'g1', user_id: ME, role: 'member', left_at: null, joined_at: '2026-10-01T00:00:00Z' }],
      group_settings: [], users: [{ id: ME, group_id: 'g1' }],
    });
    const write = await server.request('PUT', '/api/groups/settings', { token: token(), body: { values: {} } });
    expect(write.status).toBe(403);
    expect(write.body).toEqual({ success: false, error: 'Forbidden', code: 'forbidden' });
    const read = await server.request('GET', '/api/groups/settings', { token: token() });
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ success: true, meta: { can_edit: false } });
  });

  it('answers the admin waitlist as { success, data } and 500 internal_error with a fixed text', async () => {
    use({ users: [{ id: ME, is_admin: true, group_id: 'g1' }], waitlist_signups: [{ id: 1, email: 'a@example.com', created_at: '2026-10-01T00:00:00Z', source: 'landing' }] });
    const res = await server.request('GET', '/api/admin/waitlist', { token: token() });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: { total: 1 } });

    use({ users: [{ id: ME, is_admin: true, group_id: 'g1' }], waitlist_signups: [] }, { errors: { waitlist_signups: { message: 'a@example.com leaked' } } });
    const broken = await server.request('GET', '/api/admin/waitlist', { token: token() });
    expect(broken.status).toBe(500);
    expect(broken.body).toEqual({ success: false, error: 'Failed to load the waitlist', code: 'internal_error' });
  });
});
