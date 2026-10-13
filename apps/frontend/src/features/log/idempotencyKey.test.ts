import { afterEach, describe, expect, it, vi } from 'vitest';
import { newIdempotencyKey } from './idempotencyKey';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('newIdempotencyKey', () => {
  it('ger en uuid v4, och en ny varje gång', () => {
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a).toMatch(UUID_V4);
    expect(b).toMatch(UUID_V4);
    expect(a).not.toBe(b);
  });

  it('utan crypto.randomUUID (osäkert sammanhang) byggs en giltig v4 ur getRandomValues', () => {
    vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array) => a.fill(0xff) });
    expect(newIdempotencyKey()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array) => a.fill(0) });
    expect(newIdempotencyKey()).toBe('00000000-0000-4000-8000-000000000000');
  });
});
