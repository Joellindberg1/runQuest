import { describe, expect, it } from 'vitest';
import { BADGE_SERIES, TIER_NAMES } from '@runquest/shared';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Vakttester över badges-featuren (ADR 009): typerna kommer ur @runquest/shared, varje resurs har EN query-definition, och inga
// serienamn/texter är hårdkodade — allt om serierna läses ur shared (BADGE_SERIES, TIER_NAMES, requirementText, tierFlavor).
// Globben tar med framtida vyer (components/) automatiskt, så reglerna gäller även nya vyer. Språk-, ikon- och emojiregler för badges-koden
// (sv-SE, toast, lucide, egna <svg>, emojis), designreglerna för CSS:en och "ingen global procent" vaktas av lint (eslint.config.js, stylelint.config.js).

const sources = import.meta.glob(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}', '!./**/*.fixture.ts'], {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

const codeFiles = Object.entries(sources);
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('badges-featuren: delade definitioner, inte egna kopior', () => {
  it('hittar filerna', () => {
    expect(codeFiles.map(([path]) => path).sort()).toEqual(expect.arrayContaining(['./api.ts', './badgeModel.ts', './hooks/useBadgeQueries.ts']));
  });

  // Kontraktstyperna ur @runquest/shared (ingen egen deklaration), att bara api.ts nämner /badges-sökvägar/authenticatedRequest/fetch och att
  // bara hooks/useBadgeQueries.ts anropar badgesApi, skriver badges-nycklar eller använder useQuery/useMutation vaktas av ESLint (eslint.config.js).

  it('inga hårdkodade serienamn, nycklar, tiernamn, flavors, måttetiketter eller kravtexter: allt läses ur shared', () => {
    const literals = new Set<string>([...TIER_NAMES]);
    for (const series of BADGE_SERIES) {
      literals.add(series.key);
      literals.add(series.name);
      literals.add(series.metricLabel);
      for (const flavor of series.flavors) literals.add(flavor);
    }
    for (const [path, text] of codeFiles) {
      const code = stripComments(text);
      const found = [...literals].filter((literal) => new RegExp(`['"\`]${literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`).test(code));
      expect({ path, found }).toEqual({ path, found: [] });
    }
  });
});

