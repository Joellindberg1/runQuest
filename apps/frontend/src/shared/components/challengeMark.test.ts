import { describe, expect, it } from 'vitest';
import { PENNANT_PATH, PENNANT_TEXT_X, PENNANT_TEXT_Y, PENNANT_VIEW_BOX } from './challengeMark';

// Vakt (RUN-147, spec F12.4): utmaningstecknet är en vimpel med svalstjärt överallt. Den gamla sköldens path får inte finnas kvar i
// någon kod eller CSS under apps/frontend/src. Testfiler är undantagna — de får nämna sköldens path som NEGATIV kontroll.
const sources = import.meta.glob(
  ['../../**/*.{ts,tsx,css}', '!../../**/*.test.{ts,tsx}'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

// Sköldens bottenspets (V21 L13 30.5 L1.5 21) i valfri blankstegsvariant.
const SHIELD_PATH = /H\s*24\.5\s*V\s*21\b|V\s*21\s*L\s*13\s*30\.5/;

describe('utmaningstecknets delade geometri', () => {
  it('vimpeln har svalstjärt (V30.5 → L13 23.5 → L1.5 30.5), siffran på y 16.5 i viewBox 0 0 26 32', () => {
    expect(PENNANT_PATH).toBe('M1.5 1.5 H24.5 V30.5 L13 23.5 L1.5 30.5 Z');
    expect(PENNANT_TEXT_X).toBe(13);
    expect(PENNANT_TEXT_Y).toBe(16.5);
    expect(PENNANT_VIEW_BOX).toBe('0 0 26 32');
  });

  it('ingen icke-testkod under apps/frontend/src innehåller sköldens path', () => {
    const files = Object.entries(sources);
    expect(files.length).toBeGreaterThan(200); // en tom glob vore ett tyst godkännande
    expect(files.filter(([path]) => path.endsWith('/challengeMark.ts'))).toHaveLength(1);
    const offenders = files.filter(([, text]) => SHIELD_PATH.test(text)).map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it('vakten fäller på sköldens path i alla blankstegsvarianter (mutationskontroll)', () => {
    for (const shield of ['M1.5 1.5 H24.5 V21 L13 30.5 L1.5 21 Z', 'M1.5 1.5H24.5V21L13 30.5L1.5 21Z', 'd="M1.5 1.5 H24.5 V 21 L13 30.5"']) {
      expect(SHIELD_PATH.test(shield)).toBe(true);
    }
    expect(SHIELD_PATH.test(PENNANT_PATH)).toBe(false);
  });

  it('exakt två feature-komponenter ritar utmaningstecknet: Board (BoardParts) och Duels (TierRibbon), båda ur denna fil', () => {
    const users = Object.entries(sources).filter(([, text]) => text.includes('PENNANT_PATH') && !text.includes('export const PENNANT_PATH'));
    expect(users.map(([path]) => path.split('/').pop()).sort()).toEqual(['BoardParts.tsx', 'TierRibbon.tsx']);
  });
});
