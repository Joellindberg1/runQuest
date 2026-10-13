import { describe, expect, it } from 'vitest';
import { LEGAL_CANONICAL_URL, LEGAL_PAGE_DESCRIPTION, splitOnEmail } from './legalModel';

const EMAIL = 'someone@example.com';

describe('splitOnEmail', () => {
  it('turns every occurrence of the address into its own part and keeps the text intact', () => {
    const paragraph = `Write to ${EMAIL} or to ${EMAIL}.`;
    const parts = splitOnEmail(paragraph, EMAIL);
    expect(parts.map((part) => part.kind)).toEqual(['text', 'email', 'text', 'email', 'text']);
    expect(parts.map((part) => part.text).join('')).toBe(paragraph);
  });

  it('returns one text part when the address is absent, and handles an address that is the whole paragraph', () => {
    expect(splitOnEmail('No contact here.', EMAIL)).toEqual([{ kind: 'text', text: 'No contact here.' }]);
    expect(splitOnEmail(EMAIL, EMAIL)).toEqual([{ kind: 'email', text: EMAIL }]);
  });
});

describe('legal page metadata', () => {
  it('keeps the description free of digits and the canonical absolute', () => {
    expect(LEGAL_PAGE_DESCRIPTION).not.toMatch(/\d/);
    expect(LEGAL_CANONICAL_URL).toBe('https://www.runquest.dev/legal');
  });
});
