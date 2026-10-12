import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Designreglerna för Events (tokens, skarpa hörn, ikoner, inga emojis, bara en sweep som animation, inga transitions, att CSS-måtten finns i
// temafilen) vaktas av lint: eslint.config.js, stylelint.config.js och src/test/themeTokens.sync.test.ts.

// CSS läses från disk: vitest (css: false) tömmer ?raw-importer av .css, så en glob ger tomma strängar och tysta godkännanden.
const readFromDisk = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const css = readFromDisk('./events.css').replace(/\/\*[\s\S]*?\*\//g, '');

describe('Events — rörelse', () => {
  it('ett kort som väntar på avräkning har ingen sweep', () => {
    expect(css).toMatch(/\[data-state="settling"\]::before\s*\{\s*display:\s*none/);
  });
});
