import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// RUN-214: backendApi loggar via frontendens logger (en enda plats att styra nivåer/maskering),
// inte via console.* direkt (att backendApi.ts inte har några console.*-anrop vaktas av ESLint: no-console i eslint.config.js).
vi.mock('../utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

import { logger } from '../utils/logger';
import { backendApi } from './backendApi';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

function respondWith(status: number, body: object = { error: 'nope' }) {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })));
}

const failingCalls: Array<[string, () => Promise<unknown>]> = [
  ['login', () => backendApi.login('someone', 'wrong')],
  ['changePassword', () => backendApi.changePassword('old', 'new')],
  ['createUser', () => backendApi.createUser('Name', 'a@example.com', 'pw')],
  ['resetUserPassword', () => backendApi.resetUserPassword('u1', 'pw')],
  ['refreshTitleLeaderboards', () => backendApi.refreshTitleLeaderboards()],
];

describe('backendApi: expected and unexpected failures', () => {
  beforeEach(() => {
    localStorage.setItem('runquest_token', 'tok');
  });

  it.each([400, 403, 404, 409, 422, 429])('an expected 4xx API error is not reported (%d)', async (status) => {
    respondWith(status);
    for (const [, call] of failingCalls) await call();

    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('a wrong password (401 on login) is not reported', async () => {
    respondWith(401, { error: 'Invalid credentials' });

    const result = await backendApi.login('someone', 'wrong');

    expect(result).toEqual({ success: false, error: 'Invalid credentials' });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it.each(failingCalls)('a 5xx from %s is reported', async (_name, call) => {
    respondWith(503);

    await call();

    expect(logger.error).toHaveBeenCalled();
  });
});

describe('backendApi logging', () => {
  it('fel loggas via logger.error, inte console.error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await backendApi.login('someone', 'pw');

    expect(res.success).toBe(false);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logger.error).mock.calls[0][1]).toBeInstanceOf(Error);
    expect(consoleError).not.toHaveBeenCalled();
  });
});
