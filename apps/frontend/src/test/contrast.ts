import postcss, { type AtRule, type Rule } from 'postcss';

// Kontrastmetoden som alla kontrastvakter delar: WCAG 2.x relativ luminans, alfa som komposit över det som ligger under, och tokens lästa ur index.css (inte kopierade färger).
// Används av features/badges/guards.test.ts (nivåchippet) och src/test/contrastGuard.test.ts (de nya tokenparen). En metod, inte två.

export type Rgb = number[];
export interface Rgba { rgb: Rgb; alpha: number }
export type Theme = 'dark' | 'light';
export const THEMES: readonly Theme[] = ['dark', 'light'];

const channel = (value: number) => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
export const luminance = ([r, g, b]: Rgb) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
export const contrast = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** `fg` med `alpha` komponerad över en ogenomskinlig `bg`. */
export const over = (fg: Rgb, alpha: number, bg: Rgb): Rgb => fg.map((value, i) => value * alpha + bg[i] * (1 - alpha));
/** Lagren nerifrån och upp, där det understa är ogenomskinligt (appens skal). */
export const flatten = (layers: Rgba[]): Rgb => layers.slice(1).reduce((below, layer) => over(layer.rgb, layer.alpha, below), layers[0].rgb);
export const toHex = (rgb: Rgb) => `#${rgb.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;

/** Delar vid komma utanför parenteser ("a, rgb(1, 2, 3)" blir två delar). */
export function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') depth -= 1;
    else if (text[i] === ',' && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts.filter((part) => part !== '');
}

const alphaOf = (text: string) => (text.endsWith('%') ? Number(text.slice(0, -1)) / 100 : Number(text));

/** Färgformerna temat använder: #rgb/#rrggbb/#rrggbbaa, rgb()/rgba() med komma eller blanksteg och "/ alfa", transparent och color-mix(in srgb, …). */
export function parseColor(value: string): Rgba {
  const text = value.trim();
  if (text === 'transparent') return { rgb: [0, 0, 0], alpha: 0 };
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(text)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
    const [r, g, b] = [0, 2, 4].map((offset) => parseInt(full.slice(offset, offset + 2), 16));
    return { rgb: [r, g, b], alpha: full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1 };
  }
  const functional = /^rgba?\((.+)\)$/i.exec(text)?.[1];
  if (functional) {
    const [r, g, b, a] = functional.split(/[\s,/]+/).filter((part) => part !== '');
    return { rgb: [Number(r), Number(g), Number(b)], alpha: a === undefined ? 1 : alphaOf(a) };
  }
  const mix = /^color-mix\(\s*in srgb\s*,(.+)\)$/i.exec(text)?.[1];
  if (mix) {
    const [first, second] = splitTopLevel(mix).map((part) => {
      const withPercent = /^(.*\S)\s+([\d.]+)%$/.exec(part);
      return { color: parseColor(withPercent ? withPercent[1] : part), percent: withPercent ? Number(withPercent[2]) : undefined };
    });
    const firstShare = (first.percent ?? (second.percent === undefined ? 50 : 100 - second.percent)) / 100;
    const secondShare = (second.percent ?? 100 - firstShare * 100) / 100;
    const alpha = first.color.alpha * firstShare + second.color.alpha * secondShare;
    const rgb = first.color.rgb.map((value, i) => (value * first.color.alpha * firstShare + second.color.rgb[i] * second.color.alpha * secondShare) / (alpha || 1));
    return { rgb, alpha };
  }
  throw new Error(`Okänt färgformat: "${value}"`);
}

const isRootRule = (node: { type: string; parent?: unknown }): node is Rule => node.type === 'rule' && (node.parent as { type?: string } | undefined)?.type === 'root';
const selectorsOf = (rule: Rule) => splitTopLevel(rule.selector);

/**
 * Temats tokens: mörkt = alla toppnivå-:root, ljust = dessa med [data-theme="light"] över (som kaskaden gör). @media-block räknas inte med: de byter mått och skuggor,
 * och `mediaTokenNames` visar vilka tokens som även deklareras där så att en vakt kan vägra mäta ett token vars värde beror på bredden.
 */
export function themeTokens(indexCss: string, theme: Theme): Map<string, string> {
  const tokens = new Map<string, string>();
  const root = postcss.parse(indexCss);
  const selectors = theme === 'light' ? [':root', '[data-theme="light"]'] : [':root'];
  for (const selector of selectors) {
    root.each((node) => {
      if (!isRootRule(node) || !selectorsOf(node).includes(selector)) return;
      node.walkDecls(/^--/, (decl) => { tokens.set(decl.prop, decl.value.replace(/\s+/g, ' ').trim()); });
    });
  }
  return tokens;
}

/** Tokens som sätts i ett @media-block för just detta tema: :root gäller båda temana, [data-theme="light"] bara det ljusa. */
export function mediaTokenNames(indexCss: string, theme: Theme): Set<string> {
  const names = new Set<string>();
  const selectors = theme === 'light' ? [':root', '[data-theme="light"]'] : [':root'];
  postcss.parse(indexCss).walkAtRules('media', (atRule: AtRule) => {
    atRule.walkRules((rule) => {
      if (!selectorsOf(rule).some((selector) => selectors.includes(selector))) return;
      rule.walkDecls(/^--/, (decl) => { names.add(decl.prop); });
    });
  });
  return names;
}

/** Temats tokens där ett token som sätts i @media inte får läsas: värdet beror på bredden, så ett försök att mäta det fäller i klartext. */
export function refusingMediaTokens(tokens: Map<string, string>, mediaNames: Set<string>, theme: Theme): Map<string, string> {
  const guarded = new Map(tokens);
  guarded.get = (name: string) => {
    if (mediaNames.has(name)) throw new Error(`Token ${name} sätts även i ett @media-block i index.css (${theme === 'light' ? 'ljust tema' : 'mörkt tema'}): värdet beror på skärmbredden och kan inte mätas, uppdatera vakten`);
    return Map.prototype.get.call(tokens, name) as string | undefined;
  };
  return guarded;
}

/** Ersätter var(--x) tills inget återstår. `scope` (lokala custom properties ur en regel) går före temats tokens. */
export function resolveVars(value: string, lookup: (name: string) => string | undefined): string {
  let current = value;
  for (let depth = 0; depth < 25; depth += 1) {
    const next = current.replace(/var\(\s*(--[\w-]+)\s*\)/g, (_match, name: string) => {
      const found = lookup(name);
      if (found === undefined) throw new Error(`Token ${name} finns inte (värdet "${value}")`);
      return found;
    });
    if (next === current) return next.trim();
    current = next;
  }
  throw new Error(`Cirkulär token i "${value}"`);
}

export function resolveColor(tokens: Map<string, string>, value: string, scope?: Map<string, string>): Rgba {
  return parseColor(resolveVars(value, (name) => scope?.get(name) ?? tokens.get(name)));
}
