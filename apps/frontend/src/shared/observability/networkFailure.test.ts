import { describe, expect, it } from 'vitest';
import { isNetworkFailure } from './networkFailure';

describe('isNetworkFailure', () => {
  it.each([
    'Failed to fetch',
    'Failed to fetch (api.runquest.dev)',
    'NetworkError when attempting to fetch resource.',
    'Load failed',
    'Load failed (api.runquest.dev)',
  ])('recognises "%s" as a request that got no response', (message) => {
    expect(isNetworkFailure(new TypeError(message))).toBe(true);
    expect(isNetworkFailure(message)).toBe(true);
  });

  it('lets real errors and non-errors through', () => {
    expect(isNetworkFailure(new Error('Request failed with status 500'))).toBe(false);
    expect(isNetworkFailure(new Error('Cannot read properties of undefined (reading "load failed")'))).toBe(false);
    expect(isNetworkFailure(undefined)).toBe(false);
  });
});
