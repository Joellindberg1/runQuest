/**
 * GET /api/strava/last-sync: the global sync status plus `last_webhook_at`, the time of the newest stored webhook event, so that
 * Settings/admin can see that webhooks are alive (ADR 010). Only a timestamp, never an owner, an object or a count. Through the real
 * app; the database is createFakeDb.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import app from '../../app.js';
import { resetLastWebhookCache } from '../../services/stravaLastWebhook.js';
import { createFakeDb, type FakeDbOptions, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });

let lines: string[];
beforeEach(() => {
  vi.clearAllMocks();
  resetLastWebhookCache();
  lines = [];
  for (const level of ['info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
      lines.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg, Object.getOwnPropertyNames(Object(arg))))).join(' '));
    });
  }
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const event = (id: number, receivedAt: string, over: Row = {}): Row => ({
  id, dedupe_key: `k${id}`, owner_id: 555111, object_id: 987654321, status: 'done', received_at: receivedAt, ...over,
});

function use(events: Row[], failWhen?: FakeDbOptions['failWhen']) {
  const db = createFakeDb({ strava_webhook_events: events }, { autoIds: true, failWhen });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return { queries: db.queries };
}

const lastSync = () => server.request('GET', '/api/strava/last-sync', { token: mintToken({ user_id: 'user-1', group_id: 'group-1' }) });

describe('GET /api/strava/last-sync', () => {
  it('last-sync response includes last_webhook_at (null when no events)', async () => {
    use([]);
    const empty = await lastSync();
    expect(empty.status).toBe(200);
    expect(empty.body.data).toHaveProperty('last_webhook_at', null);
    expect(empty.body.data).toHaveProperty('last_sync_status'); // the existing fields are still there

    resetLastWebhookCache();
    use([event(1, '2026-10-14T08:00:00.000Z'), event(3, '2026-10-15T09:30:00.000Z'), event(2, '2026-10-15T07:00:00.000Z', { status: 'dead' })]);
    const filled = await lastSync();
    expect(filled.status).toBe(200);
    expect(filled.body.data.last_webhook_at).toBe('2026-10-15T09:30:00.000Z');
  });

  it('shows the timestamp only, nothing about owners, objects or counts', async () => {
    use([event(1, '2026-10-15T09:30:00.000Z')]);

    const res = await lastSync();

    expect(JSON.stringify(res.body)).not.toMatch(/555111|987654321|owner|object/);
    expect(Object.keys(res.body.data).sort()).toEqual([
      'last_sync_attempt', 'last_sync_status', 'last_webhook_at', 'new_runs', 'next_sync_estimated', 'total_users', 'users_synced',
    ]);
  });

  it('a failed read of the events gives null and a warning with the code only, and the rest of the status is still answered', async () => {
    const leak = 'failed for owner 555111 object 987654321';
    use([event(1, '2026-10-15T09:30:00.000Z')], (q) => (q.table === 'strava_webhook_events' ? (Object.assign(new Error(leak), { code: 'W0001', details: leak }) as never) : null));

    const res = await lastSync();

    expect(res.status).toBe(200);
    expect(res.body.data.last_webhook_at).toBeNull();
    expect(res.body.data).toHaveProperty('last_sync_status');
    expect(lines.some((line) => line.includes('W0001'))).toBe(true);
    expect(lines.filter((line) => line.includes('555111') || line.includes('987654321'))).toEqual([]);
  });

  it('reads the events at most once a minute and tries again after a failed read', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-15T10:00:00.000Z'));
    const first = use([event(1, '2026-10-15T09:30:00.000Z')]);

    await lastSync();
    await lastSync();
    expect(first.queries.filter((q) => q.table === 'strava_webhook_events')).toHaveLength(1);

    // A newer event shows after the minute.
    const second = use([event(1, '2026-10-15T09:30:00.000Z'), event(2, '2026-10-15T10:00:30.000Z')]);
    vi.setSystemTime(new Date('2026-10-15T10:01:01.000Z'));
    const later = await lastSync();
    expect(later.body.data.last_webhook_at).toBe('2026-10-15T10:00:30.000Z');
    expect(second.queries.filter((q) => q.table === 'strava_webhook_events')).toHaveLength(1);

    // A failed read is not remembered as "no events": the next request asks again.
    resetLastWebhookCache();
    let failing = true;
    const third = use([event(1, '2026-10-15T09:30:00.000Z')], (q) => (q.table === 'strava_webhook_events' && failing ? ({ message: 'down', code: 'W0002' } as never) : null));
    expect((await lastSync()).body.data.last_webhook_at).toBeNull();
    failing = false;
    expect((await lastSync()).body.data.last_webhook_at).toBe('2026-10-15T09:30:00.000Z');
    expect(third.queries.filter((q) => q.table === 'strava_webhook_events')).toHaveLength(2);
  });

  it('refuses a request without a token', async () => {
    use([]);

    const res = await server.request('GET', '/api/strava/last-sync');

    expect(res.status).toBe(401);
  });
});
