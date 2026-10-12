import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Designreglerna för Landing (tokens, skarpa hörn, ikoner, inga emojis, rörelse, att CSS-måtten finns i temafilen, en guldknapp i
// LandingScreen.test) och ägarbeslut 4 (inga anrop) vaktas av lint: eslint.config.js, stylelint.config.js och src/test/themeTokens.sync.test.ts.
// Kvar här är layoutreglerna och de delade definitionerna som lint inte kan uttrycka.

const sources = import.meta.glob(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}', '../../pages/LandingPage.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const indexPage = import.meta.glob('../../pages/Index.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

// CSS läses från disk: vitest (css: false) tömmer ?raw-importer av .css, så en glob ger tomma strängar och tysta godkännanden.
const readFromDisk = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const css = readFromDisk('./landing.css');

const codeFiles = Object.entries(sources);
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('Landing — layout som inte får gå sönder', () => {
  it('under 380 px ligger banan under rubriken i ett enda spår (att "LEADERBOARD" aldrig bryts mitt i ordet vaktas av Stylelint)', () => {
    // jsdom har ingen layout, så regeln vaktas i CSS:en; bredderna 320–1440 är mätta i Chromium (getClientRects = 1 rektangel).
    const narrow = stripComments(css).match(/@media \(max-width: 379px\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(narrow).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/);
    expect(narrow).toMatch(/grid-template-areas:\s*"badge" "title" "arena" "lead" "cta"/);
  });

  it('löparna har spridda vilopositioner (0/35/70 %) så reducerad rörelse visar en ögonblicksbild, inte en klump', () => {
    const offsets = [...stripComments(css).matchAll(/\.rq-landing-runner\[data-lane="(\d)"\] \{ offset-distance: ([\d.]+)%; \}/g)].map((m) => [m[1], m[2]]);
    expect(offsets).toEqual([['1', '0'], ['2', '35'], ['3', '70']]);
  });
});

describe('Landing-FEATUREN är publik och gör inga anrop (ägarbeslut 4; App-skalet hämtar nivåtabellen via GET /api/config/levels först när någon är inloggad — utloggad ingen)', () => {
  // Inga anrop (fetch, backendApi, react-query, supabase, datahooks) vaktas av ESLint, se eslint.config.js (LANDING_IMPORTS/LANDING_SYNTAX).

  it('exempeldatan är EN delad definition (features/leaderboard/previewUsers) — featuren skriver inga egna löpare', () => {
    expect(sources['./components/LandingScreen.tsx']).toMatch(/leaderboard\/previewUsers/);
    for (const [path, text] of codeFiles) expect({ path, ownUsers: /total_xp\s*:/.test(stripComments(text)) }).toEqual({ path, ownUsers: false });
  });

  it('XP- och streak-siffrorna i texten kommer ur shared-definitionerna, inte ur en egen kopia (ADR 004)', () => {
    const model = sources['./landingModel.ts'];
    expect(model).toMatch(/DEFAULT_ADMIN_SETTINGS/);
    expect(model).toMatch(/DEFAULT_STREAK_MULTIPLIERS/);
    // Att ingen fil importerar constants/streakConstants vaktas av ESLint (STREAK_CONSTANTS i eslint.config.js).
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
    expect(sources['./components/LandingParts.tsx']).toMatch(/<Link to=\{paths\.login\} state=\{FROM_LANDING_STATE\}/);
  });

  it('sidan är tunn: LandingPage monterar bara LandingScreen', () => {
    const page = stripComments(sources['../../pages/LandingPage.tsx']);
    expect(page).toMatch(/<LandingScreen \/>/);
    expect(page.split('\n').length).toBeLessThan(12);
  });
});
