import { describe, expect, it } from 'vitest';
import { getInitials } from './formatters';

describe('getInitials — first and last name, at most two letters', () => {
  it('gives the first and the last name initial, so Anna Maria Lindqvist is AL', () => {
    expect(getInitials('Anna Maria Lindqvist')).toBe('AL');
    expect(getInitials('Joel Lindberg')).toBe('JL');
  });

  it('gives one letter for a single name', () => {
    expect(getInitials('Karl')).toBe('K');
  });

  it('upper-cases, and ignores extra whitespace', () => {
    expect(getInitials('  anna   lindqvist ')).toBe('AL');
  });

  it('falls back to a question mark when there is no name', () => {
    expect(getInitials('')).toBe('?');
    expect(getInitials('   ')).toBe('?');
  });
});
