import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Samlingens stil (RUN-128): skelettets puls respekterar reduced-motion, rutnätet och skelettets takt läser tokens, och BADGES-panelens stil ligger här (flyttad
// från runner.css). CSS läses från disk: vitest (css: false) tömmer ?raw-importer av .css.

const readFromDisk = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '');
const badgesCss = stripComments(readFromDisk('./badges.css'));
const runnerCss = stripComments(readFromDisk('../runner/runner.css'));
const shellCss = stripComments(readFromDisk('../../app-shell/app-shell.css'));
const detailTsx = readFromDisk('./components/BadgeEmblemDetail.tsx');
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
  // Bara väljarens egna regler (selektorer med .rq-badge-pick / .rq-badge-slot / .rq-badge-textlink) granskas, så andra block i badges.css (popup, nivåfärger, rörelse) inte påverkar testerna.
  const pickerRules = [...badgesCss.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .map(([, selector, body]) => ({ selector: selector.trim(), body }))
    .filter(({ selector }) => /\.rq-badge-(pick|slot|textlink)/.test(selector));
  const pickerCss = pickerRules.map(({ selector, body }) => `${selector} {${body}}`).join('\n');

  it('tryckytan är 44 px på mobil och 24 px på desktop, i båda temafilerna, och växlare, ✕ och Edit läser den', () => {
    for (const css of [indexCss, facitCss]) {
      expect(css).toMatch(/--rq-badge-pick-hit:\s*44px;/);
      const desktop = css.slice(css.indexOf('@media (min-width: 1024px)'));
      expect(desktop).toMatch(/--rq-badge-pick-hit:\s*24px;/);
    }
    for (const selector of ['.rq-badge-pick .rq-badge-pick__toggle', '.rq-badge-slot .rq-badge-slot__remove', '.rq-badge-textlink']) {
      const rule = pickerRules.find((candidate) => candidate.selector === selector);
      expect(rule?.body, selector).toMatch(/min-height:\s*var\(--rq-badge-pick-hit\)/);
      expect(rule?.body, selector).toMatch(/min-width:\s*var\(--rq-badge-pick-hit\)/);
    }
  });

  it('platsmarkören är --rq-titles-pos (19 px) och "Preview on leaderboard" har ingen stil här', () => {
    expect(pickerRules.length).toBeGreaterThan(10);
    expect(pickerCss).toMatch(/\.rq-badge-slot__pos\s*\{[^}]*width:\s*var\(--rq-titles-pos\)/);
    expect(pickerCss).not.toMatch(/preview/i);
  });

  it('vid 3/3 dimmas växlaren (aria-disabled) — inte raden: ingen regel på raden eller texten sätter opacity', () => {
    expect(pickerCss).toMatch(/\.rq-badge-pick__toggle\[aria-disabled="true"\]\s*\{/);
    expect(pickerCss).not.toMatch(/opacity/);
  });

  it('spara/fel är semantisk grön/röd (--rq-up / --rq-down), aldrig en nivåfärg', () => {
    const note = pickerRules.find(({ selector }) => selector === '.rq-badge-pick__note')?.body ?? '';
    expect(note).toContain('var(--rq-up)');
    expect(pickerCss).toMatch(/\.rq-badge-pick \.rq-badge-pick__note\[data-status="error"\]\s*\{[^}]*var\(--rq-down\)/);
    expect(pickerCss).not.toMatch(/var\(--rq-badge-(common|uncommon|rare|heroic|epic|legendary)/);
  });
});

describe('badges-sidans byggstenar (RUN-149, spec F9.9, F13.4)', () => {
  const rules = [...badgesCss.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, selector, body]) => ({ selector: selector.trim(), body }));
  const rule = (selector: string) => rules.find((candidate) => candidate.selector === selector);
  /** Deklarationerna före (mobil) respektive efter (desktop) den första ≥ 1024 px-blocket i en temafil. */
  const mobileOf = (css: string) => css.slice(0, css.indexOf('@media (min-width: 1024px)'));
  const desktopOf = (css: string) => css.slice(css.indexOf('@media (min-width: 1024px)'));
  const declaration = (css: string, token: string) => new RegExp(`^\\s*${token}:\\s*([^;]+);`, 'm').exec(css)?.[1].trim();

  it('rutnätstokens: kortets minsta bredd 300 px mobil / 240 px desktop och glappet --rq-sp-8 / --rq-sp-12, ordagrant lika i båda temafilerna', () => {
    for (const css of [indexCss, facitCss]) {
      expect(declaration(mobileOf(css), '--rq-badge-page-card-min')).toBe('300px');
      expect(declaration(desktopOf(css), '--rq-badge-page-card-min')).toBe('240px');
      expect(declaration(mobileOf(css), '--rq-badge-page-gap')).toBe('var(--rq-sp-8)');
      expect(declaration(desktopOf(css), '--rq-badge-page-gap')).toBe('var(--rq-sp-12)');
    }
  });

  it('rutnätet är auto-fill med --rq-badge-page-card-min och glappet ur --rq-badge-page-gap (telefon 1 kolumn, 1440 fyra)', () => {
    const grid = rule('.rq-badge-page-grid')?.body ?? '';
    expect(grid).toMatch(/grid-template-columns:\s*repeat\(auto-fill, minmax\(min\(100%, var\(--rq-badge-page-card-min\)\), 1fr\)\)/);
    expect(grid).toMatch(/gap:\s*var\(--rq-badge-page-gap\)/);
  });

  it('kortets områden: mobil "emblem who" / "emblem body", desktop "emblem who" / "body body", ordagrant lika i båda temafilerna och läst av kortet', () => {
    for (const css of [indexCss, facitCss]) {
      expect(declaration(mobileOf(css), '--rq-badge-card-areas')).toBe('"emblem who" "emblem body"');
      expect(declaration(desktopOf(css), '--rq-badge-card-areas')).toBe('"emblem who" "body body"');
    }
    const card = rule('.rq-badge-card.rq-badge-card--landscape')?.body ?? '';
    expect(card).toMatch(/grid-template-areas:\s*var\(--rq-badge-card-areas\)/);
    expect(card).toMatch(/grid-template-columns:\s*auto minmax\(0, 1fr\)/);
    expect(card).toMatch(/column-gap:\s*var\(--rq-sp-12\)/);
    expect(card).toMatch(/padding:\s*var\(--rq-pad-card\)/);
    for (const area of ['emblem', 'who', 'body']) expect(badgesCss, area).toMatch(new RegExp(`\\.rq-badge-card--landscape \\.rq-badge-card__${area}\\s*\\{[^}]*grid-area:\\s*${area}`));
  });

  it('popoverns bredd är --rq-badge-detail-w (280 px, samma i båda temafilerna) och läses av .rq-badge-detail', () => {
    for (const css of [indexCss, facitCss]) expect(declaration(mobileOf(css), '--rq-badge-detail-w')).toBe('280px');
    expect(rule('.rq-popover.rq-badge-detail')?.body).toMatch(/width:\s*var\(--rq-badge-detail-w\)/);
  });

  it('popovern ligger över Runner card-modalen (RUN-152): --rq-z-popover-over-modal (samma i båda temafilerna) är större än .rq-scrim och .rq-modal, skalets .rq-popover--over-modal läser den och emblem-popovern bär klassen', () => {
    const shellZ = (selector: string) => {
      const body = new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`).exec(shellCss)?.[1] ?? '';
      return Number(/z-index:\s*(\d+)/.exec(body)?.[1]);
    };
    const [indexZ, facitZ] = [indexCss, facitCss].map((css) => declaration(mobileOf(css), '--rq-z-popover-over-modal'));
    expect(indexZ).toBeDefined();
    expect(indexZ).toBe(facitZ);
    expect(shellCss).toMatch(/\.rq-popover\.rq-popover--over-modal\s*\{[^}]*z-index:\s*var\(--rq-z-popover-over-modal\)/);
    expect(detailTsx).toMatch(/className="rq-popover rq-popover--over-modal rq-badge-detail"/);
    expect(badgesCss).not.toMatch(/z-index/);
    expect(shellZ('.rq-modal')).toBeGreaterThan(0);
    expect(Number(indexZ)).toBeGreaterThan(shellZ('.rq-modal'));
    expect(Number(indexZ)).toBeGreaterThan(shellZ('.rq-scrim'));
    // Andra popovers (klockan, avatarmenyn) behåller skalets eget lager: bara emblem-popovern lyfts.
    expect(shellZ('.rq-popover')).toBeLessThan(shellZ('.rq-scrim'));
    expect(runnerCss + badgesCss.replace(/\.rq-popover\.rq-badge-detail\s*\{[^}]*\}/, '')).not.toMatch(/\.rq-popover\s*\{/);
  });

  it('de nya tokens finns inte som egna kopior: temafilerna deklarerar dem exakt en gång per läge', () => {
    for (const css of [indexCss, facitCss]) {
      for (const token of ['--rq-badge-page-card-min', '--rq-badge-page-gap', '--rq-badge-card-areas']) expect(css.match(new RegExp(`^\\s*${token}:`, 'gm')), token).toHaveLength(2);
      expect(css.match(/^\s*--rq-badge-detail-w:/gm)).toHaveLength(1);
      expect(css.match(/^\s*--rq-z-popover-over-modal:/gm)).toHaveLength(1);
    }
  });

  it('växlaren: tryckytan är --rq-badge-pick-hit (mobil 44, desktop 24) i bredd och höjd; den dimmas bara som knapp (aria-disabled), aldrig kortet', () => {
    const toggle = rule('.rq-badge-card .rq-badge-toggle')?.body ?? '';
    expect(toggle).toMatch(/min-height:\s*var\(--rq-badge-pick-hit\)/);
    expect(toggle).toMatch(/min-width:\s*var\(--rq-badge-pick-hit\)/);
    const dimmed = rule('.rq-badge-card .rq-badge-toggle[aria-disabled="true"]:not([aria-pressed="true"])')?.body ?? '';
    expect(dimmed).toMatch(/background:\s*var\(--rq-fill-1\)/);
    expect(dimmed).toMatch(/border-color:\s*transparent/);
    expect(dimmed).toMatch(/color:\s*var\(--rq-text-5\)/);
    expect(dimmed).toMatch(/cursor:\s*not-allowed/);
    // Kortet och texten dimmas aldrig: ingen opacity någonstans i badges.css, och inga regler på kortets egna selektorer sätter filter.
    expect(badgesCss).not.toMatch(/opacity/);
    expect(rules.filter(({ selector }) => /^\.rq-badge-card(\.|\[| *$)/.test(selector)).some(({ body }) => /filter|pointer-events/.test(body))).toBe(false);
  });

  it('växlaren vald = rollguld (tint/kant/text-tokens), inte en nivåfärg; vald behåller utseendet när den är aria-disabled (sparar)', () => {
    const pressed = rule('.rq-badge-card .rq-badge-toggle[aria-pressed="true"]')?.body ?? '';
    expect(pressed).toContain('rgb(var(--rq-gold-rgb) / var(--rq-tint-status))');
    expect(pressed).toContain('rgb(var(--rq-gold-rgb) / var(--rq-edge-status))');
    expect(pressed).toContain('var(--rq-gold-text)');
    expect(pressed).not.toMatch(/--rq-badge-(common|uncommon|rare|heroic|epic|legendary)/);
    expect(rule('.rq-badge-card .rq-badge-toggle[aria-disabled="true"]:not([aria-pressed="true"])')).toBeDefined();
  });

  it('den låsta rutan ändrar inte utseende vid hover: --locked:hover finns efter :hover, med samma specificitet och låst-färgerna', () => {
    const hover = rules.findIndex(({ selector }) => selector === '.rq-badge-card .rq-badge-toggle:hover');
    const lockedHover = rules.findIndex(({ selector }) => selector === '.rq-badge-card .rq-badge-toggle--locked:hover');
    expect(hover).toBeGreaterThanOrEqual(0);
    expect(lockedHover).toBeGreaterThan(hover);
    const locked = rule('.rq-badge-card .rq-badge-toggle--locked')?.body ?? '';
    const body = rules[lockedHover].body;
    // Samma kantfärg och textfärg som låst-utseendet, så hover inte kan läsas som klickbart.
    expect(body).toContain('border-color: var(--rq-line-5)');
    expect(body).toContain('color: var(--rq-text-5)');
    expect(locked).toContain('border-color: var(--rq-line-5)');
    expect(locked).toContain('color: var(--rq-text-5)');
    expect(body).not.toMatch(/--rq-line-hover|--rq-text-2/);
  });

  it('valt kort: guldkant ur rgb(var(--rq-gold-rgb) / var(--rq-edge-soft)) via [data-display]; låst kort har streckad kant', () => {
    expect(rule('.rq-badge-card.rq-badge-card--landscape[data-display="true"]')?.body).toContain('rgb(var(--rq-gold-rgb) / var(--rq-edge-soft))');
    expect(rule('.rq-badge-card[data-state="locked"]')?.body).toMatch(/border-style:\s*dashed/);
  });

  it('desktop byter namn/chip/pips till en kolumn bredvid emblemet i ett min-width: 1024px-block (kortets områden styrs av token, inte av JS)', () => {
    const desktop = mediaBodies(badgesCss, 'min-width: 1024px').join('\n');
    expect(desktop).toMatch(/\.rq-badge-card--landscape \.rq-badge-card__who\s*\{[^}]*flex-direction:\s*column/);
  });

  it('emblemknappen har en tunn hover-ram (--rq-line-hover) utan egen ring, och popovern har ingen animation eller transition', () => {
    expect(rule('.rq-badge-detail__trigger:hover')?.body).toContain('border-color: var(--rq-line-hover)');
    expect(rule('.rq-badge-detail__trigger')?.body).not.toMatch(/outline|box-shadow/);
    const detailCss = rules.filter(({ selector }) => /rq-badge-detail|rq-badge-toggle|rq-badge-page-grid|rq-badge-card--landscape|rq-badge-card__foot/.test(selector)).map(({ body }) => body).join('\n');
    expect(detailCss).not.toMatch(/animation|transition/);
  });
});

describe('BADGES-panelen på Runner card (T5)', () => {
  it('.rq-badge-panel* bor i badges.css och finns inte kvar i runner.css', () => {
    expect(runnerCss).not.toMatch(/rq-badge-panel/);
    // RUN-152: panelen är ett kompakt emblemrutnät; raden (__row/__text/__nameline/__display/__held) och namn-overriden är borta.
    for (const selector of ['__head', '__title', '__aside', '__grid', '__item', '__empty', '__loading']) {
      expect(badgesCss, selector).toContain(`.rq-badge-panel${selector}`);
    }
    expect(badgesCss).not.toMatch(/\.rq-badge-panel__(row|text|nameline|display|held|list|name)\b/);
  });
});

describe('Runner cards nedre rutnät (RUN-152, spec F11.1)', () => {
  const rules = [...runnerCss.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, selector, body]) => ({ selector: selector.trim(), body }));
  const body = (selector: string) => rules.find((candidate) => candidate.selector === selector)?.body ?? '';

  it('.rq-runner__lower är ett rutnät med samma kolumner som raden ovanför (--rq-runner-split-cols), så mobil staplar och desktop ger BADGES | Head to head', () => {
    const lower = body('.rq-runner__lower');
    expect(lower).toMatch(/display:\s*grid/);
    expect(lower).toMatch(/grid-template-columns:\s*var\(--rq-runner-split-cols\)/);
    expect(lower).toMatch(/align-items:\s*start/);
    expect(body('.rq-runner__split')).toMatch(/grid-template-columns:\s*var\(--rq-runner-split-cols\)/);
  });

  it('Head to head sträcks till radens höjd (align-self: stretch)', () => {
    expect(body('.rq-runner__lower > .rq-runner-h2h')).toMatch(/align-self:\s*stretch/);
  });

  it('kolumntoken: en kolumn på mobil och en 340 px-kolumn på desktop, ordagrant lika i båda temafilerna — rutnätet kan inte bli en kolumn på desktop utan att vakten faller', () => {
    const mobile = (css: string) => css.slice(0, css.indexOf('@media (min-width: 1024px)'));
    const desktop = (css: string) => css.slice(css.indexOf('@media (min-width: 1024px)'));
    const value = (css: string) => /--rq-runner-split-cols:\s*([^;]+);/.exec(css)?.[1].trim();
    for (const css of [indexCss, facitCss]) {
      expect(value(mobile(css))).toBe('minmax(0, 1fr)');
      expect(value(desktop(css))).toBe('minmax(0, 1fr) 340px');
    }
  });
});
