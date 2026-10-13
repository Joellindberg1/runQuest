import { describe, it, expect } from 'vitest';
import { INVALID_IDEMPOTENCY_KEY_ERROR, parseIdempotencyKey } from '../idempotencyKey.js';

const KEY = '3f2b8c1e-5d4a-4b7e-9c3a-1a2b3c4d5e6f';

describe('parseIdempotencyKey', () => {
  it('saknad header → ok utan nyckel', () => {
    expect(parseIdempotencyKey(undefined)).toEqual({ ok: true, key: null });
  });

  it('godkänner uuid v4 och normaliserar till gemener', () => {
    expect(parseIdempotencyKey(KEY)).toEqual({ ok: true, key: KEY });
    expect(parseIdempotencyKey(KEY.toUpperCase())).toEqual({ ok: true, key: KEY });
    expect(parseIdempotencyKey(`  ${KEY}  `)).toEqual({ ok: true, key: KEY });
  });

  it.each([
    ['tom sträng', ''],
    ['fritext', 'not-a-uuid'],
    ['uuid v1', 'c232ab00-9414-11ec-b3c8-9f6bdeced846'],
    ['fel variant', '3f2b8c1e-5d4a-4b7e-cc3a-1a2b3c4d5e6f'],
    ['uuid utan bindestreck', '3f2b8c1e5d4a4b7e9c3a1a2b3c4d5e6f'],
    ['två nycklar (upprepad header)', `${KEY}, ${KEY}`],
    ['uuid med efterhängt skräp', `${KEY}x`],
  ])('avvisar %s', (_name, value) => {
    expect(parseIdempotencyKey(value)).toEqual({ ok: false, error: INVALID_IDEMPOTENCY_KEY_ERROR });
  });

  it('avvisar en array', () => {
    expect(parseIdempotencyKey([KEY, KEY])).toEqual({ ok: false, error: INVALID_IDEMPOTENCY_KEY_ERROR });
  });
});
