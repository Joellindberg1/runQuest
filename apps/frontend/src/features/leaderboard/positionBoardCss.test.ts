import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postcss, { type Declaration, type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

// Stilen för Position-fliken (graf, "Current order", tabell) och dess tokens. jsdom har ingen layout och vitest kör med css: false, så det som
// stilen ska garantera prövas här mot filerna, och i webbläsaren mot det byggda bygget (mått, kontraster, fokusring). Färg-, px- och rörelseförbuden
// vaktas av stylelint; kvar här är det lint inte uttrycker: att rätt token bär rätt roll.

// Sökvägarna i variabler: Vite skriver annars om en bokstavlig new URL('./…', import.meta.url).
const CSS_FILE = './positionBoard.css';
const INDEX_FILE = '../../index.css';
const FACIT_FILE = '../../../../../docs/design/temafil-forslag.css';
const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const css = read(CSS_FILE);
const indexCss = read(INDEX_FILE);
const facitCss = read(FACIT_FILE);

/** Deklarationerna i reglerna vars selektor är exakt `selector`. */
function declarationsOf(text: string, selector: string): Record<string, string> {
  const found: Record<string, string> = {};
  postcss.parse(text).walkRules((rule: Rule) => {
    if (rule.selectors.includes(selector)) rule.walkDecls((decl: Declaration) => { found[decl.prop] = decl.value.replace(/\s+/g, ' ').trim(); });
  });
  expect({ selector, deklarationer: Object.keys(found).length > 0 }).toEqual({ selector, deklarationer: true });
  return found;
}

/** Ett tokenvärde i :root (mobil) eller i desktop-blocket (min-width: 1024px). */
function tokenOf(text: string, name: string, desktop: boolean): string | undefined {
  let value: string | undefined;
  postcss.parse(text).walkDecls(name, (decl) => {
    const inDesktop = decl.parent?.parent?.type === 'atrule' && /min-width:\s*1024px/.test((decl.parent.parent as postcss.AtRule).params);
    const inLight = /light/.test((decl.parent as Rule).selector ?? '');
    if (!inLight && inDesktop === desktop) value = decl.value.replace(/\s+/g, ' ').trim();
  });
  return value;
}

const px = (value: string | undefined) => Number.parseFloat(value ?? 'NaN');

const COLOUR_TOKENS = {
  '--rq-board-position-line-me': 'var(--rq-gold)',
  '--rq-board-position-line-on': 'var(--rq-text-2)',
  '--rq-board-position-grid': 'var(--rq-line-2)',
} as const;

const NEW_TOKENS = [
  '--rq-board-position-line', '--rq-board-position-line-me', '--rq-board-position-line-on', '--rq-board-position-dot', '--rq-board-position-label',
  '--rq-board-position-grid', '--rq-board-position-core', '--rq-board-position-dim',
  '--rq-board-position-line-w', '--rq-board-position-line-w-on', '--rq-board-position-line-w-me', '--rq-board-position-line-w-me-on',
  '--rq-board-position-dot-size', '--rq-board-position-dot-size-me', '--rq-board-position-hollow', '--rq-board-position-endpoint', '--rq-board-position-initials-fs',
  '--rq-board-position-axis-w', '--rq-board-position-pad-x', '--rq-board-position-name-gap', '--rq-board-position-name-max', '--rq-board-position-name-fs', '--rq-board-position-toggle-h', '--rq-board-position-order-h', '--rq-board-position-order-gap', '--rq-board-position-order-avatar', '--rq-board-position-place-w',
];

describe('the tokens of the position chart', () => {
  it('are declared in the theme file and in the design facit, as aliases of colours that already exist', () => {
    for (const [name, text] of [['index.css', indexCss], ['temafil-forslag.css', facitCss]] as const) {
      for (const token of NEW_TOKENS) expect({ name, token, value: tokenOf(text, token, false) !== undefined }).toEqual({ name, token, value: true });
      for (const [token, value] of Object.entries(COLOUR_TOKENS)) expect({ name, token, value: tokenOf(text, token, false) }).toEqual({ name, token, value });
      for (const token of ['--rq-board-position-line', '--rq-board-position-dot', '--rq-board-position-label', '--rq-board-position-core']) {
        expect({ name, token, alias: /^var\(--rq-[a-z0-9-]+\)$/.test(tokenOf(text, token, false) ?? '') }).toEqual({ name, token, alias: true });
      }
    }
  });

  it('give your line gold and a thicker stroke than the others, and the selected line one thicker still, so the state shows without colour', () => {
    const w = (name: string) => px(tokenOf(indexCss, `--rq-board-position-${name}`, false));
    expect(w('line-w-me')).toBeGreaterThan(w('line-w-on'));
    expect(w('line-w-on')).toBeGreaterThan(w('line-w'));
    expect(w('line-w-me-on')).toBeGreaterThan(w('line-w-me'));
    expect(tokenOf(indexCss, '--rq-board-position-dim', false)).toBe('.25');
  });

  it('keep the picture at least 24 px and the initials at least 10 px, mobile and desktop', () => {
    expect(px(tokenOf(indexCss, '--rq-board-position-endpoint', false))).toBeGreaterThanOrEqual(24);
    expect(px(tokenOf(indexCss, '--rq-board-position-endpoint', true))).toBeGreaterThanOrEqual(24);
    expect(px(tokenOf(indexCss, '--rq-board-position-initials-fs', false))).toBeGreaterThanOrEqual(10);
    expect(px(tokenOf(indexCss, '--rq-board-position-name-fs', false))).toBeGreaterThanOrEqual(11);
  });
});

describe('the stylesheet of the position chart', () => {
  it('colours your line with the gold token and every other line with the one neutral alias', () => {
    const base = declarationsOf(css, '.rq-board-position__line');
    expect(base.stroke).toBe('var(--rq-board-position-line)');
    expect(declarationsOf(css, '.rq-board-position__line[data-me="true"]').stroke).toBe('var(--rq-board-position-line-me)');
    expect(declarationsOf(css, '.rq-board-position__line[data-selected="true"]').stroke).toBe('var(--rq-board-position-line-on)');
    // Ingen palett: inga regler per ordningsnummer eller id.
    expect(css).not.toMatch(/nth-(child|of-type)|\[data-line=/);
  });

  it('thickens the selected line and the name, and dims the rest to the dim token', () => {
    expect(declarationsOf(css, '.rq-board-position__line')['stroke-width']).toBe('var(--rq-board-position-line-w)');
    expect(declarationsOf(css, '.rq-board-position__line[data-selected="true"]')['stroke-width']).toBe('var(--rq-board-position-line-w-on)');
    expect(declarationsOf(css, '.rq-board-position__line[data-me="true"][data-selected="true"]')['stroke-width']).toBe('var(--rq-board-position-line-w-me-on)');
    expect(declarationsOf(css, '.rq-board-position__name[data-selected="true"]')['font-weight']).toBe('700');
    expect(declarationsOf(css, '.rq-board-position__line[data-dimmed="true"]').opacity).toBe('var(--rq-board-position-dim)');
    expect(declarationsOf(css, '.rq-board-position__name[data-dimmed="true"]').opacity).toBe('var(--rq-board-position-dim)');
  });

  it('draws the line once and moves nothing: no animation, no transition, no keyframes, also under prefers-reduced-motion', () => {
    const moving: string[] = [];
    const sheet = postcss.parse(css);
    sheet.walkDecls((decl) => { if (/^(-webkit-)?(animation|transition)/.test(decl.prop)) moving.push(decl.prop); });
    sheet.walkAtRules('keyframes', (rule) => { moving.push(`@keyframes ${rule.params}`); });
    expect(sheet.nodes.length).toBeGreaterThan(20);
    expect(moving).toEqual([]);
  });

  it('has no glow: no filter, no blur and no text shadow anywhere, and a box shadow only as the card shadow of the panels', () => {
    const glow: string[] = [];
    postcss.parse(css).walkDecls((decl) => {
      const selector = (decl.parent as Rule).selector;
      if (/filter|blur|text-shadow/.test(decl.prop) || /drop-shadow|blur\(/.test(decl.value)) glow.push(`${selector} ${decl.prop}`);
      if (decl.prop === 'box-shadow' && decl.value !== 'var(--rq-card-shadow)' && decl.value !== 'none') glow.push(`${selector} ${decl.prop}: ${decl.value}`);
    });
    expect(glow).toEqual([]);
  });

  it('sets every font size from a token and none below 11 px', () => {
    const sizes: string[] = [];
    postcss.parse(css).walkDecls('font-size', (decl) => { sizes.push(decl.value); });
    expect(sizes.length).toBeGreaterThan(5);
    expect(sizes.filter((value) => !/^var\(--rq-(fs-[a-z-]+|board-position-[a-z-]*fs)\)$/.test(value))).toEqual([]);
    for (const value of sizes) {
      const token = /var\((--[a-z0-9-]+)\)/.exec(value)![1];
      const size = px(tokenOf(indexCss, token, false));
      expect({ token, size: size >= 11 }).toEqual({ token, size: true });
    }
  });
});

describe('the tokens and the stylesheet of Current order', () => {
  it('make a row at least 44 px on mobile and at least 24 px on desktop, and a picture of 24 px', () => {
    expect(px(tokenOf(indexCss, '--rq-board-position-order-h', false))).toBeGreaterThanOrEqual(44);
    expect(px(tokenOf(indexCss, '--rq-board-position-order-h', true))).toBeGreaterThanOrEqual(24);
    expect(px(tokenOf(indexCss, '--rq-board-position-order-avatar', false))).toBeGreaterThanOrEqual(24);
  });

  it('give each row a minimum height from the token (a row that wraps grows, it is never clipped) and an inward focus ring', () => {
    const row = declarationsOf(css, '.rq-board-position-order__row');
    expect(row['min-height']).toBe('var(--rq-board-position-order-h)');
    expect(row.height).toBeUndefined();
    expect(row.overflow).toBeUndefined();
    const focus = declarationsOf(css, '.rq-board-position-order__row:focus-visible');
    expect(focus.outline).toBe('var(--rq-focus-ring)');
    expect(focus['outline-offset']).toBe('var(--rq-focus-inset)');
  });

  it('show the selected row without colour: a text tag "Shown" in the markup and a border, and the name never ellipsised', () => {
    expect(declarationsOf(css, '.rq-board-position-order__row[aria-pressed="true"]')['border-color']).toBe('var(--rq-board-position-line-on)');
    const name = declarationsOf(css, '.rq-board-position-order__name');
    expect(name['text-overflow']).toBeUndefined();
    expect(name['overflow-wrap']).toBe('anywhere');
  });

  it('put the chart and Current order side by side only from 1024 px: one column by default, two columns inside the desktop query', () => {
    const sheet = postcss.parse(css);
    const isBoard = (node: postcss.ChildNode): node is Rule => node.type === 'rule' && /\.rq-board-position$/.test(node.selector);
    const decls = (rules: Rule[]) => rules.flatMap((rule) => rule.nodes.filter((node): node is Declaration => node.type === 'decl'));
    const byDefault = decls(sheet.nodes.filter(isBoard));
    const desktop = decls(
      sheet.nodes
        .filter((node): node is postcss.AtRule => node.type === 'atrule' && node.name === 'media' && /min-width:\s*1024px/.test(node.params))
        .flatMap((block) => (block.nodes ?? []).filter(isBoard)),
    );

    expect(byDefault.map((decl) => decl.prop)).not.toContain('grid-template-columns');
    expect(desktop.find((decl) => decl.prop === 'grid-template-columns')?.value).toMatch(/var\(--rq-board-side-w\)/);
  });
});
