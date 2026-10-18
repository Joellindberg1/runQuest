/**
 * .env.example is committed, so it describes the token key variables (ADR 013 decision 12) but holds no value for them: a real key in
 * the repository is a leak, and a copied example must start the backend with the Strava track off (fail-closed), not with a shared key.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ACTIVE_KEY_ENV, RETIRED_KEYS_ENV } from '../utils/secretBox.js';

const example = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');
const lines = example.split(/\r?\n/);

describe('.env.example token key variables', () => {
  it('lists both variables and leaves them empty', () => {
    expect(lines).toContain(`${ACTIVE_KEY_ENV}=`);
    expect(lines).toContain(`${RETIRED_KEYS_ENV}=`);
  });

  it('describes the key format and how to generate a key', () => {
    expect(example).toContain('<kid>:<base64 av exakt 32 byte>');
    expect(example).toMatch(/randomBytes\(32\)\.toString\('base64'\)/);
    expect(example).toContain('prod-');
    expect(example).toContain('docs/runbook-token-key.md');
  });

  it('holds nothing shaped like a key: no kid:base64 value of 32 bytes anywhere in the file', () => {
    // 32 bytes of standard base64 is 44 characters ending in "=". The example's own placeholders are shorter and carry angle brackets.
    expect(example).not.toMatch(/[a-z0-9][a-z0-9-]{0,15}:[A-Za-z0-9+/]{43}=/);
    expect(example).not.toMatch(/[A-Za-z0-9+/]{43}=/);
  });
});
