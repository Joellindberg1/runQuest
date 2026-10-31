import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Samlingskortets yta är neutral (STATE.md): nivåfärgen (`--rq-badge-*`) hör till emblemet, chippet och pipsen, aldrig till kortets bakgrund. Vakten läser kortets alla regler, både i badges.css och i
// popupens egna regler i runner.css, så en ny ytfärg på korten fälls oavsett vilken fil den läggs i. CSS läses från disk: vitest (css: false) tömmer ?raw-importer av .css.

const readFromDisk = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '');

interface Rule {
  selector: string;
  body: string;
}

/** Regler på toppnivå och inuti @media/@container (klammerräknande: kapslade block följer med utan att tappa sin väljare). */
function rulesOf(css: string): Rule[] {
  const rules: Rule[] = [];
  const walk = (text: string) => {
    let cursor = 0;
    while (cursor < text.length) {
      const open = text.indexOf('{', cursor);
      if (open < 0) break;
      const head = text.slice(cursor, open).trim();
      let depth = 1;
      let end = open + 1;
      while (end < text.length && depth > 0) {
        if (text[end] === '{') depth += 1;
        else if (text[end] === '}') depth -= 1;
        end += 1;
      }
      const inner = text.slice(open + 1, end - 1);
      if (head.startsWith('@')) walk(inner);
      else rules.push({ selector: head, body: inner });
      cursor = end;
    }
  };
  walk(css);
  return rules;
}

const SURFACE_PROPERTY = /(?:^|[;\s])(background(?:-color|-image)?)\s*:\s*([^;}]*)/g;
const BADGE_TOKEN = /--rq-badge-|--rq-emblem-/;

/** Alla bakgrundsdeklarationer i regler vars väljare nämner kortet (`.rq-badge-card`, inklusive dess delar och modifierare). */
function cardSurfaces(css: string): Array<{ selector: string; property: string; value: string }> {
  return rulesOf(stripComments(css))
    .filter((rule) => rule.selector.includes('.rq-badge-card'))
    .flatMap((rule) => [...rule.body.matchAll(SURFACE_PROPERTY)].map(([, property, value]) => ({ selector: rule.selector, property, value: value.trim() })));
}

const cardCss = [
  ['badges.css', readFromDisk('./badges.css')],
  ['runner.css', readFromDisk('../runner/runner.css')],
] as const;

describe('samlingskortets yta är neutral', () => {
  it('finds the card rules, so the guard below cannot pass on an empty selection', () => {
    const all = cardCss.flatMap(([, css]) => rulesOf(stripComments(css)).filter((rule) => rule.selector.includes('.rq-badge-card')));
    expect(all.length).toBeGreaterThan(10);
    expect(cardCss.flatMap(([, css]) => cardSurfaces(css)).some((surface) => surface.selector === '.rq-badge-card')).toBe(true);
  });

  it('no card rule uses a --rq-badge-* (or --rq-emblem-*) token as a background', () => {
    for (const [file, css] of cardCss) {
      const offending = cardSurfaces(css).filter((surface) => BADGE_TOKEN.test(surface.value));
      expect({ file, offending }).toEqual({ file, offending: [] });
    }
  });

  it('the card surface is the neutral row tint', () => {
    const base = cardSurfaces(readFromDisk('./badges.css')).find((surface) => surface.selector === '.rq-badge-card');
    expect(base?.value).toBe('var(--rq-row-soft)');
  });
});
