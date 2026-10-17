/**
 * No Strava answer to an ordinary user carries a value that belongs to everyone: the time of the newest webhook event or the state of
 * the backup poll says something about activity outside the user's own group (ADR 010). The webhook health for admins is the place for
 * that. Through the real app; the database is createFakeDb.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.STRAVA_CLIENT_ID = 'client-id';
process.env.STRAVA_CLIENT_SECRET = 'client-secret';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import app from '../../app.js';
import { createFakeDb } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });

beforeEach(() => {
  vi.clearAllMocks();
  for (const level of ['info', 'warn', 'error', 'debug'] as const) vi.spyOn(logger, level).mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

// Another group's webhook event, newer than anything of user-1's.
const OTHER_GROUPS_EVENT_AT = '2026-10-16T21:45:13.000Z';
const OTHER_OWNER_ID = 555111;

function use() {
  const db = createFakeDb(
    {
      users: [{ id: 'user-1' }],
      strava_tokens: [{ user_id: 'user-1', access_token: 'at', refresh_token: 'rt', expires_at: 9999999999, connection_date: '2026-09-01', users: { name: 'Test' } }],
      runs: [{ id: 'r1', user_id: 'user-1', source: 'strava', date: '2026-10-01', created_at: '2026-10-02T08:00:00.000Z' }],
      strava_webhook_events: [{ id: 1, dedupe_key: 'k1', owner_id: OTHER_OWNER_ID, object_id: 987654321, status: 'done', received_at: OTHER_GROUPS_EVENT_AT }],
    },
    { autoIds: true, primaryKeys: { strava_tokens: ['user_id'] } },
  );
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return db;
}

const user = () => mintToken({ user_id: 'user-1', group_id: 'group-1' });

describe('Strava answers to an ordinary user', () => {
  it('no Strava answer to an ordinary user carries the global webhook time or the poll state', async () => {
    const db = use();

    const answers = [
      await server.request('GET', '/api/strava/last-sync', { token: user() }),
      await server.request('GET', '/api/strava/status', { token: user() }),
    ];

    for (const answer of answers) {
      const text = JSON.stringify(answer.body);
      expect(text).not.toContain(OTHER_GROUPS_EVENT_AT);
      expect(text).not.toContain(String(OTHER_OWNER_ID));
      expect(text).not.toMatch(/last_webhook_at|last_sync_attempt|next_sync_estimated|users_synced|total_users/);
    }
    // The old endpoint is gone rather than narrowed: nothing answers there, and nothing was read for it.
    expect(answers[0].status).toBe(404);
    expect(db.queries.filter((q) => q.table === 'strava_webhook_events')).toEqual([]);
  });

  it("the user's own status still tells when their newest run was imported", async () => {
    use();

    const res = await server.request('GET', '/api/strava/status', { token: user() });

    expect(res.status).toBe(200);
    expect(res.body.last_import_at).toBe('2026-10-02T08:00:00.000Z');
  });
});
