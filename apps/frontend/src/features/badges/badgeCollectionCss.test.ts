import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Samlingens stil (RUN-128): skelettets puls respekterar reduced-motion, rutnätet och skelettets takt läser tokens, och BADGES-panelens stil ligger här (flyttad
// från runner.css). CSS läses från disk: vitest (css: false) tömmer ?raw-importer av .css.

const readFromDisk = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '');
const badgesCss = stripComments(readFromDisk('./badges.css'));
const runnerCss = stripComments(readFromDisk('../runner/runner.css'));
const indexCss = readFromDisk('../../index.css');
const facitCss = readFromDisk('../../../../../docs/design/temafil-forslag.css');

/** Texten inuti varje `@media (<query>) { … }`-block (med klammerräkning, så kapslade regler följer med). */
function mediaBodies(code: string, query: string): string[] {
  const bodies: string[] = [];
  let from = code.indexOf(`@media (${query})`);
  while (from >= 0) {
    const open = code.indexOf('{', from);
    let depth = 1;
    let end = open + 1;
    while (end < code.length && depth > 0) {
      if (code[end] === '{') depth += 1;
      else if (code[end] === '}') depth -= 1;
      end += 1;
    }
    bodies.push(code.slice(open + 1, end - 1));
    from = code.indexOf(`@media (${query})`, end);
  }
  return bodies;
}

describe('skelettet (F8)', () => {
  const noPreference = mediaBodies(badgesCss, 'prefers-reduced-motion: no-preference').join('\n');
  const outsideMotion = mediaBodies(badgesCss, 'prefers-reduced-motion: no-preference').reduce((code, body) => code.replace(body, ''), badgesCss);

  it('pulsen (rqSkel) i --rq-dur-badge-skel och staggern i --rq-badge-skel-stagger ligger i no-preference-blocket', () => {
    expect(noPreference).toMatch(/animation:\s*rqSkel var\(--rq-dur-badge-skel\) linear/);
    expect(noPreference).toMatch(/\.rq-badge-skel:nth-child\(2\)[^{]*\{[^}]*animation-delay:\s*var\(--rq-badge-skel-stagger\)/);
    expect(noPreference).toMatch(/\.rq-badge-skel:nth-child\(3\)[^{]*\{[^}]*animation-delay:\s*calc\(var\(--rq-badge-skel-stagger\) \* 2\)/);
  });

  it('reduced-motion: ingenting utanför no-preference-blocket animerar skelettet — de stilla blocken visas', () => {
    expect(outsideMotion).not.toMatch(/rqSkel/);
    expect(outsideMotion).not.toMatch(/\.rq-badge-skel[^{}]*\{[^}]*animation/);
    expect(outsideMotion).toMatch(/\.rq-badge-skel__shape\s*\{[^}]*background-color:\s*var\(--rq-fill-1\)/);
  });

  it('takten är 1.6 s och staggern .2 s i båda temafilerna (F8)', () => {
    for (const css of [indexCss, facitCss]) {
      expect(css).toMatch(/--rq-dur-badge-skel:\s*1\.6s;/);
      expect(css).toMatch(/--rq-badge-skel-stagger:\s*\.2s;/);
    }
  });
});

describe('rutnätet', () => {
  it('kolumnerna kommer ur --rq-badge-grid-cols: 2 på mobil, 4 på desktop, ordagrant lika i båda temafilerna', () => {
    expect(badgesCss).toMatch(/\.rq-badge-grid\s*\{[^}]*grid-template-columns:\s*var\(--rq-badge-grid-cols\)/);
    for (const css of [indexCss, facitCss]) {
      expect(css).toMatch(/--rq-badge-grid-cols:\s*repeat\(2, minmax\(0, 1fr\)\);/);
      const desktop = css.slice(css.indexOf('@media (min-width: 1024px)'));
      expect(desktop).toMatch(/--rq-badge-grid-cols:\s*repeat\(4, minmax\(0, 1fr\)\);/);
    }
  });
});

describe('väljaren (RUN-129, Council 17)', () => {
  it('tryckytan är 44 px på mobil och 24 px på desktop, i båda temafilerna, och växlare, ✕ och Edit läser den', () => {
    for (const css of [indexCss, facitCss]) {
      expect(css).toMatch(/--rq-badge-pick-hit:\s*44px;/);
      const desktop = css.slice(css.indexOf('@media (min-width: 1024px)'));
      expect(desktop).toMatch(/--rq-badge-pick-hit:\s*24px;/);
    }
    for (const selector of ['.rq-badge-pick .rq-badge-pick__toggle', '.rq-badge-slot .rq-badge-slot__remove', '.rq-badge-textlink']) {
      const rule = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(badgesCss);
      expect(rule?.[1], selector).toMatch(/min-height:\s*var\(--rq-badge-pick-hit\)/);
    }
  });

  it('platsmarkören är --rq-titles-pos (19 px) och "Preview on leaderboard" har ingen stil här', () => {
    expect(badgesCss).toMatch(/\.rq-badge-slot__pos\s*\{[^}]*width:\s*var\(--rq-titles-pos\)/);
    expect(badgesCss).not.toMatch(/preview/i);
  });

  it('vid 3/3 dimmas växlaren (aria-disabled) — inte raden: ingen regel på raden eller texten sätter opacity', () => {
    expect(badgesCss).toMatch(/\.rq-badge-pick__toggle\[aria-disabled="true"\]\s*\{/);
    expect(badgesCss).not.toMatch(/opacity/);
  });

  it('spara/fel är semantisk grön/röd (--rq-up / --rq-down), aldrig en nivåfärg', () => {
    const note = /\.rq-badge-pick__note\s*\{([^}]*)\}/.exec(badgesCss)?.[1] ?? '';
    expect(note).toContain('var(--rq-up)');
    expect(badgesCss).toMatch(/\.rq-badge-pick \.rq-badge-pick__note\[data-status="error"\]\s*\{[^}]*var\(--rq-down\)/);
    const pickerCss = badgesCss.slice(badgesCss.indexOf('.rq-badge-textlink'), badgesCss.indexOf('.rq-badge-nameline'));
    expect(pickerCss).not.toMatch(/var\(--rq-badge-(common|uncommon|rare|heroic|epic|legendary)/);
  });
});

describe('BADGES-panelen på Runner card (T5)', () => {
  it('.rq-badge-panel* bor i badges.css och finns inte kvar i runner.css', () => {
    expect(runnerCss).not.toMatch(/rq-badge-panel/);
    for (const selector of ['__head', '__title', '__aside', '__list', '__row', '__text', '__nameline', '__display', '__held', '__empty', '__loading']) {
      expect(badgesCss, selector).toContain(`.rq-badge-panel${selector}`);
    }
    expect(badgesCss).toMatch(/\.rq-badge-panel \.rq-badge-panel__name\s*\{/);
  });
});
