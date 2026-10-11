import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Council 20: "Got it" har ingen permanent guldring. Fokus visas bara med den globala :focus-visible-ringen (--rq-focus-ring) — aldrig som outline,
// box-shadow-ring eller ringkant som ligger på hela tiden. Vakten läser badges.css, så en framtida stilregel som lägger tillbaka ringen fångas här.

// Sökvägen i en variabel: Vite skulle annars göra om en bokstavlig new URL('./…', import.meta.url) till en asset-URL.
const CSS_PATH = './badges.css';
const css = readFileSync(fileURLToPath(new URL(CSS_PATH, import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({ selector: match[1].trim(), body: match[2] }));
const popupButtonRules = rules.filter(({ selector }) => /rq-badge-popup__(btn|close)/.test(selector));

describe('popupens knappar: ingen permanent ring (Council 20)', () => {
  it('hittar popupens knappregler (Got it / Skip all och ✕)', () => {
    expect(popupButtonRules.length).toBeGreaterThanOrEqual(3);
  });

  it('ingen outline, box-shadow eller --rq-focus-ring på knapparna utanför :focus-visible', () => {
    for (const { selector, body } of popupButtonRules) {
      if (selector.includes(':focus-visible')) continue;
      expect({ selector, ring: body.match(/outline|box-shadow|--rq-focus-ring/g) ?? [] }).toEqual({ selector, ring: [] });
    }
  });

  it('ingen :focus-regel (utan -visible) styr knapparna: musfokus ska aldrig ge en ring', () => {
    const selectors = rules.map(({ selector }) => selector).filter((selector) => /rq-badge-popup/.test(selector));
    expect(selectors.filter((selector) => /:focus(?!-visible)/.test(selector))).toEqual([]);
  });

  it('vakten är inte tom: den skulle slå till på en ring', () => {
    const sample = '.rq-btn--primary.rq-badge-popup__btn { box-shadow: 0 0 0 2px var(--rq-gold); outline: var(--rq-focus-ring); }';
    const hit = [...sample.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((match) => /rq-badge-popup__(btn|close)/.test(match[1]) && /outline|box-shadow/.test(match[2]));
    expect(hit).toHaveLength(1);
  });
});
