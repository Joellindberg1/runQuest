import { describe, expect, it } from 'vitest';
import { isInternalPath } from './internalPath';

describe('isInternalPath', () => {
  it.each([
    ['a path', '/board'],
    ['a path with a query', '/board?view=week'],
    ['a path with a query and a hash', '/duels?view=live#top'],
    ['the root', '/'],
    ['an encoded slash, which stays a path', '/%2f'],
  ])('accepts %s', (_name, value) => {
    expect(isInternalPath(value)).toBe(true);
  });

  it.each([
    ['a protocol-relative address', '//evil.com'],
    ['a protocol-relative address after a path start', '///evil.com'],
    ['a backslash after the slash', '/\\evil.com'],
    ['an absolute address', 'https://evil.com'],
    ['a path without the leading slash', 'board'],
    ['a tab after the slash, which the browser removes', '/\t/evil.com'],
    ['a tab right after the slash', '/\ttx'],
    ['a line break', '/\n/evil.com'],
    ['a carriage return', '/\r/evil.com'],
    ['a delete character', '/\u007f/evil.com'],
    ['an empty string', ''],
    ['a number', 42],
    ['null', null],
    ['undefined', undefined],
    ['an object', { pathname: '/board' }],
  ])('rejects %s', (_name, value) => {
    expect(isInternalPath(value)).toBe(false);
  });
});
