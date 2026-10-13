import { describe, expect, it } from 'vitest';
import { shownLimitText, signupCountText, signupDateText } from './waitlistModel';

describe('signupCountText', () => {
  it('skriver singular för en anmälan och plural annars', () => {
    expect(signupCountText(0)).toBe('0 signups');
    expect(signupCountText(1)).toBe('1 signup');
    expect(signupCountText(42)).toBe('42 signups');
  });
});

describe('shownLimitText', () => {
  it('säger att listan är kapad först när totalen är större än antalet visade', () => {
    expect(shownLimitText(1000, 1234)).toBe('Showing the latest 1000 of 1234');
    expect(shownLimitText(1000, 1000)).toBeNull();
    expect(shownLimitText(3, 3)).toBeNull();
  });
});

describe('signupDateText', () => {
  it('visar kalenderdagen i Stockholm, inte i UTC', () => {
    expect(signupDateText('2026-10-12T22:30:00Z')).toBe('13 October 2026');
    expect(signupDateText('2026-10-12T12:00:00Z')).toBe('12 October 2026');
  });
});
