/**
 * Loggraderna i authenticateJWT och requireAdmin identifierar användaren med user_id, aldrig med namn eller e-post
 * (samma regel som för det som skickas till Sentry).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';
import type { Request, Response } from 'express';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';

const single = vi.fn();
vi.mock('../../config/database.js', () => ({
  getSupabaseClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ single }) }) }) }),
}));

import { authenticateJWT } from '../auth.js';
import { requireAdmin } from '../admin.js';

const USER = { user_id: 'user-4711', name: 'Jane Doe', email: 'jane.doe@example.com', group_id: 'g-1' };

let logSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => { logSpy = vi.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); single.mockReset(); });

const logged = () => logSpy.mock.calls.map((args: unknown[]) => args.map(String).join(' ')).join('\n');
const response = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() }) as unknown as Response;

describe('identity in log lines', () => {
  it('authenticateJWT logs the user_id and not the name or e-mail', () => {
    const token = jwt.sign(USER, process.env.JWT_SECRET as string);
    const next = vi.fn();
    authenticateJWT({ headers: { authorization: `Bearer ${token}` } } as Request, response(), next);

    expect(next).toHaveBeenCalled();
    expect(logged()).toContain('user-4711');
    expect(logged()).not.toContain('Jane Doe');
    expect(logged()).not.toContain('jane.doe@example.com');
  });

  it.each([
    ['admin', { data: { is_admin: true }, error: null }],
    ['not admin', { data: { is_admin: false }, error: null }],
  ])('requireAdmin logs the user_id and not the name (%s)', async (_label, result) => {
    single.mockResolvedValue(result);
    await requireAdmin({ user: USER } as unknown as Request, response(), vi.fn());

    expect(logged()).toContain('user-4711');
    expect(logged()).not.toContain('Jane Doe');
  });
});
