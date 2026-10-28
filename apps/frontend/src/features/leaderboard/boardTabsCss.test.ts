import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postcss, { type Declaration, type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

// Flikradens stil (boardTabs.css). jsdom har ingen layout och vitest kör med css: false, så det stilen ska garantera prövas här mot filen, och i webbläsaren mot det byggda
// bygget (e2e: mått, 44 px, fade, ring). Färg- och px-förbuden vaktas av stylelint.

// Sökvägarna i variabler: Vite skriver annars om en bokstavlig new URL('./…', import.meta.url).
const TABS_FILE = './boardTabs.css';
const BOARD_FILE = './board.css';
const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const tabsCss = read(TABS_FILE);
const boardCss = read(BOARD_FILE);

function declarationsOf(text: string, selector: string): Record<string, string> {
  const found: Record<string, string> = {};
  postcss.parse(text).walkRules((rule: Rule) => {
    if (rule.selectors.includes(selector)) rule.walkDecls((decl: Declaration) => { found[decl.prop] = decl.value.replace(/\s+/g, ' ').trim(); });
  });
  expect({ selector, deklarationer: Object.keys(found).length > 0 }).toEqual({ selector, deklarationer: true });
  return found;
}

describe('the tab row of the board', () => {
  it('scrolls sideways in its own area, with equal tabs that never shrink below their text, instead of widening the page', () => {
    const row = declarationsOf(tabsCss, '.rq-board__tabs');
    expect(row['overflow-x']).toBe('auto');
    const tab = declarationsOf(tabsCss, '.rq-board__tabs > [role="tab"]');
    expect(tab.flex).toBe('1');
    expect(tab['white-space']).toBe('nowrap');
    expect(declarationsOf(tabsCss, '.rq-board__tabs-wrap')['min-width']).toBe('0');
  });

  it('sizes the fade from the same token as the scroll padding, so a selected tab kept clear of the zone is clear of the fade', () => {
    const zone = declarationsOf(tabsCss, '.rq-board__tabs')['scroll-padding-inline'];
    expect(zone).toBe('var(--rq-sp-24)');
    const fades = [
      '.rq-board__tabs-wrap[data-fade-start="true"] > .rq-board__tabs',
      '.rq-board__tabs-wrap[data-fade-end="true"] > .rq-board__tabs',
      '.rq-board__tabs-wrap[data-fade-start="true"][data-fade-end="true"] > .rq-board__tabs',
    ];
    for (const selector of fades) {
      const mask = declarationsOf(tabsCss, selector)['mask-image'];
      expect({ selector, zone: mask?.includes(zone) }).toEqual({ selector, zone: true });
    }
  });

  it('is not in board.css, which the landing also loads: the row belongs to the Board page alone', () => {
    expect(boardCss).not.toContain('data-fade');
    expect(boardCss).not.toContain('overflow-x');
  });
});
