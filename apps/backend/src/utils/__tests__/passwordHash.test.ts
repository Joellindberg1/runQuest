import { describe, it, expect } from 'vitest';
import bcrypt from 'bcryptjs';
import { BCRYPT_COST, getDummyPasswordHash } from '../passwordHash.js';

describe('passwordHash', () => {
  it('makes the dummy hash at the same cost as real password hashes', async () => {
    const hash = await getDummyPasswordHash();

    expect(bcrypt.getRounds(hash)).toBe(BCRYPT_COST);
  });

  it('gives the same dummy hash on every call', async () => {
    expect(await getDummyPasswordHash()).toBe(await getDummyPasswordHash());
  });

  it('makes a dummy hash that no plausible password matches', async () => {
    const hash = await getDummyPasswordHash();

    expect(await bcrypt.compare('', hash)).toBe(false);
    expect(await bcrypt.compare('password', hash)).toBe(false);
  });
});
