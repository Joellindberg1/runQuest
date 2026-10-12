import { describe, expect, it } from 'vitest';

// Designreglerna för Profile (tokens, skarpa hörn, ikoner, inga emojis, rörelse, att CSS-måtten finns i temafilen, det döda toast-flödet)
// vaktas av lint: eslint.config.js, stylelint.config.js och src/test/themeTokens.sync.test.ts. Att multiplikatortrappan kommer ur
// config-endpointen (ingen streakConstants, ingen DEFAULT_STREAK_MULTIPLIERS) vaktas också av ESLint.

const sources = import.meta.glob(
  ['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}', '!./**/*.fixture.ts', '../runs/**/*.{ts,tsx}', '!../runs/**/*.test.{ts,tsx}', '../../pages/ProfilePage.tsx'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

const codeFiles = Object.entries(sources);
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('Profile bygger på delade definitioner, inte egna kopior', () => {
  it('nivåring och XP kommer ur shared-matematiken via runnerModel (ADR 004): inga egna nivåformler', () => {
    for (const [path, text] of codeFiles) {
      const code = stripComments(text);
      expect({ path, own: /getXPForLevel|getXPForNextLevel|xpForLevel|levelFromXP/.test(code) }).toEqual({ path, own: false });
    }
  });

  it('PUT/DELETE går genom EN invalideringskedja (features/runs/runEffects) — inga egna invalidateQueries i Profile-hooks för rundor', () => {
    const changes = sources['./hooks/useRunChanges.ts'];
    expect(changes).toMatch(/invalidateAfterRunChange/);
    expect(stripComments(changes)).not.toMatch(/invalidateQueries/);
  });
});
