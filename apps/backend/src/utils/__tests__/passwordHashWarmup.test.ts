import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('bcryptjs', () => ({
  default: { hash: vi.fn(), compare: vi.fn() },
  hash: vi.fn(),
  compare: vi.fn(),
}));

import bcrypt from 'bcryptjs';

const FAKE_DUMMY_HASH = '$2a$10$FAKE_DUMMY_HASH_for_tests_only_not_a_real_hash_xxxxxxxxxxxx';

async function freshModule() {
  vi.resetModules();
  return import('../passwordHash.js');
}

describe('warmUpDummyPasswordHash', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('makes the dummy hash once, so the first login after a start does not pay for it', async () => {
    vi.mocked(bcrypt.hash).mockResolvedValue(FAKE_DUMMY_HASH as never);
    const { warmUpDummyPasswordHash, getDummyPasswordHash } = await freshModule();

    warmUpDummyPasswordHash();
    const hash = await getDummyPasswordHash();

    expect(hash).toBe(FAKE_DUMMY_HASH);
    expect(vi.mocked(bcrypt.hash)).toHaveBeenCalledTimes(1);
  });

  it('does not wait for the hash and does not throw or reject when making it fails', async () => {
    vi.mocked(bcrypt.hash).mockRejectedValueOnce(new Error('hash failed') as never);
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const { warmUpDummyPasswordHash, getDummyPasswordHash } = await freshModule();

    expect(warmUpDummyPasswordHash()).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 0));
    process.off('unhandledRejection', unhandled);

    expect(unhandled).not.toHaveBeenCalled();
    vi.mocked(bcrypt.hash).mockResolvedValue(FAKE_DUMMY_HASH as never);
    expect(await getDummyPasswordHash()).toBe(FAKE_DUMMY_HASH);
  });
});
