import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postcss, { type Declaration } from 'postcss';
import { describe, expect, it } from 'vitest';
import { buildStatViews } from './landingModel';

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

describe('Landing — varianterna väljs av CSS, aldrig av JS', () => {
  // Förrenderingen vet inte bredden (ADR 006-addendum 2026-10-19, punkt 5): båda varianterna ligger i HTML och `display: none` döljer den ena. jsdom har
  // ingen layout och kör ingen CSS, så vilken variant som syns vid 390 respektive 1440 px är mätt i Chromium; här vaktas att varje par har sin
  // väljarregel, med samma brytpunkt som skalet (1024 px). Att JS inte väljer variant vaktas av ESLint (LANDING_NO_VIEWPORT_OR_LOCALE).
  const BREAKPOINT = '(min-width: 1024px)';
  const sheets = [css, readFromDisk('./landingFilm.css')].map((text) => postcss.parse(text));

  /** Deklarationen `property` på väljaren, antingen i sin grundregel (mobil först) eller i desktopens `@media (min-width: 1024px)`. */
  const valueOf = (selector: string, property: string, scope: 'base' | 'desktop') => {
    const values: string[] = [];
    for (const sheet of sheets) {
      sheet.walkRules((rule) => {
        if (!rule.selectors.some((candidate) => candidate.trim() === selector)) return;
        const parent = rule.parent;
        const inDesktop = parent?.type === 'atrule' && (parent as postcss.AtRule).name === 'media' && (parent as postcss.AtRule).params === BREAKPOINT;
        const inBase = parent?.type === 'root';
        if ((scope === 'desktop' && !inDesktop) || (scope === 'base' && !inBase)) return;
        rule.walkDecls(property, (decl) => { values.push(decl.value); });
      });
    }
    return values.at(-1);
  };

  const DESKTOP_ONLY = [
    '.rq-landing-nav',
    '.rq-landing-eyebrow--desktop',
    '.rq-landing-notes',
    '.rq-landing-lead__long',
    '.rq-landing-arena__svg[data-arena="desktop"]',
    '.rq-film--desktop',
  ];
  const MOBILE_ONLY = [
    '.rq-landing-lead__short',
    '.rq-landing-arena__svg[data-arena="mobile"]',
    '.rq-film--mobile',
    '.rq-landing-hero__film',
  ];

  it.each(DESKTOP_ONLY)('%s är dold i grundregeln (mobil) och visas från 1024 px', (selector) => {
    expect(valueOf(selector, 'display', 'base')).toBe('none');
    expect(valueOf(selector, 'display', 'desktop')).toMatch(/^(?:block|flex|inline)$/);
  });

  it.each(MOBILE_ONLY)('%s visas som standard (mobil) och döljs från 1024 px', (selector) => {
    expect(valueOf(selector, 'display', 'base')).not.toBe('none');
    expect(valueOf(selector, 'display', 'desktop')).toBe('none');
  });

  it('rubriker som bara syns på desktop är visuellt gömda (men kvar för skärmläsare) på mobil', () => {
    expect(valueOf('.rq-landing-h2--desktop', 'position', 'base')).toBe('absolute');
    expect(valueOf('.rq-landing-h2--desktop', 'position', 'desktop')).toBe('static');
  });

});

