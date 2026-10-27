import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postcss, { type AtRule, type Declaration, type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

// Träffytan och fokusringen går inte att mäta i jsdom (ingen layout), så reglerna som gör dem sanna vaktas här; måtten i en riktig
// webbläsare är mätta i Chromium (se rapporten för RUN-412). Stylelint vaktar att filen bara använder tokens.
const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const controlsCss = postcss.parse(read('./view-controls.css'));
const themeCss = postcss.parse(read('../../index.css'));

const isInsideMedia = (rule: Rule) => rule.parent?.type === 'atrule' && (rule.parent as AtRule).name === 'media';

/** Värdet reglerna med exakt denna selektorlista sätter på en egenskap. */
function valueOf(selectors: string[], prop: string): string | undefined {
  let found: string | undefined;
  controlsCss.walkRules((rule) => {
    if (rule.selectors.join(',') !== selectors.join(',')) return;
    rule.walkDecls(prop, (decl: Declaration) => {
      found = decl.value;
    });
  });
  return found;
}

/** Mobilvärdet (utanför mediefrågor) och desktopvärdet (inne i dem) av en token i temafilen. */
function tokenValues(name: string): { mobile: string[]; desktop: string[] } {
  const mobile: string[] = [];
  const desktop: string[] = [];
  themeCss.walkDecls(name, (decl) => {
    const rule = decl.parent as Rule;
    (isInsideMedia(rule) ? desktop : mobile).push(decl.value);
  });
  return { mobile, desktop };
}

const BUTTONS = ['.rq-segmented > .rq-filter', '[role="tablist"] > .rq-filter', '[role="tablist"] > .rq-tab'];
const FOCUSED = ['.rq-segmented > .rq-filter:focus-visible', '[role="tablist"] > .rq-filter:focus-visible'];
const FOCUSED_SELECTED = ['.rq-segmented > .rq-filter[aria-pressed="true"]:focus-visible', '[role="tablist"] > .rq-filter[aria-selected="true"]:focus-visible'];

describe('flikrad och segmenterad kontroll — träffyta och fokusring', () => {
  it('knapparna är minst 44 px höga på mobil och släpper kravet på desktop', () => {
    expect(tokenValues('--rq-control-hit')).toEqual({ mobile: ['44px'], desktop: ['0px'] });
    expect(valueOf(BUTTONS, 'min-height')).toBe('var(--rq-control-hit)');
  });

  it('fokusringen ritas innanför knappen, och på den valda knappen i textfärgen så den skiljs från guldramen', () => {
    expect(valueOf(FOCUSED, 'outline-offset')).toBe('var(--rq-focus-inset)');
    expect(valueOf(FOCUSED_SELECTED, 'outline-color')).toBe('var(--rq-text-1)');
    // Guld som linje räcker inte mot ljus yta (brons 2,8:1): ringen tar guldfärgen avsedd för text, som är ≥ 3:1 i båda temana.
    expect(valueOf(FOCUSED, 'outline-color')).toBe('var(--rq-gold-text)');
  });
});
