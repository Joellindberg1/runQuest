/**
 * requireAdmin och authenticateJWT loggar bara en felkod när databasen eller JWT-biblioteket felar. Ett PostgREST-fel kan bära
 * radvärden (ett constraint-namn som users_email_key, en e-postadress) i meddelandet, och varje logger.error blir en Sentry-händelse
 * där strängargument blir log_detail och ett Error-objekt blir en exception med sitt meddelande.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { inspect } from 'node:util';
import jwt from 'jsonwebtoken';
import type { Request, Response } from 'express';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';

const single = vi.fn();
vi.mock('../../config/database.js', () => ({
  getSupabaseClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ single }) }) }) }),
}));

import { authenticateJWT } from '../auth.js';
import { requireAdmin } from '../admin.js';
import { startFakeSentry, type FakeSentry } from '../../observability/__tests__/helpers/fakeSentry.js';

const LEAK = 'users_email_key jane.doe@example.com';
const USER = { user_id: 'user-4711', name: 'Jane Doe', email: 'jane.doe@example.com', group_id: 'g-1' };

let spies: Array<ReturnType<typeof vi.spyOn>>;
let sentry: FakeSentry;
beforeEach(() => {
  spies = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
  sentry = startFakeSentry();
});
afterEach(async () => {
  await sentry.stop();
  vi.restoreAllMocks();
  single.mockReset();
});

const logged = () => spies.flatMap((s) => s.mock.calls).map((args: unknown[]) => args.map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 6 }))).join(' ')).join('\n');
const loggedObjects = () => spies.flatMap((s) => s.mock.calls).flat().filter((a: unknown) => a !== null && typeof a === 'object');
const response = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() }) as unknown as Response;
const reported = async () => JSON.stringify(await sentry.drain());

describe('requireAdmin when the database fails', () => {
  it('logs and reports only the error code when the lookup returns a database error', async () => {
    single.mockResolvedValue({ data: null, error: { message: `duplicate key value violates unique constraint "${LEAK}"`, details: `Key (email)=(${LEAK}) already exists.`, code: '23505' } });
    const res = response();
    const next = vi.fn();

    await requireAdmin({ user: USER } as unknown as Request, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Failed to verify admin status' });
    expect(next).not.toHaveBeenCalled();
    expect(logged()).toContain('23505');
    expect(logged()).not.toContain('users_email_key');
    expect(logged()).not.toContain('jane.doe@example.com');
    expect(loggedObjects()).toEqual([]);
    const events = await reported();
    expect(events).toContain('23505');
    expect(events).not.toContain('users_email_key');
    expect(events).not.toContain('jane.doe@example.com');
  });

  it('logs and reports only the error code when the lookup throws', async () => {
    single.mockRejectedValue(Object.assign(new Error(`socket hang up near ${LEAK}`), { code: 'ECONNRESET' }));
    const res = response();

    await requireAdmin({ user: USER } as unknown as Request, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' });
    expect(logged()).toContain('ECONNRESET');
    expect(logged()).not.toContain('users_email_key');
    expect(loggedObjects()).toEqual([]);
    const events = await reported();
    expect(events).toContain('ECONNRESET');
    expect(events).not.toContain('users_email_key');
    expect(events).not.toContain('jane.doe@example.com');
  });
});

describe('authenticateJWT with an invalid token', () => {
  it('answers 401, logs the error name only and sends nothing to Sentry', async () => {
    const res = response();
    const next = vi.fn();
    const forged = jwt.sign(USER, 'another-secret-key');

    authenticateJWT({ headers: { authorization: `Bearer ${forged}` } } as Request, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token' });
    expect(next).not.toHaveBeenCalled();
    expect(logged()).toContain('JsonWebTokenError');
    expect(logged()).not.toContain('invalid signature');
    expect(loggedObjects()).toEqual([]);
    expect(await sentry.drain()).toEqual([]);
  });
});