describe('badges-featuren: EN query-definition per resurs', () => {
  it('varje resurs har exakt en useQuery: användarens samling och gruppen', () => {
    const hooks = stripComments(sources['./hooks/useBadgeQueries.ts']);
    expect(hooks.match(/\buseQuery\(/g)).toHaveLength(2);
    expect(hooks.match(/queryFn:\s*\(\)\s*=>\s*badgesApi\.(\w+)/g)?.sort()).toEqual([
      'queryFn: () => badgesApi.getGroupBadges', 'queryFn: () => badgesApi.getUserBadges',
    ]);
  });

  it('mutationerna är optimistiska med återställning: onMutate, onError och invalidering finns', () => {
    const hooks = stripComments(sources['./hooks/useBadgeQueries.ts']);
    expect(hooks.match(/onMutate/g)?.length).toBe(2);
    expect(hooks.match(/onError/g)?.length).toBe(2);
    expect(hooks).toMatch(/invalidateQueries/);
  });

  it('cachen är användarbunden: user-nyckeln bär användar-id:t och ingen nyckel utan id skrivs för min samling', () => {
    const hooks = stripComments(sources['./hooks/useBadgeQueries.ts']);
    expect(hooks).toMatch(/user:\s*\(userId: string\)\s*=>\s*\['badges', 'user', userId\]/);
  });
});

// ─── Emblemet, tokens och rörelse (spec §3 och §5, Design Council 3–7) ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const readFromDisk = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const badgesCss = stripComments(readFromDisk('./badges.css'));
const indexCss = readFromDisk('../../index.css');

interface CssBlock { at: string; selector: string; body: string }

/** Plattar ut reglerna (och @media-block) i en CSS-text. @keyframes behålls som ETT block med sin inre text. */
function cssBlocks(code: string, at = ''): CssBlock[] {
  const blocks: CssBlock[] = [];
  let cursor = 0;
  while (cursor < code.length) {
    const open = code.indexOf('{', cursor);
    if (open < 0) break;
    let depth = 1;
    let end = open + 1;
    while (end < code.length && depth > 0) {
      if (code[end] === '{') depth += 1;
      else if (code[end] === '}') depth -= 1;
      end += 1;
    }
    const head = code.slice(cursor, open).trim();
    const body = code.slice(open + 1, end - 1);
    if (head.startsWith('@media')) blocks.push(...cssBlocks(body, head));
    else blocks.push({ at, selector: head, body });
    cursor = end;
  }
  return blocks;
}

const allBlocks = cssBlocks(badgesCss);
const ruleBlocks = allBlocks.filter((block) => !block.selector.startsWith('@keyframes'));
const keyframes = (name: string) => allBlocks.find((block) => block.selector === `@keyframes ${name}`)?.body ?? '';
const NO_PREFERENCE = 'prefers-reduced-motion: no-preference';
const REDUCE = 'prefers-reduced-motion: reduce';

describe('badges.css: rörelsen (ägarbeslut E1+E2, Rörelse-undantaget i STATE.md)', () => {
  it('prefers-reduced-motion: reduce stänger av all animation på emblemet (animation: none)', () => {
    const reduce = ruleBlocks.filter((block) => block.at.includes(REDUCE));
    expect(reduce.length).toBeGreaterThan(0);
    expect(reduce.map((block) => block.selector).join(' ')).toMatch(/\.rq-badge/);
    for (const block of reduce) expect(block.body).toMatch(/animation:\s*none/);
  });

  it('varje animation ligger i no-preference-blocket (slutläget visas direkt när rörelse är avstängd) — utom reduce-blockets "none"', () => {
    const animated = ruleBlocks.filter((block) => /animation/.test(block.body) && !block.at.includes(REDUCE));
    expect(animated.length).toBeGreaterThan(0);
    for (const block of animated) expect({ selector: block.selector, at: block.at }).toEqual({ selector: block.selector, at: expect.stringContaining(NO_PREFERENCE) });
  });

  it('ingen loop: inget infinite, och andningens antal kommer ur --rq-badge-breathe-count (3)', () => {
    // Emblemets rörelse loopar aldrig. Undantaget är samlingens skelett (F8): en laddare som pulserar tills datan kommer, inte emblemrörelse.
    // Undantaget gäller bara regler där VARJE selektor börjar med .rq-badge-skel (inte en substring någon annanstans i selektorn).
    const isSkeletonRule = (block: CssBlock) => block.selector.split(',').every((part) => part.trim().startsWith('.rq-badge-skel'));
    expect(ruleBlocks.filter((block) => !isSkeletonRule(block)).map((block) => block.body).join('\n')).not.toMatch(/infinite/);
    const breathing = ruleBlocks.filter((block) => /rqBadgeGlow/.test(block.body));
    expect(breathing.length).toBeGreaterThan(0);
    for (const block of breathing) expect(block.body).toContain('var(--rq-badge-breathe-count)');
    expect(indexCss).toMatch(/--rq-badge-breathe-count:\s*3;/);
  });

  it('andningen går i --rq-dur-glow (3.2 s), inte i en egen tid', () => {
    for (const block of ruleBlocks.filter((rule) => /rqBadgeGlow/.test(rule.body))) expect(block.body).toContain('var(--rq-dur-glow)');
    expect(indexCss).toMatch(/--rq-dur-glow:\s*3\.2s;/);
    expect(indexCss).not.toMatch(/--rq-dur-badge-breathe/);
  });

  it('andningen gäller bara Legendary md/lg — aldrig sm eller cp', () => {
    const breathing = ruleBlocks.filter((block) => /rqBadgeGlow/.test(block.body));
    expect(breathing.length).toBeGreaterThan(0);
    for (const block of breathing) {
      for (const selector of block.selector.split(',').map((part) => part.trim())) {
        expect(selector).toContain('[data-tier="legendary"]');
        expect(selector).toMatch(/\.rq-badge--(md|lg)/);
        expect(selector).not.toContain('rq-badge--sm');
        expect(selector).not.toContain('rq-badge--cp');
      }
    }
  });

  it('Legendary i popupen: andningen startar vid --rq-badge-ignite-handoff (1.3 s) och tändningen är kvar under väntan', () => {
    const combined = ruleBlocks.find((block) => /rqBadgeIgnite/.test(block.body) && /rqBadgeGlow/.test(block.body));
    expect(combined?.body).toContain('var(--rq-badge-ignite-handoff)');
    expect(combined?.body).toMatch(/rqBadgeIgnite var\(--rq-dur-badge-ignite\) ease-out both/);
    expect(combined?.selector).toContain('.rq-badge--ignite');
    expect(indexCss).toMatch(/--rq-badge-ignite-handoff:\s*1\.3s;/);
    expect(indexCss).toMatch(/--rq-dur-badge-ignite:\s*\.9s;/);
  });

  it('andnings-keyframen börjar och slutar i den statiska Legendary-glöden (inget hopp efter tredje cykeln) och toppar i --rq-badge-breathe-max', () => {
    const glow = keyframes('rqBadgeGlow');
    expect(glow).toMatch(/0%,\s*100%\s*\{[^}]*--rq-emblem-glow-leg[^}]*--rq-badge-glow-leg-alpha/);
    expect(glow).toMatch(/50%\s*\{[^}]*var\(--rq-badge-breathe-max\)/);
  });

  it('tändningen: Rare+ tänder glöden från ingenting; Common/Uncommon flimrar bara i ramen (brightness, ingen drop-shadow)', () => {
    const ignite = ruleBlocks.filter((block) => block.selector.includes('.rq-badge--ignite') && /--rq-emblem-ignite-from/.test(block.body));
    const glowTiers = ignite.find((block) => /drop-shadow\(0 0 0 transparent\)/.test(block.body));
    const flicker = ignite.find((block) => /brightness\(var\(--rq-badge-flash\)\)/.test(block.body));
    expect(glowTiers?.selector).toMatch(/rare[\s\S]*heroic[\s\S]*epic[\s\S]*legendary/);
    expect(glowTiers?.selector).not.toMatch(/common|uncommon/);
    expect(flicker?.selector).toMatch(/common[\s\S]*uncommon/);
    expect(flicker?.selector).toMatch(/\.rq-badge__frame\s*$/);
    expect(flicker?.body).not.toMatch(/drop-shadow/);
    expect(keyframes('rqBadgeIgnite')).toMatch(/from\s*\{\s*filter:\s*var\(--rq-emblem-ignite-from\)/);
  });
});

describe('badges.css: glöden (spec §3)', () => {
  const glowRules = ruleBlocks.filter((block) => /(^|;|\s)filter:\s*drop-shadow/.test(block.body));

  it('statisk glöd finns på Rare, Heroic, Epic och Legendary — aldrig på Common, Uncommon eller låst', () => {
    const selectors = glowRules.map((block) => block.selector).join('\n');
    for (const tier of ['rare', 'heroic', 'epic', 'legendary']) expect(selectors).toContain(`[data-tier="${tier}"]`);
    for (const tier of ['common', 'uncommon', 'locked']) expect(selectors).not.toContain(`[data-tier="${tier}"]`);
  });

  it('Rare/Heroic/Epic använder --rq-badge-glow-alpha (.30) och Legendary --rq-badge-glow-leg-alpha (.35)', () => {
    const standard = glowRules.find((block) => block.selector.includes('"rare"'));
    const legendary = glowRules.find((block) => block.selector === '.rq-badge[data-tier="legendary"]');
    expect(standard?.body).toContain('var(--rq-badge-glow-alpha)');
    expect(legendary?.body).toContain('var(--rq-badge-glow-leg-alpha)');
    expect(indexCss).toMatch(/--rq-badge-glow-alpha:\s*\.30;/);
    expect(indexCss).toMatch(/--rq-badge-glow-leg-alpha:\s*\.35;/);
  });
});

describe('--rq-badge-*-tokens: värdena följer designkällan runquest-badges.js (att index.css och temafil-forslag.css är lika prövar themeTokens.sync.test)', () => {
  const declarations = (text: string) =>
    new Map([...text.matchAll(/^\s*(--rq-(?:dur-)?badge-[a-z0-9-]+):\s*([^;]+);/gm)].map((m) => [m[1], m[2].trim().replace(/\s+/g, ' ')] as const));
  const index = declarations(indexCss);
  const norm = (value: string | undefined) => (value ?? '').replace(/\s+/g, '').toLowerCase();

  const source = readFromDisk('../../../../../docs/design/claude-design/runquest-badges.js');
  const tiersBlock = source.slice(source.indexOf('const TIERS = {'), source.indexOf('const ORDER'));
  const sizesBlock = source.slice(source.indexOf('const SIZES = {'), source.indexOf('/* Layers:'));

  it('nivåfärgerna och ramgradienterna är runquest-badges.js ordagrant (Heroic röd, Legendary guld — alternativen är inte tokens)', () => {
    const tiers = [...tiersBlock.matchAll(/mk\('(\w+)', '(#[0-9a-fA-F]{6})', '(linear-gradient\([^']+\))'\)/g)];
    expect(tiers.map((m) => m[1])).toEqual(TIER_NAMES.slice());
    for (const [, name, color, gradient] of tiers) {
      const key = name.toLowerCase();
      expect({ key, color: norm(index.get(`--rq-badge-${key}`)), grad: norm(index.get(`--rq-badge-${key}-grad`)) }).toEqual({ key, color: color.toLowerCase(), grad: norm(gradient) });
      const rgb = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16)).join(' ');
      expect({ key, rgb: index.get(`--rq-badge-${key}-rgb`) }).toEqual({ key, rgb });
    }
    expect(indexCss).not.toMatch(/#fbbf24|#ff9a1f/i);
  });

  it('kronskölden och måtten (28/44/56/96, höjd × 1.12, ikon 15/20/24/42, kärna och Heroic-ring) följer SIZES — med de två förhandsgodkända förstärkningarna vid 28 px (cp har ingen egen förstärkning)', () => {
    expect(norm(index.get('--rq-badge-clip'))).toBe(norm(/const CREST = '([^']+)'/.exec(source)?.[1]));
    const sizes = [...sizesBlock.matchAll(/(mini|small|medium|large): \{ w: (\d+), i: (\d+), core: ([\d.]+), ring1: ([\d.]+), ring2: ([\d.]+) \}/g)];
    expect(sizes).toHaveLength(4);
    const suffix = { mini: 'sm', small: 'cp', medium: 'md', large: 'lg' } as const;
    for (const [, key, w, icon, core, ring1, ring2] of sizes) {
      const s = suffix[key as keyof typeof suffix];
      // Spec §3 "Heroic-ring vid sm" (Council 5): ringen syntes inte vid 28 px i verifieringen (1x och 2x) → ring2 3 → 3.5 px, ring-alfa .55 → .85.
      const expectedRing2 = s === 'sm' ? '3.5' : ring2;
      expect({
        s, w: index.get(`--rq-badge-w-${s}`), h: index.get(`--rq-badge-h-${s}`), icon: index.get(`--rq-badge-icon-${s}`), core: index.get(`--rq-badge-core-${s}`),
        ring: index.get(`--rq-badge-ring-${s}`), ringCore: index.get(`--rq-badge-ring-core-${s}`),
      }).toEqual({ s, w: `${w}px`, h: `${Math.round(Number(w) * 1.12)}px`, icon: `${icon}px`, core: `${core}px`, ring: `${ring1}px`, ringCore: `${expectedRing2}px` });
    }
    expect(index.get('--rq-badge-ring')).toMatch(/\/ \.85\)$/);
    expect(index.get('--rq-badge-core')?.toLowerCase()).toBe('#1c1c1c');
  });

  it('glöden följer runquest-badges.js: bredder (S.w >= 56 ? ml : sm) och alfa (hex 59 = .35, 4d = .30) är -sm/-ml/-alpha-tokens', () => {
    const legendary = /tier === 'legendary'\)\s*\{\s*glow \+= ' filter:drop-shadow\(0 0 ' \+ \(S\.w >= 56 \? (\d+) : (\d+)\) \+ 'px ' \+ T\.c \+ '([0-9a-f]{2})\)/.exec(source);
    const standard = /tier === 'heroic' \|\| tier === 'epic'\)\s*\{\s*glow \+= ' filter:drop-shadow\(0 0 ' \+ \(S\.w >= 56 \? (\d+) : (\d+)\) \+ 'px ' \+ T\.c \+ '([0-9a-f]{2})\)/.exec(source);
    expect(legendary).not.toBeNull();
    expect(standard).not.toBeNull();
    const alpha = (hex: string) => (parseInt(hex, 16) / 255).toFixed(2).replace(/^0/, '');
    const [, legMl, legSm, legAlpha] = legendary ?? [];
    const [, stdMl, stdSm, stdAlpha] = standard ?? [];
    expect({
      glowSm: index.get('--rq-badge-glow-sm'), glowMl: index.get('--rq-badge-glow-ml'), glowAlpha: index.get('--rq-badge-glow-alpha'),
      legSm: index.get('--rq-badge-glow-leg-sm'), legMl: index.get('--rq-badge-glow-leg-ml'), legAlpha: index.get('--rq-badge-glow-leg-alpha'),
    }).toEqual({ glowSm: `${stdSm}px`, glowMl: `${stdMl}px`, glowAlpha: alpha(stdAlpha), legSm: `${legSm}px`, legMl: `${legMl}px`, legAlpha: alpha(legAlpha) });
  });

  it('cp (44 px) mappar mått och Heroic-ring på -cp-tokens och glöden på -sm-glöden (bredd < 56) — och har ingen egen andning', () => {
    const cp = ruleBlocks.find((block) => block.selector === '.rq-badge--cp');
    expect(cp?.body).toBeDefined();
    for (const [local, token] of [
      ['--rq-emblem-w', '--rq-badge-w-cp'], ['--rq-emblem-h', '--rq-badge-h-cp'], ['--rq-emblem-icon', '--rq-badge-icon-cp'], ['--rq-emblem-core', '--rq-badge-core-cp'],
      ['--rq-emblem-ring', '--rq-badge-ring-cp'], ['--rq-emblem-ring-core', '--rq-badge-ring-core-cp'], ['--rq-emblem-glow', '--rq-badge-glow-sm'], ['--rq-emblem-glow-leg', '--rq-badge-glow-leg-sm'],
    ] as const) expect(cp?.body, local).toContain(`${local}: var(${token})`);
    expect(ruleBlocks.filter((block) => /animation/.test(block.body) && block.selector.includes('rq-badge--cp'))).toEqual([]);
  });

  it('nivåchippets bakgrund är --rq-badge-chip-tint (.06), inte status-chippets .10, och slår .rq-chip--status med en sammansatt selektor', () => {
    expect(index.get('--rq-badge-chip-tint')).toBe('.06');
    const rule = ruleBlocks.find((block) => block.selector === '.rq-chip.rq-badge-chip[data-tier]');
    expect(rule?.body).toMatch(/background:\s*rgb\(var\(--rq-c\) \/ var\(--rq-badge-chip-tint\)\)/);
    expect(rule?.body).not.toContain('--rq-tint-status');
  });

  it('kontrastvakt: chip-texten i varje nivåfärg når 4.5:1 mot chippets egen bakgrund (nivåfärgen i --rq-badge-chip-tint över kortet = panel över skalet + row-soft)', () => {
    const channel = (value: number) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const luminance = ([r, g, b]: number[]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    const contrast = (a: number[], b: number[]) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
    const over = (fg: number[], alpha: number, bg: number[]) => fg.map((value, i) => value * alpha + bg[i] * (1 - alpha));
    const rgba = (name: string) => {
      const match = new RegExp(`${name}:\\s*rgba\\((\\d+),\\s*(\\d+),\\s*(\\d+),\\s*([.\\d]+)\\)`).exec(indexCss);
      expect(match, name).not.toBeNull();
      return { rgb: [Number(match?.[1]), Number(match?.[2]), Number(match?.[3])], alpha: Number(match?.[4]) };
    };
    const hexRgb = (hex: string) => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
    const panel = rgba('--rq-panel');
    const rowSoft = rgba('--rq-row-soft');
    const shell = hexRgb(/--rq-bg-shell:\s*(#[0-9a-fA-F]{6});/.exec(indexCss)?.[1] ?? '#000000');
    const card = over(rowSoft.rgb, rowSoft.alpha, over(panel.rgb, panel.alpha, shell));
    const tint = Number(index.get('--rq-badge-chip-tint'));
    for (const name of TIER_NAMES) {
      const key = name.toLowerCase();
      const text = hexRgb(index.get(`--rq-badge-${key}`) ?? '#000000');
      const chipBackground = over(text, tint, card);
      expect({ key, ratio: contrast(text, chipBackground) >= 4.5 }).toEqual({ key, ratio: true });
    }
  });

  it('nivåfärgerna är egna literaler: inget --rq-badge-*-värde är ett alias mot status-, guld- eller utmaningsfärger', () => {
    for (const [name, value] of index) {
      if (/-(common|uncommon|rare|heroic|epic|legendary)(-rgb|-grad)?$/.test(name)) {
        expect({ name, alias: /var\(--rq-(up|down|gold|tier|duel)/.test(value) }).toEqual({ name, alias: false });
      }
    }
    expect(badgesCss).not.toMatch(/--rq-tier-/);
  });

  it('nivåfärgstokens läses bara av badges.css (emblem, chip, pips) — aldrig av förhandsvisningens egen CSS', () => {
    const tierToken = /var\(--rq-badge-(common|uncommon|rare|heroic|epic|legendary)/;
    expect(tierToken.test(badgesCss)).toBe(true);
    expect(tierToken.test(stripComments(readFromDisk('../../pages/preview/badgeSheet.css')))).toBe(false);
  });
});
