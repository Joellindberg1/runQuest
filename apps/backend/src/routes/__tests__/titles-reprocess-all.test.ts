/**
 * RUN-158: POST /api/titles/reprocess-all svarade alltid 200 success, även när användare misslyckades
 * (processAllUsersTitles räknar fel sedan RUN-157 men routen kastade bort räknarna). Admin-underhållet ska få
 * ett ärligt svar: antal totalt/klara/misslyckade, och en status som avslöjar delvis fel.
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

const processAllUsersTitles = vi.hoisted(() => vi.fn());
vi.mock('../../services/enhancedTitleService', () => ({ enhancedTitleService: { processAllUsersTitles } }));
vi.mock('../../services/enhancedTitleService.js', () => ({ enhancedTitleService: { processAllUsersTitles } }));

import { getSupabaseClient } from '../../config/database.js';
import app from '../../app.js';
import { createFakeDb } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });

function asAdmin(isAdmin = true) {
  const db = createFakeDb({ users: [{ id: 'admin-1', is_admin: isAdmin }] });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
}
const post = () => server.request('POST', '/api/titles/reprocess-all', { token: mintToken({ user_id: 'admin-1' }) });

beforeEach(() => { vi.clearAllMocks(); asAdmin(); });

describe('POST /api/titles/reprocess-all', () => {
  it('alla lyckas: 200, success true och räknarna', async () => {
    processAllUsersTitles.mockResolvedValue({ total: 6, processed: 6, failed: 0 });

    const res = await post();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, total: 6, processed: 6, failed: 0 });
    expect(processAllUsersTitles).toHaveBeenCalledWith(undefined, { emitNews: false, allGroups: true });
  });

  it('några användare misslyckas: 207, success false och räknarna — inte "success"', async () => {
    processAllUsersTitles.mockResolvedValue({ total: 6, processed: 4, failed: 2 });

    const res = await post();

    expect(res.status).toBe(207);
    expect(res.body).toMatchObject({ success: false, total: 6, processed: 4, failed: 2 });
    expect(res.body.message).toBe('2 of 6 users failed; the rest were recalculated');
  });

  it('alla misslyckas: 500 med räknarna', async () => {
    processAllUsersTitles.mockResolvedValue({ total: 3, processed: 0, failed: 3 });

    const res = await post();

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ success: false, total: 3, processed: 0, failed: 3 });
    expect(res.body.message).toBe('All 3 users failed');
    expect(res.body.error).toBe(res.body.message); // ADR 007 A1: 5xx bär error bredvid message (additivt)
  });

  it('noll användare är inget fel: 200', async () => {
    processAllUsersTitles.mockResolvedValue({ total: 0, processed: 0, failed: 0 });

    const res = await post();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, total: 0, processed: 0, failed: 0 });
  });

  it('ett kast i omräkningen: 500 som förut', async () => {
    processAllUsersTitles.mockRejectedValue(new Error('Users fetch failed'));

    const res = await post();

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to reprocess titles' });
  });

  it('kräver admin', async () => {
    asAdmin(false);

    const res = await post();

    expect(res.status).toBe(403);
    expect(processAllUsersTitles).not.toHaveBeenCalled();
  });
});
