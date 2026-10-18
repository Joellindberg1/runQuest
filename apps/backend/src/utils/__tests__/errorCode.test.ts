import { describe, it, expect } from 'vitest';
import { errorCode } from '../errorCode.js';

describe('errorCode', () => {
  it('uses the code of a database error', () => {
    expect(errorCode({ message: 'duplicate key (email)=(jane@example.com)', code: '23505' })).toBe('23505');
  });

  it('falls back to the name when there is no code', () => {
    expect(errorCode(new TypeError('boom with jane@example.com'))).toBe('TypeError');
  });

  it('falls back to the name when the code is an empty string', () => {
    expect(errorCode({ code: '', name: 'PostgrestError', message: 'row value leak' })).toBe('PostgrestError');
  });

  it('falls back to unknown when both the code and the name are empty', () => {
    expect(errorCode({ code: '', name: '' })).toBe('unknown');
  });

  it('returns unknown for values without a code or a name', () => {
    expect(errorCode(null)).toBe('unknown');
    expect(errorCode(undefined)).toBe('unknown');
    expect(errorCode('a string with jane@example.com')).toBe('unknown');
  });

  it('keeps only safe characters and at most 40 of them', () => {
    expect(errorCode({ code: 'a b@c.d' })).toBe('abc.d');
    expect(errorCode({ code: 'x'.repeat(100) })).toHaveLength(40);
  });
});
