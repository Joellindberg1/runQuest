/**
 * Integritetstexten säger vad Strava-importen sparar. Den här vakten läser routes/strava.ts som text och fäller om koden får ett
 * fält som texten (STRAVA_IMPORTED_FIELDS i packages/shared/src/legal/dataPolicy.ts) inte nämner. Ingen ändring i strava.ts:
 * ändras importen ska fältlistan, texten och DATA_POLICY_VERSION ändras samtidigt. Behålls till v0.7.0 (RUN-93).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { STRAVA_IMPORTED_FIELDS, getDataPolicySection } from '@runquest/shared';

const source = readFileSync(fileURLToPath(new URL('../routes/strava.ts', import.meta.url)), 'utf8');

/** Nycklarna (`namn:` eller kortform `namn,`) i ett objekt-literal-block, en per rad. */
const keysOf = (block: string): string[] => [...block.matchAll(/^\s*([a-z_][a-z0-9_]*)\s*[:,]/gim)].map((match) => match[1]);

/** Fälten som extractExtendedFields returnerar: objektet efter `return {` i funktionen. */
const extendedFields = (): string[] => {
  const fn = source.indexOf('function extractExtendedFields(');
  expect(fn, 'extractExtendedFields finns i strava.ts').toBeGreaterThanOrEqual(0);
  const open = source.indexOf('return {', fn);
  const close = source.indexOf('\n  };', open);
  expect(open, 'return-objektet finns').toBeGreaterThan(fn);
  expect(close, 'return-objektet har ett slut').toBeGreaterThan(open);
  return keysOf(source.slice(open + 'return {'.length, close));
};

/** Insert-anropet i synken: fälten före XP-platshållarna, utan de interna nycklarna user_id och source. */
const insertFields = (): string[] => {
  const insertAt = source.indexOf(".from('runs').insert({");
  expect(insertAt, 'insert-anropet för Strava-rundor finns').toBeGreaterThanOrEqual(0);
  const placeholders = source.indexOf('// XP placeholders', insertAt);
  expect(placeholders, 'XP-platshållarna efter insert-fälten').toBeGreaterThan(insertAt);
  const internal = new Set(['user_id', 'source']);
  return keysOf(source.slice(insertAt, placeholders)).filter((key) => !internal.has(key));
};

describe('dataPolicy strava fields', () => {
  it('every field extractExtendedFields imports is named in the strava section', () => {
    const imported = [...extendedFields(), ...insertFields()];
    // Vakten måste se fälten för att vara något värd: en regex som tyst missar allt ska fälla.
    expect(imported).toEqual(expect.arrayContaining(['start_time', 'suffer_score', 'is_treadmill', 'date', 'distance', 'external_id']));
    expect(new Set(imported).size).toBe(imported.length);

    const listed = STRAVA_IMPORTED_FIELDS.map((field) => field.key);
    expect([...imported].sort()).toEqual([...listed].sort());

    const stravaText = getDataPolicySection('strava')!.paragraphs.join('\n');
    for (const key of imported) {
      const field = STRAVA_IMPORTED_FIELDS.find((candidate) => candidate.key === key);
      expect(field, `${key} saknas i STRAVA_IMPORTED_FIELDS`).toBeDefined();
      expect(stravaText, `${key}: etiketten "${field!.label}" står i Strava-avsnittet`).toContain(field!.label);
    }
  });
});
