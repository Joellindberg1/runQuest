import { describe, expect, it } from 'vitest';
import { createRouteMatcher } from './routeMatcher';

describe('createRouteMatcher', () => {
  const match = createRouteMatcher(['/', '/board', '/runner/:id', '/preview', '/preview/badges']);

  it('returns the route pattern, never the address that was matched', () => {
    expect(match('/board')).toBe('/board');
    expect(match('/runner/3f2b8c1e-9d4a-4e7b-8a61-5c0d2e9f7a14')).toBe('/runner/:id');
    expect(match('/')).toBe('/');
  });

  it('prefers a fixed address over a dynamic pattern that would also cover it', () => {
    const withShadow = createRouteMatcher(['/runner/:id', '/runner/me']);
    expect(withShadow('/runner/me')).toBe('/runner/me');
    expect(withShadow('/runner/anna')).toBe('/runner/:id');
  });

  it('ignores case, a trailing slash and doubled slashes the way the router does', () => {
    expect(match('/Board/')).toBe('/board');
    expect(match('/RUNNER/abc')).toBe('/runner/:id');
    expect(match('/board//')).toBe('/board');
    expect(match('//board')).toBe('/board');
  });

  it('matches nothing for an address that is not a known route', () => {
    for (const address of ['', 'board', '/nowhere', '/board/extra', '/runner/', '/runner/a/b', '/preview/other']) {
      expect(match(address)).toBeUndefined();
    }
  });

  it('only knows the routes it was given', () => {
    expect(createRouteMatcher(['/board'])('/runner/abc')).toBeUndefined();
  });
});
