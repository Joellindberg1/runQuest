import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Designreglerna för Duels (tokens, skarpa hörn, ikoner, inga emojis, rörelse, att CSS-måtten finns i temafilen) vaktas av lint:
// eslint.config.js, stylelint.config.js och src/test/themeTokens.sync.test.ts. Kvar här är det lint inte kan uttrycka: att vimpeln
// och nivåfärgerna hämtas ur de delade definitionerna.

const sources = import.meta.glob(['./components/TierRibbon.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

// CSS läses från disk: vitest (css: false) tömmer ?raw-importer av .css, så en glob ger tomma strängar och tysta godkännanden.
const readFromDisk = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const css = readFromDisk('./duels.css');

describe('Duels hämtar vimpel och nivåfärger ur de delade definitionerna', () => {
  it('TierRibbon ritar vimpeln ur den delade geometrin (challengeMark), inte en egen path', () => {
    const ribbon = sources['./components/TierRibbon.tsx'];
    expect(ribbon).toContain("from '@/shared/components/challengeMark'");
    expect(ribbon).toContain('d={PENNANT_PATH}');
  });

  it('vimpeln återanvänder Boards mått, och de finns i temafilen', () => {
    const index = readFromDisk('../../index.css');
    for (const name of ['--rq-board-ribbon-w', '--rq-board-ribbon-h', '--rq-board-ribbon-font']) {
      expect({ name, used: css.includes(`var(${name})`), declared: new RegExp(`^\\s*${name}:`, 'm').test(index) }).toEqual({ name, used: true, declared: true });
    }
  });

  it('nivåfärgerna kommer ur tier-tokens (minor/major/legendary), inte egna färger', () => {
    for (const tier of ['minor', 'major', 'legendary']) {
      for (const part of ['', '-rgb', '-fg', '-stroke']) {
        expect(css).toContain(`var(--rq-tier-${tier}${part})`);
      }
    }
  });
});
