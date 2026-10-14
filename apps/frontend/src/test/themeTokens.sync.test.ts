import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss, { type AtRule, type Declaration, type Node, type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

// Temafilen finns i två exemplar: src/index.css (det som körs) och docs/design/temafil-forslag.css (designens facit). Det här är den enda
// platsen som prövar att de hänger ihop och att varje feature-token används. Resten av designspråket vaktas av lint: stylelint.config.js för
// CSS och eslint.config.js för koden. (Stylelint ser en fil i taget, så "är token X deklarerad och används den?" kräver ett test.)

// Sökvägarna i variabler: Vite skriver annars om en bokstavlig new URL('./…', import.meta.url) till en asset-URL.
const SRC_DIR = '..';
const FACIT_PATH = '../../../../docs/design/temafil-forslag.css';
const srcDir = fileURLToPath(new URL(SRC_DIR, import.meta.url));
const read = (file: string) => readFileSync(file, 'utf8');

const sourceFiles = (readdirSync(srcDir, { recursive: true }) as string[]).map((file) => file.replace(/\\/g, '/'));
const cssFiles = sourceFiles.filter((file) => file.endsWith('.css')).map((file) => ({ file, text: read(join(srcDir, file)) }));
const featureCss = cssFiles.filter(({ file }) => file !== 'index.css');
const productionCode = sourceFiles.filter((file) => /\.tsx?$/.test(file) && !/\.(test|fixture)\.tsx?$/.test(file)).map((file) => read(join(srcDir, file)));

const indexCss = cssFiles.find(({ file }) => file === 'index.css')!.text;
const facitCss = read(fileURLToPath(new URL(FACIT_PATH, import.meta.url)));

interface TokenDeclaration { context: string; name: string; value: string }

/** Var deklarationen står: kedjan av selektorer och @-regler runt den ("@media (min-width: 1024px) > :root"). */
function contextOf(decl: Declaration): string {
  const chain: string[] = [];
  for (let parent = decl.parent as Node | undefined; parent && parent.type !== 'root'; parent = parent.parent as Node | undefined) {
    if (parent.type === 'atrule') chain.unshift(`@${(parent as AtRule).name} ${(parent as AtRule).params}`);
    else if (parent.type === 'rule') chain.unshift((parent as Rule).selector);
  }
  return chain.join(' > ');
}

function tokenDeclarations(css: string): TokenDeclaration[] {
  const found: TokenDeclaration[] = [];
  postcss.parse(css).walkDecls((decl) => {
    if (decl.prop.startsWith('--')) found.push({ context: contextOf(decl), name: decl.prop, value: decl.value.replace(/\s+/g, ' ').trim() });
  });
  return found;
}

/** Tokens som en CSS-text läser: var(--x) i värden (kommentarer räknas inte). */
function tokenReads(css: string): Set<string> {
  const reads = new Set<string>();
  postcss.parse(css).walkDecls((decl) => {
    for (const match of decl.value.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) reads.add(match[1]);
  });
  return reads;
}

/** Deklarationerna i den regel vars selektor är exakt `selector` i en feature-CSS (sökväg relativt src). */
function declarationsOf(file: string, selector: string): Record<string, string> {
  const css = cssFiles.find((candidate) => candidate.file === file);
  expect({ file, finns: css !== undefined }).toEqual({ file, finns: true });
  const found: Record<string, string> = {};
  postcss.parse(css!.text).walkRules(selector, (rule) => {
    rule.walkDecls((decl) => {
      found[decl.prop] = decl.value.replace(/\s+/g, ' ').trim();
    });
  });
  expect({ selector, deklarationer: Object.keys(found).length > 0 }).toEqual({ selector, deklarationer: true });
  return found;
}

const indexTokens = tokenDeclarations(indexCss);
const declaredInIndex = new Set(indexTokens.map(({ name }) => name));

// Måtten varje feature äger i temafilen. En feature utan prefix här (form, skalet) har inga egna mått i temafilen.
const FEATURE_TOKEN_PREFIXES = [
  'admin', 'settings', 'playbook', 'login', 'badge', 'duels', 'board', 'changelog', 'whatsnew', 'events', 'landing', 'log', 'news', 'profile', 'runner', 'titles',
];

/** Minsta tryckyta: 44 px för tumme (mobil), 24 px för muspekare (desktop). */
const MIN_TOUCH_TARGET_PX = 44;
const MIN_POINTER_TARGET_PX = 24;

describe('temafilerna hänger ihop', () => {
  it('src/index.css och docs/design/temafil-forslag.css deklarerar exakt samma tokens med samma värden i samma sammanhang', () => {
    const lines = (css: string) => tokenDeclarations(css).map(({ context, name, value }) => `${context} | ${name}: ${value}`);
    const index = lines(indexCss);
    const facit = lines(facitCss);
    expect(index.length).toBeGreaterThan(500); // en tom parsning vore ett tyst godkännande
    expect({ bara_i_index: index.filter((line) => !facit.includes(line)), bara_i_facit: facit.filter((line) => !index.includes(line)) }).toEqual({
      bara_i_index: [],
      bara_i_facit: [],
    });
  });

  it('varje --rq-token som en feature-CSS läser är deklarerad: i temafilen, i filen själv eller satt från koden (cssVars)', () => {
    const setFromCode = (name: string) => productionCode.some((code) => code.includes(`'${name}'`) || code.includes(`"${name}"`) || code.includes(`\`${name}`));
    const undeclared = featureCss.map(({ file, text }) => {
      const local = new Set(tokenDeclarations(text).map(({ name }) => name));
      const missing = [...tokenReads(text)].filter((name) => name.startsWith('--rq-') && !declaredInIndex.has(name) && !local.has(name) && !setFromCode(name));
      return { file, missing };
    });
    expect(featureCss.length).toBeGreaterThan(15);
    expect(undeclared.filter(({ missing }) => missing.length > 0)).toEqual([]);
  });

  it('ingen feature-token i temafilen är oanvänd: varje --rq-<feature>-mått läses av någon CSS (eller av ett annat mått)', () => {
    const readTokens = new Set(cssFiles.flatMap(({ text }) => [...tokenReads(text)]));
    for (const prefix of FEATURE_TOKEN_PREFIXES) {
      const owned = [...declaredInIndex].filter((name) => name.startsWith(`--rq-${prefix}-`));
      expect({ prefix, finns: owned.length > 0 }).toEqual({ prefix, finns: true });
      expect({ prefix, oanvanda: owned.filter((name) => !readTokens.has(name)) }).toEqual({ prefix, oanvanda: [] });
    }
  });

  it('varje token som desktop-blocket (min-width: 1024px) sätter har också ett mobilvärde utanför blocket', () => {
    const desktop = indexTokens.filter(({ context }) => context.includes('min-width: 1024px'));
    const mobile = new Set(indexTokens.filter(({ context }) => !context.includes('@media')).map(({ name }) => name));
    expect(desktop.length).toBeGreaterThan(20);
    expect(desktop.filter(({ name }) => !mobile.has(name)).map(({ name }) => name)).toEqual([]);
  });

  it('tryckytorna i notispanelen (reglaradens höjd och länkknapparna) är minst 44 px på mobil och minst 24 px på desktop', () => {
    const px = (name: string, inDesktopBlock: boolean) => {
      const found = indexTokens.filter((token) => token.name === name && token.context.includes('min-width: 1024px') === inDesktopBlock && !token.context.includes('.light'));
      expect({ name, antal: found.length }).toEqual({ name, antal: 1 });
      return Number.parseFloat(found[0].value);
    };
    for (const name of ['--rq-switch-row-min-h', '--rq-notify-link-hit']) {
      expect(px(name, false)).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
      expect(px(name, true)).toBeGreaterThanOrEqual(MIN_POINTER_TARGET_PX);
    }
  });

  it('reglaget: på är grönt (färgundantaget) och av-spåret har en 1 px ram, så läget syns mot ytan', () => {
    const rootValue = (name: string) => indexTokens.find((token) => token.name === name && !token.context.includes('@media'))?.value;
    expect(rootValue('--rq-toggle-on')).toBe('var(--rq-up)');
    expect(rootValue('--rq-toggle-on-knob')).toBe('var(--rq-on-up)');
    expect(declarationsOf('shared/components/form/form.css', '.rq-switch').border).toBe('var(--rq-hair) solid var(--rq-text-3)');
  });

  it('länkknapparna i notispanelen (Retry, Reset to defaults) får sin tryckyta ur --rq-notify-link-hit', () => {
    const link = declarationsOf('features/settings/settings.css', '.rq-notify__link.rq-btn--link');
    expect({ höjd: link['min-height'], bredd: link['min-width'] }).toEqual({ höjd: 'var(--rq-notify-link-hit)', bredd: 'var(--rq-notify-link-hit)' });
  });

  it('reducerad rörelse kapas globalt i temafilen: animationerna spelas en gång och feature-CSS behöver ingen egen regel', () => {
    const kapar: string[] = [];
    postcss.parse(indexCss).walkAtRules('media', (media) => {
      if (!media.params.includes('prefers-reduced-motion: reduce')) return;
      media.walkDecls('animation-iteration-count', (decl) => {
        if (decl.value === '1' && decl.important) kapar.push(decl.parent && 'selector' in decl.parent ? decl.parent.selector : '');
      });
    });
    expect(kapar).toEqual(['*, *::before, *::after']);
  });
});