describe('Landing — sifferraden flyttar inget när talen anländer', () => {
  // jsdom har ingen layout: att inget annat än talen flyttas (±1 px, 360 och 1440 px) är mätt i Chromium. Här vaktas reservationen som gör det,
  // eftersom ingen roll- eller texttest ser den: varje tal har en minsta bredd i ch, och km (det bredaste talet) reserverar mer än de två andra.
  const reservedCh = (stat: string) => {
    let value: string | undefined;
    postcss.parse(css).walkRules((rule) => {
      if (!rule.selectors.includes(`.rq-landing-stat[data-stat="${stat}"] .rq-landing-stat__value`)) return;
      rule.walkDecls('min-width', (decl) => { value = decl.value; });
    });
    return Number(value?.match(/^(\d+(?:\.\d+)?)ch$/)?.[1]);
  };

  it.each(['km', 'runners', 'challenges'])('%s reserverar bredd i ch', (stat) => {
    expect(reservedCh(stat)).toBeGreaterThan(0);
  });

  // Etiketten byter form mellan ental och plural ("1 runner" / "6 runners"); ett osynligt pseudoelement med pluralformen håller postens bredd. Texten
  // står i CSS och måste vara samma som modellens plural, annars reserverar den fel bredd utan att något annat larmar.
  const reservedLabel = (stat: string) => {
    let value: string | undefined;
    postcss.parse(css).walkRules((rule) => {
      if (!rule.selectors.includes(`.rq-landing-stat[data-stat="${stat}"] .rq-landing-stat__label::after`)) return;
      rule.walkDecls('content', (decl) => { value = decl.value.replace(/^["']|["']$/g, ''); });
    });
    return value;
  };
  const pluralLabel = (stat: 'runners' | 'challenges') => buildStatViews({ runners: 2, challenges: 2, km: 0 }).find((view) => view.key === stat)?.label;

  it.each(['runners', 'challenges'] as const)('%s reserverar pluraletikettens bredd så att ental inte gör posten smalare', (stat) => {
    expect(reservedLabel(stat)).toBe(pluralLabel(stat));
  });

  it('km reserverar mer än löpare och utmaningar', () => {
    expect(reservedCh('km')).toBeGreaterThan(reservedCh('runners'));
    expect(reservedCh('km')).toBeGreaterThan(reservedCh('challenges'));
  });
});

describe('Landing — fast header', () => {
  // jsdom har ingen layout: att headern sitter kvar, att ankarna landar under den och att safe-area-remsan är fylld är mätt i Chromium (390 och 1440 px).
  // Här vaktas de regler som får det att fungera och som lätt går sönder tyst: sticky mot fönstret (ingen förfader med egen scrollbehållare),
  // safe-area, lagret och ankarförskjutningen.
  const ruleBody = (selector: string) => {
    const source = stripComments(css);
    const start = source.indexOf(`\n${selector} {`);
    return start < 0 ? '' : source.slice(start, source.indexOf('}', start));
  };
  const mobileTheme = theme.split('@media (min-width: 1024px)')[0];
  const desktopTheme = theme.split('@media (min-width: 1024px)')[1] ?? '';
  const tokenValue = (block: string, name: string) => block.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim() ?? '';
  const pixels = (value: string) => Number(value.match(/^(\d+(?:\.\d+)?)px$/)?.[1]);

  /** Alla overflow-deklarationer som sätts på headerns förfäder (sidan, dess inre ram, html, body, #root), i båda CSS-filerna. */
  const ANCESTORS = new Set(['.rq-landing', '.rq-landing__inner', 'html', 'body', '#root']);
  const ancestorOverflows = () => {
    const found: string[] = [];
    for (const [file, text] of [['landing.css', css], ['index.css', theme]] as const) {
      postcss.parse(text).walkRules((rule) => {
        if (!rule.selectors.some((selector) => ANCESTORS.has(selector.trim()))) return;
        const declarations = (rule.nodes ?? []).filter((node): node is Declaration => node.type === 'decl');
        declarations.forEach((decl, index) => {
          if (!/^overflow(?:-[xy])?$/.test(decl.prop) || !/^(?:hidden|auto|scroll)$/.test(decl.value)) return;
          // hidden som reserv direkt före clip (äldre Safari) är tillåtet: clip vinner där det stöds.
          const next = declarations[index + 1];
          if (decl.value === 'hidden' && next?.prop === decl.prop && next.value === 'clip') return;
          found.push(`${file}: ${rule.selector} { ${decl.prop}: ${decl.value} }`);
        });
      });
    }
    return found;
  };

  it('headern är sticky ända upp till fönstrets kant, på ett eget lager, med sidans mörka bas', () => {
    const header = ruleBody('.rq-landing-header');
    expect(header).toMatch(/position:\s*sticky/);
    expect(header).toMatch(/top:\s*0;/);
    expect(header).toMatch(/z-index:\s*var\(--rq-z-landing-header\)/);
    expect(header).toMatch(/background:\s*var\(--rq-bg-shell\)/);
  });

  it('safe-area-remsan fylls av headern: padding-top är inset plus ordinarie luft (mobil och desktop), minsta höjden är inset plus tokenen', () => {
    expect(mobileTheme).toMatch(/--rq-landing-header-inset:\s*env\(safe-area-inset-top, 0px\)/);
    const header = ruleBody('.rq-landing-header');
    expect(header).toMatch(/min-height:\s*calc\(var\(--rq-landing-header-inset\) \+ var\(--rq-landing-header-h\)\)/);
    expect(header).toMatch(/padding-block:\s*calc\(var\(--rq-landing-header-inset\) \+ var\(--rq-landing-header-pad-y\)\)/);
    // Desktop-regeln (i @media) skriver över padding-block och måste behålla insetet.
    const desktopRule = stripComments(css).match(/@media \(min-width: 1024px\) \{[\s\S]*?\n {2}\.rq-landing-header \{([^}]*)\}/)?.[1] ?? '';
    expect(desktopRule).toMatch(/padding-block:\s*calc\(var\(--rq-landing-header-inset\) \+ var\(--rq-landing-header-pad-y\)\)/);
  });

  it('ingen förfader till headern gör sidan till en egen scrollbehållare (hidden/auto/scroll; hidden direkt före clip som reserv är ok)', () => {
    expect(ancestorOverflows()).toEqual([]);
    expect(ruleBody('.rq-landing')).toMatch(/overflow:\s*clip/);
  });

  it('ankarlänkarna landar under headern: dokumentets scroll-padding-top är inset plus headerns höjd, och mobilfilmen (utan rubrik) har egen marginal', () => {
    expect(ruleBody('html:has(.rq-landing)')).toMatch(/scroll-padding-top:\s*calc\(var\(--rq-landing-header-inset\) \+ var\(--rq-landing-header-h\)\)/);
    expect(ruleBody('.rq-landing .rq-film--mobile')).toMatch(/scroll-margin-top:\s*var\(--rq-sp-\d+\)/);
  });

  it('tonen under headern är dekor i sidan (inte i headern): absolut placerad exakt under headerns nederkant, med befintliga tokens, utan klick', () => {
    // Headern får ingen ::after: den ligger på lagret över innehållet och dämpade hjältens rubrik på mobil, där hjälten börjar direkt under headern.
    expect(stripComments(css)).not.toMatch(/\.rq-landing-header::(?:after|before)/);
    const fade = ruleBody('.rq-landing__fade');
    expect(fade).toMatch(/position:\s*absolute/);
    // Headerns nederkant är inset + tokenen (hårlinjen på desktop ligger inuti den höjden), så tonen börjar under linjen och täcker den aldrig.
    expect(fade).toMatch(/top:\s*calc\(var\(--rq-landing-header-inset\) \+ var\(--rq-landing-header-h\)\)/);
    expect(fade).toMatch(/linear-gradient\(var\(--rq-bg-shell\), transparent\)/);
    expect(fade).toMatch(/pointer-events:\s*none/);
    expect(fade).not.toMatch(/z-index/);
  });

  it('innehållets ram är position: relative — det är det som ritar texten ovanför tonen under headern (utan det dämpas rubriken på mobil)', () => {
    // Tonen (.rq-landing__fade) är absolut placerad och kommer före ramen i trädet. Bara en positionerad ram hamnar över den i ritordningen; en statisk ram ritas under.
    expect(ruleBody('.rq-landing__inner')).toMatch(/position:\s*relative/);
  });

  it('temafilen deklarerar headerhöjden (desktop minst som mobil, minst en knapphöjd) och ett lager under skalets scrim', () => {
    const [mobileHeight, desktopHeight] = [mobileTheme, desktopTheme].map((block) => pixels(tokenValue(block, '--rq-landing-header-h')));
    expect(mobileHeight).toBeGreaterThanOrEqual(44);
    expect(desktopHeight).toBeGreaterThanOrEqual(mobileHeight);
    const layer = Number(tokenValue(mobileTheme, '--rq-z-landing-header'));
    expect(layer).toBeGreaterThan(0);
    expect(layer).toBeLessThan(65); // skalets .rq-scrim; dialogen (66) ritas över headern
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
