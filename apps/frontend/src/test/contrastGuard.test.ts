import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postcss, { type AtRule, type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';
import { TIER_NAMES } from '@runquest/shared';
import { THEMES, contrast, flatten, mediaTokenNames, over, parseColor, refusingMediaTokens, resolveColor, splitTopLevel, themeTokens, toHex, type Rgb, type Rgba, type Theme } from './contrast';

// Kontrastvakt för de nya tokenparen: ny text når 4,5:1 mot sin faktiska yta och fokusringen 3:1, i mörkt och ljust tema. Samma metod som nivåchipsvakten i
// features/badges/guards.test.ts (hjälparna bor i ./contrast.ts). Vakten läser färgerna ur komponenternas egna CSS-regler (vilken token texten tar, vilken tint
// bakgrunden har) och löser dem mot temat i index.css, så ett byte av token i en komponent eller i temat fångas utan att färger är kopierade hit.
// Ett par som fäller skrivs ut i klartext: namn, yta, tema, kvot och de två färgerna.
//
// Gränser i metoden: kaskaden följs bara så långt reglerna pekas ut här (en regel per lager, ljust tema via [data-theme="light"]-regeln om en sådan finns), och en
// alfa-yta blandas över skalet. En överstyrning med en ANNAN väljare än den som pekas ut här (t.ex. `.rq-runner-h2h-banner .rq-runner-cell__label { color }`) fångas inte: vakten
// mäter regeln den läser, inte kaskaden. Tokens som även deklareras i @media vägras i det tema där de sätts (värdet beror på bredden). Popupens nivåchip mäts som det ritas i dag, på kortet i popupen (section.rq-card över .rq-modal); /badges-sidans
// chip i ljust tema ägs av en annan story och mäts inte här. Samlingskortets neutrala yta bevisas av features/badges/badgeCardSurface.test.ts (inte duplicerat här).

const TEXT_MIN = 4.5;
const RING_MIN = 3;
const RING_MIN_WIDTH_PX = 2;

// Sökvägarna i variabler: Vite skriver annars om en bokstavlig new URL('./…', import.meta.url) till en asset-URL.
const SRC_DIR = '..';
const srcDir = fileURLToPath(new URL(SRC_DIR, import.meta.url));

const INDEX = 'index.css';
const SHELL = 'app-shell/app-shell.css';
const VIEW_CONTROLS = 'shared/components/view-controls.css';
const DUELS = 'features/challenges/duels.css';
const RUNNER = 'features/runner/runner.css';
const BADGES = 'features/badges/badges.css';
const PROFILE = 'features/profile/profile.css';
const PROFILE_POSITION = 'features/profile/positionChart.css';
const BOARD_POSITION = 'features/leaderboard/positionBoard.css';
const LOG = 'features/log/log.css';

// ─── CSS-reglerna ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

interface CssRule { selectors: string[]; declarations: Map<string, string>; inCondition: boolean }

const ruleCache = new Map<string, CssRule[]>();
function rulesIn(file: string): CssRule[] {
  const cached = ruleCache.get(file);
  if (cached) return cached;
  const rules: CssRule[] = [];
  postcss.parse(readFileSync(`${srcDir}/${file}`, 'utf8')).walkRules((rule: Rule) => {
    const atRules: string[] = [];
    for (let parent = rule.parent; parent && parent.type !== 'root'; parent = parent.parent) {
      if (parent.type === 'atrule') atRules.push((parent as AtRule).name);
    }
    if (atRules.some((name) => name.endsWith('keyframes'))) return;
    const declarations = new Map<string, string>();
    rule.each((child) => {
      if (child.type === 'decl') declarations.set(child.prop, child.value.replace(/\s*!important\s*$/, '').replace(/\s+/g, ' ').trim());
    });
    rules.push({ selectors: splitTopLevel(rule.selector), declarations, inCondition: atRules.some((name) => name === 'media' || name === 'container') });
  });
  ruleCache.set(file, rules);
  return rules;
}

const rulesFor = (file: string, selector: string) => rulesIn(file).filter((rule) => rule.selectors.includes(selector));

/** Värdet på en egenskap i regeln med exakt denna väljare (sista deklarationen bland reglerna utanför @media, annars bland de i @media). Saknas den är det ett fel i klartext. */
function declaration(file: string, selector: string, ...props: string[]): string {
  const rules = rulesFor(file, selector);
  if (rules.length === 0) throw new Error(`Regeln "${selector}" finns inte i ${file}: komponentens CSS har ändrats, uppdatera vakten`);
  const ordered = [...rules.filter((rule) => !rule.inCondition), ...rules.filter((rule) => rule.inCondition)].reverse();
  for (const rule of ordered) {
    for (const prop of props) {
      const value = rule.declarations.get(prop);
      if (value !== undefined) return value;
    }
  }
  throw new Error(`Regeln "${selector}" i ${file} har ingen ${props.join(' / ')}`);
}

const tryDeclaration = (file: string, selector: string, ...props: string[]): string | undefined => {
  try {
    return declaration(file, selector, ...props);
  } catch {
    return undefined;
  }
};

/** De lokala custom properties en regel sätter (nivåns färger på .rq-duels [data-tier=…], chippets --rq-c m.fl.). */
function customProps(file: string, selector: string): Map<string, string> {
  const rules = rulesFor(file, selector);
  if (rules.length === 0) throw new Error(`Regeln "${selector}" finns inte i ${file}: komponentens CSS har ändrats, uppdatera vakten`);
  const props = new Map<string, string>();
  for (const rule of rules.filter((candidate) => !candidate.inCondition)) {
    for (const [name, value] of rule.declarations) if (name.startsWith('--')) props.set(name, value);
  }
  return props;
}

// ─── Tema, ytor och mätning ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const indexCss = readFileSync(`${srcDir}/${INDEX}`, 'utf8');
const mediaTokens: Record<Theme, Set<string>> = { dark: mediaTokenNames(indexCss, 'dark'), light: mediaTokenNames(indexCss, 'light') };
const THEME_LABEL: Record<Theme, string> = { dark: 'mörkt tema', light: 'ljust tema' };

type Locator = readonly [file: string, selector: string, prop: string];
type Source = Locator | ((theme: Theme) => Locator);
const locate = (source: Source, theme: Theme): Locator => (typeof source === 'function' ? source(theme) : source);

type SurfaceName = 'shell' | 'card' | 'popup' | 'popupCard' | 'sheet';
const SCRIM: Locator = [SHELL, '.rq-scrim', 'background'];
const SURFACES: Record<SurfaceName, { label: string; layers: Locator[] }> = {
  shell: { label: 'sidans bakgrund', layers: [[INDEX, 'body', 'background']] },
  card: { label: 'kortet', layers: [[INDEX, 'body', 'background'], [INDEX, '.rq-card', 'background']] },
  popup: { label: 'profilpopupen', layers: [[INDEX, 'body', 'background'], SCRIM, [SHELL, '.rq-modal', 'background']] },
  popupCard: { label: 'kort i profilpopupen', layers: [[INDEX, 'body', 'background'], SCRIM, [SHELL, '.rq-modal', 'background'], [INDEX, '.rq-card', 'background']] },
  sheet: { label: 'send-arket', layers: [[INDEX, 'body', 'background'], SCRIM, [DUELS, '.rq-duels-sheet', 'background']] },
};

interface Measuring { tokens: Map<string, string>; scope: Map<string, string> }

function measuring(theme: Theme, tokens: Map<string, string>, scopeRules: ReadonlyArray<readonly [string, string]> = []): Measuring {
  const scope = new Map<string, string>();
  for (const [file, selector] of scopeRules) for (const [name, value] of customProps(file, selector)) scope.set(name, value);
  return { tokens: refusingMediaTokens(tokens, mediaTokens[theme], theme), scope };
}

const colorOf = (m: Measuring, value: string) => resolveColor(m.tokens, value, m.scope);

function backgroundOf(m: Measuring, theme: Theme, surface: SurfaceName, extra: readonly Source[]): Rgb {
  const layers = [...SURFACES[surface].layers, ...extra.map((source) => locate(source, theme))];
  return flatten(layers.map(([file, selector, prop]) => colorOf(m, declaration(file, selector, prop, 'background-color'))));
}

// ─── Textpar ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

interface TextPair {
  name: string;
  surfaces: SurfaceName[];
  /** Var texten får sin färg. */
  fg: Source;
  /** Bakgrunderna mellan ytan och texten, nerifrån och upp (elementets egen tint, hårlinjegridens bakgrund osv.). */
  layers?: Source[];
  /** Regler vars custom properties är synliga för texten (nivåns färger). */
  scope?: ReadonlyArray<readonly [string, string]>;
}

interface Verdict { line: string; ratio: number }

function measureText(pair: TextPair, theme: Theme, surface: SurfaceName, tokens: Map<string, string>): Verdict {
  const m = measuring(theme, tokens, pair.scope);
  const [fgFile, fgSelector, fgProp] = locate(pair.fg, theme);
  const text = colorOf(m, declaration(fgFile, fgSelector, fgProp));
  const background = backgroundOf(m, theme, surface, pair.layers ?? []);
  const ratio = contrast(over(text.rgb, text.alpha, background), background);
  return { ratio, line: `${pair.name} | ${SURFACES[surface].label} | ${THEME_LABEL[theme]} | ${ratio.toFixed(2)}:1 mot gränsen ${TEXT_MIN}:1 | text ${toHex(over(text.rgb, text.alpha, background))} mot ${toHex(background)}` };
}

function failures(pairs: TextPair[], theme: Theme, tokens = themeTokens(indexCss, theme)): string[] {
  return pairs.flatMap((pair) => pair.surfaces.map((surface) => measureText(pair, theme, surface, tokens))).filter((verdict) => verdict.ratio < TEXT_MIN).map((verdict) => verdict.line);
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const CHALLENGE_TIERS = ['minor', 'major', 'legendary'] as const;
const challengeTier = (tier: string): ReadonlyArray<readonly [string, string]> => [[DUELS, `.rq-duels [data-tier="${tier}"]`]];

const CHIP_SELECTED = '.rq-duels-chips > .rq-duels-chip[aria-pressed="true"]';
const TOKEN_CARD: Locator = [DUELS, '.rq-duels-token', 'background'];
const HAIRGRID: Locator = [INDEX, '.rq-hairgrid', 'background'];
const OPPONENTS: Locator = [DUELS, '.rq-hairgrid.rq-duels-opponents', 'background'];
const OPPONENT_SELECTED = '.rq-duels-option--opponent[aria-checked="true"]';
const ROW_SOFT: Locator = [INDEX, '.rq-row', 'background'];
const ORDER_ROW: Locator = [BOARD_POSITION, '.rq-board-position-order__row', 'background'];
const ORDER_ROW_PRESSED: Locator = [BOARD_POSITION, '.rq-board-position-order__row[aria-pressed="true"]', 'background'];

const label = (file: string, selector: string): Locator => [file, selector, 'color'];

const CATEGORIES: Array<{ title: string; pairs: TextPair[] }> = [
  {
    title: 'nivåchips (Minor, Major, Legendary): text mot sin tonade bakgrund',
    pairs: [
      ...CHALLENGE_TIERS.map((tier): TextPair => ({
        name: `${capitalize(tier)}-chipet, valt`, surfaces: ['card', 'sheet'], fg: label(DUELS, CHIP_SELECTED), layers: [[DUELS, CHIP_SELECTED, 'background']], scope: challengeTier(tier),
      })),
      { name: 'Nivåchip, vilande', surfaces: ['card', 'sheet'], fg: label(DUELS, '.rq-duels-chips > .rq-duels-chip') },
      { name: 'Tokenkortets nivårubrik (Minor/Major/Legendary ×n)', surfaces: ['card'], fg: label(DUELS, '.rq-duels-token__what'), layers: [TOKEN_CARD], scope: challengeTier('minor') },
      { name: 'Tokenkortets insats-rad', surfaces: ['card'], fg: label(DUELS, '.rq-duels-token__stake'), layers: [TOKEN_CARD], scope: challengeTier('minor') },
    ],
  },
  {
    title: 'SEND på tokenkortet: text mot kortets tonade bakgrund',
    pairs: CHALLENGE_TIERS.map((tier): TextPair => ({ name: `SEND på ${capitalize(tier)}-kortet`, surfaces: ['card'], fg: label(DUELS, '.rq-duels-send'), layers: [TOKEN_CARD], scope: challengeTier(tier) })),
  },
  {
    title: '"Selected" i send-arket: text mot det valda tokenkortet',
    pairs: CHALLENGE_TIERS.map((tier): TextPair => ({ name: `"Selected" på ${capitalize(tier)}-kortet`, surfaces: ['sheet'], fg: label(DUELS, '.rq-duels-choice__selected'), layers: [TOKEN_CARD], scope: challengeTier(tier) })),
  },
  {
    title: 'valda flikar och filter: guldtext mot --rq-tint-selected',
    pairs: [
      { name: 'Vald segmenterad knapp / filter', surfaces: ['shell', 'card', 'popup'], fg: label(INDEX, '.rq-filter[aria-pressed="true"]'), layers: [[INDEX, '.rq-filter[aria-pressed="true"]', 'background']] },
      { name: 'Vald flik i filterraden (aria-selected)', surfaces: ['shell', 'card', 'popup'], fg: label(INDEX, '.rq-filter[aria-selected="true"]'), layers: [[INDEX, '.rq-filter[aria-selected="true"]', 'background']] },
      {
        name: 'Vald flik i profilpopupen', surfaces: ['popup'], fg: label(INDEX, '.rq-tab[aria-selected="true"]'),
        layers: [[RUNNER, '.rq-runner-popup-tabs > .rq-tab[aria-selected="true"]', 'background']],
      },
      {
        name: 'Vald flik på profilsidan', surfaces: ['card'], fg: label(INDEX, '.rq-tab[aria-selected="true"]'),
        layers: [[PROFILE, '.rq-profile-tabs > .rq-tab[aria-selected="true"]', 'background']],
      },
      { name: 'Vilande flik', surfaces: ['card', 'popup'], fg: label(INDEX, '.rq-tab') },
    ],
  },
  {
    title: 'Time- och Pace-etiketter (--rq-text-4) mot kortet',
    pairs: [
      { name: 'Time/Pace-etikett i rundhistoriken (profil)', surfaces: ['card'], fg: label(PROFILE, '.rq-profile-run__tlabel') },
      { name: 'Time/Pace-etikett i summaraden (profil)', surfaces: ['card'], fg: label(PROFILE, '.rq-profile-run__tlabel'), layers: [[PROFILE, '.rq-profile-history__sum', 'background']] },
      { name: 'Time/Pace-etikett i gruppens rundlogg', surfaces: ['card'], fg: label(LOG, '.rq-log-run__stat-label') },
    ],
  },
  {
    title: 'Head to head-etiketter',
    pairs: [
      { name: 'Head to head: bannerrubriken i profilpopupen', surfaces: ['popup'], fg: label(RUNNER, '.rq-runner-h2h-banner__head') },
      {
        name: 'Head to head: rekordets etikett (Wins/Losses/…)', surfaces: ['popup', 'popupCard', 'card'], fg: label(RUNNER, '.rq-runner-cell__label'),
        layers: [HAIRGRID, [RUNNER, '.rq-runner-cell', 'background']],
      },
      { name: 'Head to head: mötets resultat', surfaces: ['popupCard', 'card'], fg: label(RUNNER, '.rq-runner-meeting__score'), layers: [ROW_SOFT] },
      { name: 'Head to head: mötets datum', surfaces: ['popupCard', 'card'], fg: label(RUNNER, '.rq-runner-meeting__date'), layers: [ROW_SOFT] },
      {
        name: 'Head to head: rekordets etikett på Duels', surfaces: ['card'], fg: label(DUELS, '.rq-duels-record__label'),
        layers: [HAIRGRID, [INDEX, '.rq-hairgrid > .rq-cell', 'background']],
      },
      { name: 'Head to head: motståndarradens rekord', surfaces: ['sheet'], fg: label(DUELS, '.rq-duels-option__h2h'), layers: [OPPONENTS, [DUELS, '.rq-duels-option', 'background']] },
      { name: 'Head to head: motståndarradens rekord, vinst', surfaces: ['sheet'], fg: label(DUELS, '.rq-duels-option__h2h[data-tone="up"]'), layers: [OPPONENTS, [DUELS, '.rq-duels-option', 'background']] },
      { name: 'Head to head: motståndarradens rekord, förlust', surfaces: ['sheet'], fg: label(DUELS, '.rq-duels-option__h2h[data-tone="down"]'), layers: [OPPONENTS, [DUELS, '.rq-duels-option', 'background']] },
      {
        name: 'Head to head: vald motståndarrads rekord', surfaces: ['sheet'], fg: label(DUELS, `${OPPONENT_SELECTED} .rq-duels-option__h2h:not([data-tone="up"], [data-tone="down"])`),
        layers: [OPPONENTS, [DUELS, OPPONENT_SELECTED, 'background']],
      },
      {
        name: 'Head to head: vald motståndarrads rekord, vinst', surfaces: ['sheet'], fg: label(DUELS, '.rq-duels-option__h2h[data-tone="up"]'),
        layers: [OPPONENTS, [DUELS, OPPONENT_SELECTED, 'background']],
      },
      {
        name: 'Head to head: vald motståndarrads rekord, förlust', surfaces: ['sheet'], fg: label(DUELS, '.rq-duels-option__h2h[data-tone="down"]'),
        layers: [OPPONENTS, [DUELS, OPPONENT_SELECTED, 'background']],
      },
    ],
  },
  {
    title: 'positionsgrafen: siffran på guldpunkten och etiketterna',
    pairs: [
      {
        name: 'Positionsgraf (profil): siffran på den fyllda guldpunkten', surfaces: ['card'], fg: label(PROFILE_POSITION, '.rq-profile-position__dot[data-filled="true"]'),
        layers: [[PROFILE_POSITION, '.rq-profile-position__dot[data-filled="true"]', 'background']],
      },
      {
        name: 'Positionsgraf (profil): siffran i punkten med ring', surfaces: ['card'], fg: label(PROFILE_POSITION, '.rq-profile-position__dot'),
        layers: [[PROFILE_POSITION, '.rq-profile-position__dot', 'background']],
      },
      { name: 'Positionsgraf (profil): veckoetikett', surfaces: ['card'], fg: label(PROFILE_POSITION, '.rq-profile-position__week') },
      { name: 'Positionsgraf (profil): pågående vecka', surfaces: ['card'], fg: label(PROFILE_POSITION, '.rq-profile-position__week[data-current="true"]') },
      { name: 'Positionsgraf (profil): period', surfaces: ['card'], fg: label(PROFILE_POSITION, '.rq-profile-position__period') },
      { name: 'Positionsgraf (profil): förklaring', surfaces: ['card'], fg: label(PROFILE_POSITION, '.rq-profile-position__legend') },
      { name: 'Positionsgraf (profil): Best/Lowest/Now', surfaces: ['card'], fg: label(PROFILE_POSITION, '.rq-profile-position__stat-label') },
      { name: 'Positionsgraf (profil): tabellens rubriker', surfaces: ['card'], fg: label(PROFILE_POSITION, '.rq-profile-position__table thead th') },
      { name: 'Positionsgraf (profil): fotnot', surfaces: ['card'], fg: label(PROFILE_POSITION, '.rq-profile-position__footnote') },
      { name: 'Positionsgraf (Board): axeltal', surfaces: ['card'], fg: label(BOARD_POSITION, '.rq-board-position__axis-num') },
      { name: 'Positionsgraf (Board): veckoetikett', surfaces: ['card'], fg: label(BOARD_POSITION, '.rq-board-position__week') },
      { name: 'Positionsgraf (Board): namn vid linjeslutet', surfaces: ['card'], fg: label(BOARD_POSITION, '.rq-board-position__name') },
      { name: 'Positionsgraf (Board): förklaring', surfaces: ['card'], fg: label(BOARD_POSITION, '.rq-board-position__legend') },
      { name: 'Positionsgraf (Board): rubrik och period', surfaces: ['card'], fg: label(BOARD_POSITION, '.rq-board-position__eyebrow') },
      { name: 'Positionsgraf (Board): tabellens veckorubriker', surfaces: ['card'], fg: label(BOARD_POSITION, '.rq-board-position__table thead th') },
      { name: 'Positionsgraf (Board): tabellens tomma cell', surfaces: ['card'], fg: label(BOARD_POSITION, '.rq-board-position__table td[data-empty="true"]') },
      { name: 'Positionsgraf (Board): fotnot', surfaces: ['card'], fg: label(BOARD_POSITION, '.rq-board-position__footnote') },
      { name: 'Current order: rubrik', surfaces: ['card'], fg: label(BOARD_POSITION, '.rq-board-position-order__title') },
      { name: 'Current order: hint', surfaces: ['card'], fg: label(BOARD_POSITION, '.rq-board-position-order__hint') },
      { name: 'Current order: placering', surfaces: ['card'], fg: label(BOARD_POSITION, '.rq-board-position-order__place'), layers: [ORDER_ROW] },
      { name: 'Current order: Joined', surfaces: ['card'], fg: label(BOARD_POSITION, '.rq-board-position-order__joined'), layers: [ORDER_ROW] },
      { name: 'Current order: placering på vald rad', surfaces: ['card'], fg: label(BOARD_POSITION, '.rq-board-position-order__place'), layers: [ORDER_ROW_PRESSED] },
      { name: 'Current order: Joined på vald rad', surfaces: ['card'], fg: label(BOARD_POSITION, '.rq-board-position-order__joined'), layers: [ORDER_ROW_PRESSED] },
    ],
  },
  {
    title: 'nivåchippet på badgekortet i profilpopupen (som det ritas i v0.8.3): text mot chippets tonade bakgrund',
    pairs: TIER_NAMES.map((tierName): TextPair => {
      const key = tierName.toLowerCase();
      return {
        name: `${tierName}-chippet på badgekortet`, surfaces: ['popupCard'],
        fg: (theme): Locator => (theme === 'light'
          ? [RUNNER, '[data-theme="light"] .rq-runner-badges__grid .rq-badge-chip[data-tier]', 'color']
          : [INDEX, '.rq-chip--status', 'color']),
        layers: [[BADGES, '.rq-badge-card', 'background'], [BADGES, '.rq-chip.rq-badge-chip[data-tier]', 'background']],
        scope: [[BADGES, '.rq-badge-chip[data-tier]'], [BADGES, `:is(.rq-badge, .rq-badge-pips, .rq-badge-chip, .rq-badge-popup__tierline)[data-tier="${key}"]`]],
      };
    }),
  },
];

describe.each(CATEGORIES)('kontrastvakt, text ≥ 4,5:1: $title', ({ pairs }) => {
  it.each(THEMES)('varje par når gränsen i %s tema', (theme) => {
    expect(pairs.length).toBeGreaterThan(0);
    expect(failures(pairs, theme)).toEqual([]);
  });
});

// ─── Fokusringen ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

interface Ring { width: number; color: Rgba; offset: number }
type RuleRef = readonly [file: string, selector: string];

const OUTLINE = /^(\d+(?:\.\d+)?)px\s+solid\s+(.+)$/;

/** Ringen som kaskaden ger: temats globala :focus-visible, därefter varje regel i ordning (outline, outline-color, outline-offset). */
function focusRing(theme: Theme, tokens: Map<string, string>, rules: RuleRef[]): Ring {
  const m = measuring(theme, tokens);
  const apply = (ring: Partial<Ring>, file: string, selector: string): Partial<Ring> => {
    const next = { ...ring };
    const outline = tryDeclaration(file, selector, 'outline');
    if (outline !== undefined) {
      const parsed = OUTLINE.exec(resolveVarsText(m, outline));
      if (!parsed) throw new Error(`Okänd outline "${outline}" i ${selector}`);
      next.width = Number(parsed[1]);
      next.color = parseColor(parsed[2]);
    }
    const color = tryDeclaration(file, selector, 'outline-color');
    if (color !== undefined) next.color = colorOf(m, color);
    const offset = tryDeclaration(file, selector, 'outline-offset');
    if (offset !== undefined) next.offset = Number(resolveVarsText(m, offset).replace('px', ''));
    return next;
  };
  let ring: Partial<Ring> = apply({}, INDEX, ':focus-visible');
  for (const [file, selector] of rules) ring = apply(ring, file, selector);
  if (ring.width === undefined || ring.color === undefined || ring.offset === undefined) throw new Error(`Fokusringen är ofullständig för ${rules.map(([, selector]) => selector).join(' + ')}`);
  return ring as Ring;
}

const resolveVarsText = (m: Measuring, value: string) => {
  let current = value;
  for (let depth = 0; depth < 25 && /var\(/.test(current); depth += 1) {
    current = current.replace(/var\(\s*(--[\w-]+)\s*\)/g, (_match, name: string) => {
      const found = m.scope.get(name) ?? m.tokens.get(name);
      if (found === undefined) throw new Error(`Token ${name} finns inte`);
      return found;
    });
  }
  return current.trim();
};

interface RingCase {
  name: string;
  surfaces: SurfaceName[];
  rules: RuleRef[];
  /** Bakgrunderna under ringen (ringen ritas inåt, alltså över kontrollens egen yta), nerifrån och upp. */
  layers?: Source[];
  scope?: ReadonlyArray<readonly [string, string]>;
}

const TAB_RULE: RuleRef = [VIEW_CONTROLS, '[role="tablist"] > .rq-tab:focus-visible'];
const PROFILE_TAB: RuleRef = [PROFILE, '.rq-profile-tabs > .rq-tab:focus-visible'];
const SEGMENTED: RuleRef = [VIEW_CONTROLS, '.rq-segmented > .rq-filter:focus-visible'];
const SEGMENTED_PRESSED: RuleRef = [VIEW_CONTROLS, '.rq-segmented > .rq-filter[aria-pressed="true"]:focus-visible'];
const TABLIST_FILTER: RuleRef = [VIEW_CONTROLS, '[role="tablist"] > .rq-filter:focus-visible'];
const TABLIST_FILTER_SELECTED: RuleRef = [VIEW_CONTROLS, '[role="tablist"] > .rq-filter[aria-selected="true"]:focus-visible'];
const FILTER_SELECTED_BACKGROUND: Locator = [INDEX, '.rq-filter[aria-pressed="true"]', 'background'];

const RING_CASES: RingCase[] = [
  { name: 'Flik (understruken, profilsidan), vilande', surfaces: ['card'], rules: [TAB_RULE, PROFILE_TAB] },
  {
    name: 'Flik (understruken, profilsidan), vald', surfaces: ['card'], rules: [TAB_RULE, PROFILE_TAB, [PROFILE, '.rq-profile-tabs > .rq-tab[aria-selected="true"]:focus-visible']],
    layers: [[PROFILE, '.rq-profile-tabs > .rq-tab[aria-selected="true"]', 'background']],
  },
  { name: 'Flik (understruken, profilpopupen), vilande', surfaces: ['popup'], rules: [TAB_RULE] },
  { name: 'Flik (understruken, profilpopupen), vald', surfaces: ['popup'], rules: [TAB_RULE], layers: [[RUNNER, '.rq-runner-popup-tabs > .rq-tab[aria-selected="true"]', 'background']] },
  { name: 'Flik (filterrad: Board, Duels), vilande', surfaces: ['shell', 'card'], rules: [TABLIST_FILTER] },
  { name: 'Flik (filterrad: Board, Duels), vald', surfaces: ['shell', 'card'], rules: [TABLIST_FILTER, TABLIST_FILTER_SELECTED], layers: [[INDEX, '.rq-filter[aria-selected="true"]', 'background']] },
  { name: 'Segmenterad kontroll, vilande knapp', surfaces: ['card', 'popup'], rules: [SEGMENTED] },
  { name: 'Segmenterad kontroll, vald knapp', surfaces: ['card', 'popup'], rules: [SEGMENTED, SEGMENTED_PRESSED], layers: [FILTER_SELECTED_BACKGROUND] },
  ...CHALLENGE_TIERS.flatMap((tier): RingCase[] => [
    { name: `Nivåchip ${capitalize(tier)}, vilande`, surfaces: ['card', 'sheet'], rules: [SEGMENTED], scope: challengeTier(tier) },
    {
      name: `Nivåchip ${capitalize(tier)}, valt`, surfaces: ['card', 'sheet'], rules: [SEGMENTED, SEGMENTED_PRESSED], layers: [[DUELS, CHIP_SELECTED, 'background']], scope: challengeTier(tier),
    },
  ]),
  { name: 'Current order, rad', surfaces: ['card'], rules: [[BOARD_POSITION, '.rq-board-position-order__row:focus-visible']], layers: [ORDER_ROW] },
  { name: 'Current order, vald rad', surfaces: ['card'], rules: [[BOARD_POSITION, '.rq-board-position-order__row:focus-visible']], layers: [ORDER_ROW_PRESSED] },
];

function ringProblems(cases: RingCase[], theme: Theme, tokens = themeTokens(indexCss, theme)): string[] {
  const problems: string[] = [];
  for (const ringCase of cases) {
    const ring = focusRing(theme, tokens, ringCase.rules);
    for (const surface of ringCase.surfaces) {
      const m = measuring(theme, tokens, ringCase.scope);
      const background = backgroundOf(m, theme, surface, ringCase.layers ?? []);
      const colour = over(ring.color.rgb, ring.color.alpha, background);
      const ratio = contrast(colour, background);
      const where = `${ringCase.name} | ${SURFACES[surface].label} | ${THEME_LABEL[theme]}`;
      if (ratio < RING_MIN) problems.push(`${where} | fokusringen ${ratio.toFixed(2)}:1 mot gränsen ${RING_MIN}:1 | ring ${toHex(colour)} mot ${toHex(background)}`);
      if (ring.offset >= 0) problems.push(`${where} | fokusringen ritas utanför (outline-offset ${ring.offset}px), inåt kräver ett negativt värde`);
      if (ring.width < RING_MIN_WIDTH_PX) problems.push(`${where} | fokusringen är ${ring.width}px, minst ${RING_MIN_WIDTH_PX}px`);
    }
  }
  return problems;
}

describe('kontrastvakt, fokusring ≥ 3:1 mot ytan och inåtriktad: flikar, segmenterad kontroll, nivåchips och Current order', () => {
  it.each(THEMES)('varje ring når gränsen, är minst 2 px och ritas inåt i %s tema', (theme) => {
    expect(RING_CASES.length).toBeGreaterThan(0);
    expect(ringProblems(RING_CASES, theme)).toEqual([]);
  });
});

// ─── Vakten själv ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('kontrastvakten själv', () => {
  it('fäller ett sänkt token med paret i klartext (negativ kontroll, utan att röra index.css)', () => {
    const lowered = themeTokens(indexCss, 'dark');
    lowered.set('--rq-text-4', 'rgb(var(--rq-ink-rgb) / .20)');
    const timePace = CATEGORIES.find((category) => category.title.startsWith('Time- och Pace'))!.pairs;
    const found = failures(timePace, 'dark', lowered);
    expect(found).toHaveLength(timePace.length);
    expect(found[0]).toContain('Time/Pace-etikett i rundhistoriken (profil) | kortet | mörkt tema |');
    expect(found[0]).toMatch(/\d\.\d\d:1 mot gränsen 4\.5:1/);
  });

  it('fäller en fokusring som ritas utåt eller är för svag', () => {
    const weak = themeTokens(indexCss, 'light');
    weak.set('--rq-gold-text', '#e8d9c5');
    expect(ringProblems(RING_CASES.filter((ringCase) => ringCase.name.startsWith('Segmenterad kontroll, vilande')), 'light', weak).join('\n')).toMatch(/Segmenterad kontroll, vilande knapp \| kortet \| ljust tema \| fokusringen \d\.\d\d:1 mot gränsen 3:1/);
    const outward = themeTokens(indexCss, 'dark');
    outward.set('--rq-focus-inset', '2px');
    expect(ringProblems(RING_CASES.filter((ringCase) => ringCase.name.startsWith('Current order, rad')), 'dark', outward).join('\n')).toContain('ritas utanför');
  });

  it('mäter som WCAG och läser temats färgformer: svart mot vitt är 21:1, alfa komponeras och color-mix blandas', () => {
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(parseColor('rgb(38 35 31 / .65)')).toEqual({ rgb: [38, 35, 31], alpha: 0.65 });
    expect(parseColor('rgba(33, 33, 33, .62)')).toEqual({ rgb: [33, 33, 33], alpha: 0.62 });
    expect(parseColor('#fff')).toEqual({ rgb: [255, 255, 255], alpha: 1 });
    const mixed = parseColor('color-mix(in srgb, #ffd700 45%, #26231f)');
    expect(mixed.alpha).toBe(1);
    expect(mixed.rgb.map(Math.round)).toEqual([Math.round(255 * 0.45 + 38 * 0.55), Math.round(215 * 0.45 + 35 * 0.55), Math.round(0 * 0.45 + 31 * 0.55)]);
  });

  it('mäter mot temat: ljust tema binder om textfärgerna, mörkt gör det inte', () => {
    const dark = themeTokens(indexCss, 'dark');
    const light = themeTokens(indexCss, 'light');
    const ink = (tokens: Map<string, string>) => resolveColor(tokens, 'rgb(var(--rq-ink-rgb))').rgb;
    expect(ink(light)).not.toEqual(ink(dark));
    expect(resolveColor(dark, 'var(--rq-text-4)').rgb).toEqual(ink(dark));
    expect(resolveColor(light, 'var(--rq-text-4)').rgb).toEqual(ink(light));
    expect(dark.get('--rq-text-4')).not.toBe(light.get('--rq-text-4'));
  });

  it('vägrar mäta ett token som sätts i @media, med orsaken i klartext och bara i temat där det sätts', () => {
    const css = ':root { --a: #ffffff; --b: #000000; } @media (min-width: 1px) { [data-theme="light"] { --a: #111111; } :root { --b: #222222; } }';
    const names = { dark: mediaTokenNames(css, 'dark'), light: mediaTokenNames(css, 'light') };
    expect([...names.dark]).toEqual(['--b']);
    expect([...names.light].sort()).toEqual(['--a', '--b']);
    const dark = refusingMediaTokens(themeTokens(css, 'dark'), names.dark, 'dark');
    expect(resolveColor(dark, 'var(--a)').rgb).toEqual([255, 255, 255]);
    expect(() => resolveColor(dark, 'var(--b)')).toThrow(/--b sätts även i ett @media-block.*mörkt tema/);
    const light = refusingMediaTokens(themeTokens(css, 'light'), names.light, 'light');
    expect(() => resolveColor(light, 'var(--a)')).toThrow(/--a sätts även i ett @media-block.*ljust tema/);
  });
});
