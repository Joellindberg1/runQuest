import { describe, expect, it } from 'vitest';
import { PENNANT_PATH, PENNANT_TEXT_X, PENNANT_TEXT_Y, PENNANT_VIEW_BOX } from './challengeMark';

// Utmaningstecknet är en vimpel med svalstjärt överallt (spec F12.4). Att den gamla sköldens path inte finns kvar i någon ts/tsx-fil under
// apps/frontend/src vaktas av ESLint (DESIGN_EVERYWHERE i eslint.config.js); här ligger geometrin och vilka som ritar den.
const sources = import.meta.glob(
  ['../../**/*.{ts,tsx}', '!../../**/*.test.{ts,tsx}'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

describe('utmaningstecknets delade geometri', () => {
  it('vimpeln har svalstjärt (V30.5 → L13 23.5 → L1.5 30.5), siffran på y 16.5 i viewBox 0 0 26 32', () => {
    expect(PENNANT_PATH).toBe('M1.5 1.5 H24.5 V30.5 L13 23.5 L1.5 30.5 Z');
    expect(PENNANT_TEXT_X).toBe(13);
    expect(PENNANT_TEXT_Y).toBe(16.5);
    expect(PENNANT_VIEW_BOX).toBe('0 0 26 32');
  });

  it('exakt två feature-komponenter ritar utmaningstecknet: Board (BoardParts) och Duels (TierRibbon), båda ur denna fil', () => {
    const users = Object.entries(sources).filter(([, text]) => text.includes('PENNANT_PATH') && !text.includes('export const PENNANT_PATH'));
    expect(users.map(([path]) => path.split('/').pop()).sort()).toEqual(['BoardParts.tsx', 'TierRibbon.tsx']);
  });
});
