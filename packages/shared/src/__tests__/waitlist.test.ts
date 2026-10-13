import { describe, it, expect } from 'vitest';
import {
  WAITLIST_CONSENT_VERSION,
  WAITLIST_EMAIL_MAX_LENGTH,
  WAITLIST_MIN_ELAPSED_MS,
  WAITLIST_SOURCE_LANDING,
} from '../index.js';

describe('waitlist constants', () => {
  it('the consent version is a non-empty provisional draft marker until the final text exists', () => {
    expect(WAITLIST_CONSENT_VERSION).toMatch(/^draft-\d{4}-\d{2}-\d{2}$/);
  });

  it('exposes the landing source, the 254-character email limit and the 2-second time trap', () => {
    expect(WAITLIST_SOURCE_LANDING).toBe('landing');
    expect(WAITLIST_EMAIL_MAX_LENGTH).toBe(254);
    expect(WAITLIST_MIN_ELAPSED_MS).toBe(2000);
  });
});
