import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// RUN-214: backendApi loggar via frontendens logger (en enda plats att styra nivåer/maskering),
// inte via console.* direkt (att backendApi.ts inte har några console.*-anrop vaktas av ESLint: no-console i eslint.config.js).
vi.mock('../utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

import { logger } from '../utils/logger';
import { backendApi } from './backendApi';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
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
