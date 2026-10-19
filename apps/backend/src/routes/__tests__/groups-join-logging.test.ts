/**
 * Invite-koden är en hemlighet som ger tillträde till en grupp: POST /api/groups/join får aldrig skriva den i loggen
 * (varken vid försök, lyckad join eller fel), men ska fortfarande fungera som förut.
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

import { getSupabaseClient } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import app from '../../app.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { membershipRpc } from './helpers/fakeMembership.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });

const logged: string[] = [];
beforeEach(() => {
  logged.length = 0;
  // '📨'-raderna kommer från request-loggern i app.ts (RUN-214/F2 äger den); här gäller bara routens egna loggrader.
  const capture = (m: string, ...args: unknown[]) => {
    if (m.startsWith('📨')) return;
    logged.push([m, ...args.map((a) => JSON.stringify(a))].join(' '));
  };
  vi.spyOn(logger, 'info').mockImplementation(capture);
  vi.spyOn(logger, 'warn').mockImplementation(capture);
  vi.spyOn(logger, 'error').mockImplementation(capture);
});
afterEach(() => { vi.restoreAllMocks(); });

function use(tables: Record<string, Row[]>) {
  vi.mocked(getSupabaseClient).mockReturnValue(createFakeDb(tables, { rpc: membershipRpc(tables) }).client as any);
}

const join = (code: string) => server.request('POST', '/api/groups/join', {
  token: mintToken({ user_id: 'user-1', group_id: null }), body: { invite_code: code },
});

describe('POST /api/groups/join — invite_code i loggen', () => {
  it('does not log the invite code on a successful join, and still joins', async () => {
    const tables = { groups: [{ id: 'g1', name: 'Crew', invite_code: 'SECRET42' }], users: [{ id: 'user-1', group_id: null }] };
    use(tables);

    const res = await join('secret42');

    expect(res.status).toBe(200);
    expect(tables.users[0].group_id).toBe('g1');
    expect(logged.join('\n')).not.toMatch(/secret42/i);
  });

  it('does not log the invite code on an invalid code either', async () => {
    use({ groups: [], users: [{ id: 'user-1', group_id: null }] });

    const res = await join('WRONGCODE');

    expect(res.status).toBe(404);
    expect(logged.join('\n')).not.toMatch(/wrongcode/i);
  });
});
