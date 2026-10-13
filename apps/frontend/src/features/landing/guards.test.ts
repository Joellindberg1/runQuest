import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Designreglerna för Landing (tokens, skarpa hörn, ikoner, inga emojis, rörelse, att CSS-måtten finns i temafilen, en guldknapp i
// LandingScreen.test) och att landningen bara gör ETT anrop (GET /public/stats, ADR 006-addendum 2026-10-13) vaktas av lint: eslint.config.js,
// stylelint.config.js och src/test/themeTokens.sync.test.ts. Kvar här är layoutreglerna och de delade definitionerna som lint inte kan uttrycka.

const sources = import.meta.glob(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}', '../../pages/LandingPage.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const indexPage = import.meta.glob('../../pages/Index.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

// CSS läses från disk: vitest (css: false) tömmer ?raw-importer av .css, så en glob ger tomma strängar och tysta godkännanden.
const readFromDisk = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const css = readFromDisk('./landing.css');
const theme = readFromDisk('../../index.css');

const codeFiles = Object.entries(sources);
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('Landing — layout som inte får gå sönder', () => {
  it('under 380 px ligger banan under rubriken i ett enda spår (att "LEADERBOARD" aldrig bryts mitt i ordet vaktas av Stylelint)', () => {
    // jsdom har ingen layout, så regeln vaktas i CSS:en; bredderna 320–1440 är mätta i Chromium (getClientRects = 1 rektangel).
    const narrow = stripComments(css).match(/@media \(max-width: 379px\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(narrow).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/);
    expect(narrow).toMatch(/grid-template-areas:\s*"title" "arena" "lead" "cta" "film" "stats"/);
  });

  it('löparna har spridda vilopositioner så reducerad rörelse visar en ögonblicksbild, inte en klump (sex löpare, olika platser på banan)', () => {
    // Temafilens globala regel kapar animationerna till en enda .01 ms-omgång utan fyllnad, och elementen hamnar då i sitt basläge.
    const offsets = [...stripComments(css).matchAll(/\.rq-landing-runner\[data-runner="(\d)"\] \{ offset-distance: ([\d.]+)%;/g)].map((m) => [m[1], m[2]]);
    expect(offsets).toEqual([['1', '0'], ['2', '35'], ['3', '70'], ['4', '15'], ['5', '50'], ['6', '85']]);
  });

  it('rutnät, löpare och XP-pop står still vid reducerad rörelse', () => {
    // Temafilens globala regel (prövas i themeTokens.sync.test.ts) kapar animationerna till en omgång; basläget är då stilla:
    // XP-poppen är osynlig (opacity 0), rutnätet börjar på 0 0 och löparna står på sina vilopositioner (testet ovan).
    expect(stripComments(css)).toMatch(/\.rq-landing-xp \{[^}]*opacity: 0;/);
    expect(theme).toMatch(/@keyframes rqGrid\s*\{ from \{ background-position: 0 0; \}/);
  });
});

describe('Landing — fast header', () => {
  // jsdom har ingen layout: att headern sitter kvar och att ankarna landar under den är mätt i Chromium (390 och 1440 px). Här vaktas de regler som får
  // det att fungera och som lätt går sönder tyst: sticky mot fönstret, safe-area, lagret och ankarförskjutningen.
  const ruleBody = (selector: string) => {
    const source = stripComments(css);
    const start = source.indexOf(`\n${selector} {`);
    return start < 0 ? '' : source.slice(start, source.indexOf('}', start));
  };
  const mobileTheme = theme.split('@media (min-width: 1024px)')[0];
  const desktopTheme = theme.split('@media (min-width: 1024px)')[1] ?? '';

  it('headern är sticky överst med safe-area-avståndet, på ett eget lager, med sidans glasbakgrund', () => {
    const header = ruleBody('.rq-landing-header');
    expect(header).toMatch(/position:\s*sticky/);
    expect(header).toMatch(/top:\s*var\(--rq-landing-header-top\)/);
    expect(header).toMatch(/z-index:\s*var\(--rq-z-landing-header\)/);
    expect(header).toMatch(/background:\s*var\(--rq-bg-shell\)/);
    expect(mobileTheme).toMatch(/--rq-landing-header-top:\s*env\(safe-area-inset-top, 0px\)/);
  });

  it('sidan klipper dekoren med overflow: clip — hidden gör den till scrollbehållare och sticky skulle aldrig fastna mot fönstret', () => {
    const page = ruleBody('.rq-landing');
    expect(page).toMatch(/overflow:\s*clip/);
    expect(page).not.toMatch(/overflow(?:-[xy])?:\s*(?:hidden|auto|scroll)/);
  });

  it('ankarlänkarna landar under headern: dokumentets scroll-padding-top är headerns höjd plus safe-area, och headern har exakt den höjden', () => {
    expect(ruleBody('html:has(.rq-landing)')).toMatch(/scroll-padding-top:\s*calc\(var\(--rq-landing-header-top\) \+ var\(--rq-landing-header-h\)\)/);
    expect(ruleBody('.rq-landing-header')).toMatch(/height:\s*var\(--rq-landing-header-h\)/);
  });

  it('headerhöjden (mobil 76, desktop 88) och lagret är deklarerade i temafilen', () => {
    expect(mobileTheme).toMatch(/--rq-landing-header-h:\s*76px/);
    expect(desktopTheme).toMatch(/--rq-landing-header-h:\s*88px/);
    expect(mobileTheme).toMatch(/--rq-z-landing-header:\s*20;/);
  });
});

describe('Landing-FEATUREN delar sina definitioner', () => {
  // Ett enda anrop (GET /public/stats i hooks/usePublicStats.ts), ingen auth och ingen annan data vaktas av ESLint, se eslint.config.js (LANDING_IMPORTS/LANDING_SYNTAX).

  it('exempeldatan är EN delad definition (features/leaderboard/previewUsers) — featuren skriver inga egna löpare', () => {
    expect(sources['./components/LandingScreen.tsx']).toMatch(/leaderboard\/previewUsers/);
    for (const [path, text] of codeFiles) expect({ path, ownUsers: /total_xp\s*:/.test(stripComments(text)) }).toEqual({ path, ownUsers: false });
  });

  it('XP- och streak-siffrorna i texten kommer ur shared-definitionerna, inte ur en egen kopia (ADR 004)', () => {
    const model = sources['./landingModel.ts'];
    expect(model).toMatch(/DEFAULT_ADMIN_SETTINGS/);
    expect(model).toMatch(/DEFAULT_STREAK_MULTIPLIERS/);
    expect(model).toMatch(/calculateRunXP/);
    // Att ingen fil importerar constants/streakConstants vaktas av ESLint (STREAK_CONSTANTS i eslint.config.js).
  });

  it('versionen i footern är package.json:s, inte en sträng som skrivs för hand', () => {
    expect(sources['./components/LandingFooter.tsx']).toMatch(/import \{ version \} from '[./]+\/package\.json'/);
  });
});

describe('Routing (ADR 006)', () => {
  it('Index visar Landing för utloggade; /login är samma sida med inloggningsdialogen ovanpå — ingen egen inloggningssida', () => {
    const [source] = Object.values(indexPage);
    expect(source).toMatch(/LandingPage/);
    expect(source).toMatch(/LoginDialog/);
    expect(source).not.toMatch(/LoginPage|LoginScreen/);
  });

  it('Sign in är en vanlig länk till paths.login (gränsen mot auth — inga importer ur features/auth eller providers/auth — vaktas av ESLint; dialogen monteras av pages/Index)', () => {
    expect(sources['./components/LandingHeader.tsx']).toMatch(/<Link to=\{paths\.login\} state=\{FROM_LANDING_STATE\}/);
  });

  it('sidan är tunn: LandingPage monterar bara LandingScreen', () => {
    const page = stripComments(sources['../../pages/LandingPage.tsx']);
    expect(page).toMatch(/<LandingScreen \/>/);
    expect(page.split('\n').length).toBeLessThan(12);
  });
});
