import { describe, expect, it } from 'vitest';
import { BADGE_SERIES, TIER_NAMES } from '@runquest/shared';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineDesignGuards } from '@/test/designGuards';

// Vakttester över badges-featuren (ADR 009): typerna kommer ur @runquest/shared, varje resurs har EN query-definition, och inga
// serienamn/texter är hårdkodade — allt om serierna läses ur shared (BADGE_SERIES, TIER_NAMES, requirementText, tierFlavor).
// Globben tar med framtida vyer (components/) automatiskt, så reglerna gäller även RUN-127 och framåt.

const sources = import.meta.glob(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}', '!./**/*.fixture.ts'], {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

const codeFiles = Object.entries(sources);
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('badges-featuren: delade definitioner, inte egna kopior', () => {
  it('hittar filerna', () => {
    expect(codeFiles.map(([path]) => path).sort()).toEqual(expect.arrayContaining(['./api.ts', './badgeModel.ts', './hooks/useBadgeQueries.ts']));
  });

  it('typerna kommer ur @runquest/shared: ingen egen deklaration av kontraktstyperna', () => {
    const contract = /^\s*(export\s+)?(interface|type)\s+(BadgeUserItem|BadgeUserResponse|BadgeUserApiResponse|BadgeGroupMember|BadgeGroupResponse|BadgeGroupMeta|BadgeGroupApiResponse|BadgeShowcaseEntry|ShowcaseRequest|ShowcaseResponse|SeenRequest|SeenResponse|BadgeSeriesDef)\b/m;
    for (const [path, text] of codeFiles) expect({ path, own: contract.test(stripComments(text)) }).toEqual({ path, own: false });
  });

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

  it('klienten och endpoints bor i api.ts: bara api.ts nämner /badges/-sökvägar eller authenticatedRequest', () => {
    for (const [path, text] of codeFiles) {
      if (path === './api.ts') continue;
      const code = stripComments(text);
      expect({ path, endpoints: /['"`]\/badges\b/.test(code), request: /authenticatedRequest|\bfetch\(/.test(code) }).toEqual({ path, endpoints: false, request: false });
    }
  });
});

describe('badges-featuren: EN query-definition per resurs', () => {
  it('bara useBadgeQueries anropar badgesApi och skriver badges-nycklar; vyerna går via hookarna', () => {
    for (const [path, text] of codeFiles) {
      if (path === './hooks/useBadgeQueries.ts' || path === './api.ts') continue;
      const code = stripComments(text);
      expect({ path, api: /badgesApi/.test(code), keys: /\[\s*'badges'/.test(code), query: /\buse(Query|Mutation)\(/.test(code) }).toEqual({ path, api: false, keys: false, query: false });
    }
  });

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

describe('badges-featuren: språk och UI-regler som gäller även logiken', () => {
  it('engelskt UI i en-GB: ingen sv-SE, inga toast-anrop och inga Intl-datumformat', () => {
    for (const [path, text] of codeFiles) {
      const code = stripComments(text);
      expect({
        path, svSE: /sv-SE/.test(code), toast: /\btoast[.(]|from ['"]sonner['"]/.test(code), locale: /toLocale(Date|Time)?String|Intl\.DateTimeFormat/.test(code),
      }).toEqual({ path, svSE: false, toast: false, locale: false });
    }
  });

  it('ingen lucide-import, inga egna <svg> och inga emojis i texterna (RQIcon är enda ikonkällan, regel 10)', () => {
    for (const [path, text] of codeFiles) {
      const code = stripComments(text);
      expect({ path, lucide: /lucide-react/.test(code), svg: /<svg/.test(code), emoji: code.match(/\p{Extended_Pictographic}/gu) ?? [] }).toEqual({
        path, lucide: false, svg: false, emoji: [],
      });
    }
  });
});

// ─── RUN-127: emblemet, tokens och rörelse (spec §3 och §5, Design Council 3–7) ──────────────────────────────────────────────────

const viewSources = import.meta.glob(['./components/**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}', '../../pages/BadgesPreviewPage.tsx'], {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

defineDesignGuards({
  name: 'Badge-emblemet och förhandsvisningen',
  baseUrl: import.meta.url,
  sources: viewSources,
  cssFiles: ['./badges.css', '../../pages/preview/badgeSheet.css'],
  tokenPrefix: '--rq-badge-',
  // --rq-emblem-* mappar nivå/storlek på tokens (så att varje lager skrivs en gång); --rq-c/--rq-c-solid är chipets accent (.rq-chip--status).
  localVars: [
    '--rq-emblem-c', '--rq-emblem-c-rgb', '--rq-emblem-grad', '--rq-emblem-w', '--rq-emblem-h', '--rq-emblem-icon', '--rq-emblem-core',
    '--rq-emblem-ring', '--rq-emblem-ring-core', '--rq-emblem-glow', '--rq-emblem-glow-leg', '--rq-emblem-ignite-from', '--rq-c', '--rq-c-solid',
  ],
  allowAnimation: true,
});

const readFromDisk = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const badgesCss = stripComments(readFromDisk('./badges.css'));
const indexCss = readFromDisk('../../index.css');
const facitCss = readFromDisk('../../../../../docs/design/temafil-forslag.css');

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

  it('andningen gäller bara Legendary md/lg — aldrig sm', () => {
    const breathing = ruleBlocks.filter((block) => /rqBadgeGlow/.test(block.body));
    expect(breathing.length).toBeGreaterThan(0);
    for (const block of breathing) {
      for (const selector of block.selector.split(',').map((part) => part.trim())) {
        expect(selector).toContain('[data-tier="legendary"]');
        expect(selector).toMatch(/\.rq-badge--(md|lg)/);
        expect(selector).not.toContain('rq-badge--sm');
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

  it('Rare/Heroic/Epic använder --rq-badge-glow-alpha (.45) och Legendary --rq-badge-glow-leg-alpha (.60)', () => {
    const standard = glowRules.find((block) => block.selector.includes('"rare"'));
    const legendary = glowRules.find((block) => block.selector === '.rq-badge[data-tier="legendary"]');
    expect(standard?.body).toContain('var(--rq-badge-glow-alpha)');
    expect(legendary?.body).toContain('var(--rq-badge-glow-leg-alpha)');
    expect(indexCss).toMatch(/--rq-badge-glow-alpha:\s*\.45;/);
    expect(indexCss).toMatch(/--rq-badge-glow-leg-alpha:\s*\.60;/);
  });
});

describe('--rq-badge-*-tokens: samma värden i index.css och temafil-forslag.css, och i designkällan runquest-badges.js', () => {
  const declarations = (text: string) =>
    new Map([...text.matchAll(/^\s*(--rq-(?:dur-)?badge-[a-z0-9-]+):\s*([^;]+);/gm)].map((m) => [m[1], m[2].trim().replace(/\s+/g, ' ')] as const));
  const index = declarations(indexCss);
  const facit = declarations(facitCss);
  const norm = (value: string | undefined) => (value ?? '').replace(/\s+/g, '').toLowerCase();

  it('varje token har exakt samma värde i båda temafilerna (inklusive --rq-dur-badge-ignite)', () => {
    expect(index.size).toBeGreaterThan(40);
    expect([...index.keys()].sort()).toEqual([...facit.keys()].sort());
    for (const [name, value] of index) expect({ name, value }).toEqual({ name, value: facit.get(name) });
  });

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

  it('kronskölden och måtten (28/56/96, höjd × 1.12, ikon 15/24/42, kärna och Heroic-ring) följer SIZES — med de två förhandsgodkända förstärkningarna vid 28 px', () => {
    expect(norm(index.get('--rq-badge-clip'))).toBe(norm(/const CREST = '([^']+)'/.exec(source)?.[1]));
    const sizes = [...sizesBlock.matchAll(/(mini|medium|large): \{ w: (\d+), i: (\d+), core: ([\d.]+), ring1: ([\d.]+), ring2: ([\d.]+) \}/g)];
    expect(sizes).toHaveLength(3);
    const suffix = { mini: 'sm', medium: 'md', large: 'lg' } as const;
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
