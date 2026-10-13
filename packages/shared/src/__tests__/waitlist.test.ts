import { describe, it, expect } from 'vitest';
import {
  WAITLIST_EMAIL_MAX_LENGTH,
  WAITLIST_MIN_ELAPSED_MS,
  WAITLIST_SOURCE_LANDING,
} from '../index.js';

// Samtyckesversionen prövas i dataPolicy.test.ts (den är DATA_POLICY_VERSION).
describe('waitlist constants', () => {
  it('exposes the landing source, the 254-character email limit and the 2-second time trap', () => {
    expect(WAITLIST_SOURCE_LANDING).toBe('landing');
    expect(WAITLIST_EMAIL_MAX_LENGTH).toBe(254);
    expect(WAITLIST_MIN_ELAPSED_MS).toBe(2000);
  });
});
